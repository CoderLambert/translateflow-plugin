import test from "node:test";
import assert from "node:assert/strict";
import { buildRichMdictIndex, lookupRichMdict } from "../src/background/packs/importers/mdict-rich.js";
import { createRichMdictLookupBudget, RICH_MDICT_LOOKUP_BUDGETS } from "../src/background/packs/importers/mdict-rich-query-budget.js";
import { createRichMdictLookupController } from "../src/background/packs/rich-mdict-lookup-controller.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";

const readSource = (bytes) => ({ size: bytes.byteLength, async read(offset, length) { return bytes.slice(offset, offset + length); } });
async function corpus(entries, options = {}) {
  const bytes = makeRichMdx(entries, options);
  const source = readSource(bytes);
  return { bytes, source, index: await buildRichMdictIndex({ source }) };
}
const query = (input, text, extra = {}) => lookupRichMdict({ ...input, text, ...extra });

test("same key with distinct offsets keeps all records in original terminal source order and first scalar compatibility", async () => {
  const c = await corpus([["word", "<p>FIRST SENTINEL</p>"], ["word", "<p>SECOND SENTINEL</p>"]]);
  const result = await query(c, "word");
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.rawRecord), ["<p>FIRST SENTINEL</p>", "<p>SECOND SENTINEL</p>"]);
  assert.ok(result.records[0].recordOffset < result.records[1].recordOffset);
  assert.equal(result.rawRecord, result.records[0].rawRecord);
  assert.equal(result.aggregateSourceRecordBytes, c.index.totalRecordBytes);
  assert.equal(result.aggregateDecodedTextBytes, result.records.reduce((sum, record) => sum + Buffer.byteLength(record.rawRecord), 0));
});

test("same spelling and same source offset is read and delivered once, including across key blocks", async () => {
  const stream = Buffer.from("<p>ONE SHARED RECORD</p>\0");
  const c = await corpus([["word", "unused"], ["word", "unused"]], { recordOffsets: [0, 0], recordStream: stream, keyBlockEntryCounts: [1, 1] });
  let metrics;
  const result = await query(c, "word", { onMetrics: (value) => { metrics = value; } });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceRecordBytes, stream.byteLength);
  assert.equal(metrics.recordBlockDecodes, 1);
});

test("all exact spellings win over folded siblings; folded overflow cannot reject an exact match found later", async () => {
  const c = await corpus([...Array.from({ length: 65 }, () => ["word", "folded"]), ["Word", "EXACT LATE"]]);
  const result = await query(c, "Word");
  assert.deepEqual(result.records.map((record) => record.rawRecord), ["EXACT LATE"]);
  await assert.rejects(query(c, "WORD"), { code: "MDICT_LIMIT" });
  const small = await corpus([["Word", "one"], ["word", "two"], ["Word", "three"]]);
  assert.deepEqual((await query(small, "Word")).records.map((record) => record.rawRecord), ["one", "three"]);
  assert.deepEqual((await query(small, "WORD")).records.map((record) => record.rawRecord), ["one", "two", "three"]);
});

test("mixed alias and real siblings prune offset/path cycle branches while retaining every distinct terminal", async () => {
  const c = await corpus([["word", "@@@LINK=target"], ["word", "LOCAL REAL"], ["target", "@@@LINK=word"], ["target", "TARGET REAL"]]);
  const result = await query(c, "word");
  assert.deepEqual(result.records.map((record) => record.rawRecord), ["LOCAL REAL", "TARGET REAL"]);
  assert.equal(result.diagnostics.aliasCycleBranches, 1);
  assert.equal(result.records[1].aliasTarget, "target");
});

test("convergent aliases deduplicate terminal offsets while charging every cached visit", async () => {
  const c = await corpus([["word", "@@@LINK=target"], ["word", "@@@LINK=target"], ["target", "ONE TERMINAL"]]);
  let metrics;
  const result = await query(c, "word", { onMetrics: (value) => { metrics = value; } });
  assert.equal(result.records.length, 1);
  assert.equal(metrics.spanVisits, 4);
  assert.equal(metrics.recordBlockDecodes, 1);
  assert.equal(metrics.keyBlockDecodes, 1);
  assert.equal(metrics.sourceRangeReads, 2);
});

test("only cycles, missing targets, corrupt terminal data and excessive alias depth fail without a partial hit", async () => {
  for (const entries of [
    [["word", "@@@LINK=target"], ["target", "@@@LINK=word"]],
    [["word", "valid real"], ["word", "@@@LINK=missing"]],
    [...Array.from({ length: 9 }, (_, index) => [`chain${index}`, `@@@LINK=chain${index + 1}`]), ["chain9", "real"]]
  ]) {
    const c = await corpus(entries);
    await assert.rejects(query(c, entries[0][0]), (error) => ["MDICT_CORRUPT", "MDICT_LIMIT"].includes(error.code));
  }
  const c = await corpus([["word", "real one"], ["word", "real two"]]);
  const bad = Buffer.from(c.bytes); bad[c.index.recordBlocks[0].dataOffset + 8] ^= 0xff;
  await assert.rejects(query({ ...c, source: readSource(bad) }, "word"), { code: "MDICT_CORRUPT" });
  await assert.rejects(corpus([["word", "one"], ["word", "two"]], { recordOffsets: [0, 99999] }), { code: "MDICT_CORRUPT" });
});

test("the eight-link maximum remains usable and returns its first alias provenance", async () => {
  const c = await corpus([...Array.from({ length: 8 }, (_, index) => [`chain${index}`, `@@@LINK=chain${index + 1}`]), ["chain8", "END OF EIGHT LINKS"]]);
  const result = await query(c, "chain0");
  assert.equal(result.records.length, 1);
  assert.equal(result.aliasTarget, "chain1");
  assert.equal(result.rawRecord, "END OF EIGHT LINKS");
});

test("multiple records crossing key and record blocks retain complete spans and charge each decoded block once", async () => {
  const entries = [["word", "one ".repeat(20)], ["word", "two ".repeat(20)]];
  const length = entries.reduce((sum, [, raw]) => sum + Buffer.byteLength(raw) + 1, 0);
  const c = await corpus(entries, { keyBlockEntryCounts: [1, 1], recordBlockBytes: [79, 5, length - 84] });
  let metrics;
  const result = await query(c, "word", { onMetrics: (value) => { metrics = value; } });
  assert.deepEqual(result.records.map((record) => record.rawRecord), entries.map(([, raw]) => raw.trim()));
  assert.equal(metrics.keyBlockDecodes, 2);
  assert.equal(metrics.recordBlockDecodes, 3);
});

test("aggregate record budget is shared across records and cached terminal convergence does not multiply bytes", async () => {
  const c = await corpus([["word", "a".repeat(550_000)], ["word", "b".repeat(550_000)]]);
  await assert.rejects(query(c, "word"), (error) => error.code === "MDICT_LIMIT" && /aggregate/u.test(error.message));
  const repeated = await corpus([["word", "@@@LINK=target"], ["word", "@@@LINK=target"], ["target", "x".repeat(900_000)]]);
  assert.equal((await query(repeated, "word")).aggregateSourceRecordBytes, 900_001);
});

test("span guard includes roots, alias siblings and cached work; 257 is an error rather than truncation", async () => {
  const budget = createRichMdictLookupBudget();
  budget.consumeSpanVisits(256);
  assert.throws(() => budget.consumeSpanVisits(1), { code: "MDICT_LIMIT" });
  assert.equal(budget.metrics.spanVisits, 256);
  const c = await corpus([...Array.from({ length: 64 }, () => ["word", "@@@LINK=target"]), ...Array.from({ length: 4 }, () => ["target", "real"])]);
  await assert.rejects(query(c, "word"), (error) => error.code === "MDICT_LIMIT" && /span visits/u.test(error.message));
  budget.consumeKeyScans(RICH_MDICT_LOOKUP_BUDGETS.keyScans);
  assert.throws(() => budget.consumeKeyScans(), { code: "MDICT_LIMIT" });
});

test("cancellation while loading a shared record block aborts before cached branches can publish results", async () => {
  const c = await corpus([["word", "@@@LINK=target"], ["word", "real"], ["target", "terminal"]]);
  const controller = new AbortController();
  const source = { size: c.source.size, async read(offset, length) {
    const bytes = await c.source.read(offset, length);
    if (offset === c.index.recordBlocks[0].dataOffset) controller.abort();
    return bytes;
  } };
  await assert.rejects(query({ ...c, source }, "word", { signal: controller.signal }), { name: "AbortError" });
});

test("background validates all records, shared metadata, aggregate bytes and stable unique source offsets", async () => {
  const c = await corpus([["word", "first"], ["word", "second"]]);
  const parsed = await query(c, "word");
  const valid = await backend(c, parsed);
  assert.equal(valid.found, true);
  assert.equal(valid.dictionaries[0].records.length, 2);
  assert.equal(valid.dictionaries[0].records[0].richRecord.styleSheetRules, undefined);
  assert.deepEqual(valid.dictionaries[0].richRecord.styleSheetRules, c.index.header.styleSheetRules);
  for (const change of [
    (result) => { result.records[1].rawRecord = 123; },
    (result) => { result.records[1].decodedTextBytes = 0; },
    (result) => { result.records[1].recordOffset = result.records[0].recordOffset; },
    (result) => { result.records[1].recordEnd += 1; },
    (result) => { result.aggregateSourceRecordBytes += 1; },
    (result) => { result.records[1].safeTextFallback = "x".repeat(2 * 1024 * 1024); },
    (result) => { result.records = []; }
  ]) {
    const result = structuredClone(parsed); change(result);
    const response = await backend(c, result);
    assert.equal(response.found, false);
    assert.equal(response.dictionaries.length, 0);
    assert.equal(response.errors.length, 1);
  }
});

test("background rejects cumulative decoded text overflow even when every individual item is within its limit", async () => {
  const c = await corpus([["word", "one"]]);
  c.index.totalRecordBytes = 300_000;
  const records = Array.from({ length: 3 }, (_, ordinal) => ({ displayForm: "word", rawRecord: "界".repeat(300_000),
    sourceRecordBytes: 100_000, decodedTextBytes: 900_000, recordOffset: ordinal * 100_000, recordEnd: (ordinal + 1) * 100_000, safeTextFallback: "bounded" }));
  const response = await backend(c, { found: true, records });
  assert.equal(response.found, false);
  assert.equal(response.errors[0].code, "RICH_MDICT_LIMIT");
});

test("response composition uses UTF-8 content budgets, permits JSON escaping and bounds shared stylesheet metadata", async () => {
  const c = await corpus([["word", '\"\"\"\"\"\"\"\"\"\"']]);
  const result = await query(c, "word");
  const response = await backend(c, result);
  assert.equal(response.found, true);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) > result.aggregateDecodedTextBytes);
  const sourceBytes = 1024 * 1024;
  const escaped = { found: true, rawRecord: '"'.repeat(sourceBytes - 1), sourceRecordBytes: sourceBytes,
    decodedTextBytes: sourceBytes - 1, safeTextFallback: '"'.repeat(2 * 1024 * 1024) };
  const legacyEscaped = await backend(c, escaped);
  assert.equal(legacyEscaped.found, true);
  assert.ok(Buffer.byteLength(JSON.stringify(legacyEscaped)) > 8 * 1024 * 1024,
    "composition limits are not an added JSON-envelope or physical heap ceiling");
  for (const rules of [
    Array.from({ length: 17 }, (_, index) => ({ id: index + 1, begin: "x".repeat(4096), end: "" })),
    [{ id: 1, begin: "x".repeat(4097), end: "" }],
    Array.from({ length: 256 }, (_, index) => ({ id: index + 1, begin: "", end: "" })),
    [{ id: 1, begin: "<b>", end: "</b>" }, { id: 1, begin: "<i>", end: "</i>" }]
  ]) {
    const broken = { ...c, index: { ...c.index, header: { ...c.index.header, styleSheetRules: rules } } };
    const failed = await backend(broken, result);
    assert.equal(failed.found, false);
    assert.equal(failed.errors.length, 1);
  }
  const boundary = { ...c, index: { ...c.index, header: { ...c.index.header,
    styleSheetRules: Array.from({ length: 16 }, (_, index) => ({ id: index + 1, begin: "x".repeat(4096), end: "" })) } } };
  assert.equal((await backend(boundary, result)).found, true);
});

async function backend(c, result) {
  const id = "rich-mdict-123e4567-e89b-42d3-a456-426614174270";
  const active = { packId: id, packVersion: "import-fixture-12345678", sourceSize: c.source.size,
    indexSize: 1, indexSha256: "a".repeat(64), title: "Synthetic records" };
  const controller = createRichMdictLookupController({ stateStore: { read: async () => ({ packs: { [id]: { sourceId: "local-rich-mdict", status: "healthy", active } } }) },
    lookup: async () => result, assertSourceSize: async () => {}, loadIndex: async () => c.index,
    sourceReader: () => c.source, clampUtf8Text: (value) => value });
  return controller.lookupText("word", id);
}
