import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildRichMdictIndex, lookupRichMdict } from "../src/background/packs/importers/mdict-rich.js";
import { parseKeyBlock } from "../src/background/packs/importers/mdict-rich-key-codec.js";
import { projectMdictV2PlainText } from "../src/background/packs/importers/mdict-core.js";
import { preflightLocalDictionaryFiles } from "../src/background/packs/local-dictionary-preflight.js";
import { makeMdx } from "./helpers/mdict-fixture.mjs";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { readBoundaryFixture, withMdxHeaderAttributes, withFirstBoundary } from "./helpers/mdx-boundary-fixture.mjs";

const source = (bytes) => ({ size: bytes.length,
  read: async (offset, length) => new Uint8Array(bytes.subarray(offset, offset + length)) });
const inspect = (bytes, options = {}) => preflightLocalDictionaryFiles({
  files: [new File([bytes], "synthetic.mdx")], ...options
});
const lock = JSON.parse(await readFile(new URL("./fixtures/mdx-boundaries/corpus-lock.json", import.meta.url), "utf8"));

test("independent writer fixtures and generator match pinned checksums", async () => {
  for (const file of lock.files) {
    const bytes = await readBoundaryFixture(file.file);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  const script = await readFile(new URL("../scripts/generate-mdx-boundary-fixtures.py", import.meta.url));
  assert.equal(createHash("sha256").update(script).digest("hex"), lock.generatorSha256);
});

for (const file of lock.files) {
  test(`independent raw boundaries build, preflight and query: ${file.file}`, async () => {
    const bytes = await readBoundaryFixture(file.file);
    const index = await buildRichMdictIndex({ source: source(bytes) });
    assert.equal(index.entryCount, file.entries.length);
    assert.equal(index.header.encrypted, file.encrypted ? 2 : 0);
    assert.equal(index.header.encoding, file.encoding === "utf16" ? "UTF-16" : "UTF-8");
    if (file.entries.length > 1) assert.ok(index.keyBlocks.length > 1);
    for (const text of file.entries) {
      const result = await lookupRichMdict({ source: source(bytes), index, text });
      assert.equal(result.found, true, text);
      assert.equal(result.displayForm, text);
      assert.match(result.rawRecord, /sentinel/u);
    }
    const report = await inspect(bytes);
    assert.equal(report.compatibility.status, "supported");
    assert.equal(report.route.importer, "rich-mdict");
  });
}

test("header-only StripKey/case variants retain independent raw blocks in both encodings", async () => {
  for (const name of ["writer-utf8.mdx", "writer-utf16.mdx"]) {
    const original = await readBoundaryFixture(name);
    for (const sensitive of ["Yes", "No"]) {
      const bytes = withMdxHeaderAttributes(original, { StripKey: "Yes", KeyCaseSensitive: sensitive });
      assert.deepEqual(bytes.subarray(bytes.readUInt32BE(0) + 8), original.subarray(original.readUInt32BE(0) + 8));
      const index = await buildRichMdictIndex({ source: source(bytes) });
      assert.equal(index.header.stripKey, true);
      assert.equal(index.header.keyCaseSensitive, sensitive === "Yes");
      const found = await lookupRichMdict({ source: source(bytes), index, text: "co-op" });
      assert.equal(found.found, true);
      assert.match(found.rawRecord, /Punctuation sentinel/u);
      assert.equal((await inspect(bytes)).compatibility.status, "supported");
    }
  }
});

test("legacy normalized pairs still build and query", async () => {
  const bytes = makeRichMdx([["C-o", "<p>first sentinel</p>"], ["Ｆoo", "<p>last sentinel</p>"]]);
  const index = await buildRichMdictIndex({ source: source(bytes) });
  assert.equal(index.keyBlocks[0].firstKey, "co");
  assert.equal(index.keyBlocks[0].lastKey, "foo");
  for (const text of ["C-o", "Ｆoo"]) {
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text })).found, true);
  }
});

test("both ends must match one representation; descriptors are never normalized", () => {
  for (const encoding of ["UTF-8", "UTF-16"]) {
    const codec = encoding === "UTF-8" ? "utf8" : "utf16le";
    const unit = encoding === "UTF-8" ? 1 : 2;
    const raw = Buffer.concat([Buffer.alloc(8), Buffer.from("C-o", codec), Buffer.alloc(unit),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), Buffer.from("Ｆoo", codec), Buffer.alloc(unit)]);
    const header = { encoding, keyCaseSensitive: false, stripKey: true };
    for (const [firstKey, lastKey] of [["C-o", "Ｆoo"], ["co", "foo"]]) {
      assert.equal(parseKeyBlock(raw, { entryCount: 2, firstKey, lastKey }, header).length, 2);
    }
    for (const [firstKey, lastKey] of [["C-o", "foo"], ["co", "Ｆoo"], ["Ｃ-o", "Ｆoo"], ["wrong", "foo"]]) {
      assert.throws(() => parseKeyBlock(raw, { entryCount: 2, firstKey, lastKey }, header),
        (error) => error.code === "MDICT_CORRUPT" && error.check === "key-block-boundary" &&
          !Object.hasOwn(error, "expectedFirst") && !Object.hasOwn(error, "actualFirst"));
    }
    for (const options of [{ ...header, keyCaseSensitive: true }, { ...header, stripKey: false }]) {
      assert.throws(() => parseKeyBlock(raw, { entryCount: 2, firstKey: "co", lastKey: "foo" }, options),
        (error) => error.code === "MDICT_CORRUPT" && error.check === "key-block-boundary");
    }
    assert.throws(() => parseKeyBlock(Buffer.concat([raw, Buffer.from([0])]),
      { entryCount: 2, firstKey: "C-o", lastKey: "Ｆoo" }, header),
    (error) => error.code === "MDICT_CORRUPT" && error.check === "key-block-length");
    const decreasing = Buffer.from(raw);
    decreasing.writeBigUInt64BE(2n, 0);
    assert.throws(() => parseKeyBlock(decreasing, { entryCount: 2, firstKey: "C-o", lastKey: "Ｆoo" }, header),
      (error) => error.code === "MDICT_CORRUPT" && /monotonic/u.test(error.message));
  }
});

test("rechecksummed mixed/colliding boundaries fail preflight with sanitized stage and reason", async () => {
  const bytes = await readBoundaryFixture("single-c.mdx");
  for (const pair of [["C", "c"], ["c", "C"], ["Ｃ", "Ｃ"], ["PRIVATE_SENTINEL", "PRIVATE_SENTINEL"]]) {
    const report = await inspect(withFirstBoundary(bytes, ...pair));
    assert.equal(report.compatibility.status, "invalid");
    assert.equal(report.route.importer, "none");
    assert.deepEqual(report.compatibility.reasons, [{
      code: "mdx.key_block_boundary_mismatch", stage: "key-blocks"
    }]);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SENTINEL|expectedFirst|actualFirst/u);
  }
  assert.equal((await inspect(withFirstBoundary(bytes, "c", "c"))).compatibility.status, "supported");
});

test("classic raw-uppercase MDX can reach the explicitly confirmed structured route", async () => {
  const bytes = makeMdx([["C", "uppercase definition"]]);
  assert.equal((await projectMdictV2PlainText({ mdxBytes: bytes })).entries.length, 1);
  assert.equal((await inspect(bytes)).route.importer, "rich-mdict");
  const report = await inspect(bytes, { semanticConfirmation: true, sourceLanguage: "en", targetLanguage: "zh-CN" });
  assert.equal(report.compatibility.status, "supported");
  assert.equal(report.route.importer, "structured-mdict");
});

test("checksum corruption and unsupported capabilities retain distinct sanitized diagnostics", async () => {
  const bytes = await readBoundaryFixture("single-c.mdx");
  for (const [offset, stage] of [[4, "header"], [bytes.readUInt32BE(0) + 8 + 40, "key-index"]]) {
    const corrupt = Buffer.from(bytes);
    corrupt[offset] ^= 1;
    const report = await inspect(corrupt);
    assert.equal(report.compatibility.status, "invalid");
    assert.deepEqual(report.compatibility.reasons, [{ code: "mdx.corrupt_or_malformed", stage }]);
  }
  const unsupported = await inspect(withMdxHeaderAttributes(bytes, { RequiredEngineVersion: "2.1" }));
  assert.equal(unsupported.compatibility.status, "unsupported");
  assert.deepEqual(unsupported.compatibility.reasons, [{
    code: "mdx.capability_unsupported", capability: "mdx.required-engine-version", stage: "header"
  }]);
  const lzo = await inspect(makeMdx([["alpha", "definition"]], { keyIndexCompression: "lzo" }));
  assert.deepEqual(lzo.compatibility.reasons, [{
    code: "mdx.capability_unsupported", capability: "mdx.compression.lzo", stage: "key-index"
  }]);
});

test("record-index, key-block and final layout failures report their actual stage", async () => {
  const bytes = await readBoundaryFixture("single-c.mdx");
  const preamble = bytes.readUInt32BE(0) + 8;
  const keyBlocks = preamble + 44 + Number(bytes.readBigUInt64BE(preamble + 24));
  const recordSection = keyBlocks + Number(bytes.readBigUInt64BE(preamble + 32));
  const badRecords = Buffer.from(bytes);
  badRecords.writeBigUInt64BE(0n, recordSection + 8);
  const badKeyChecksum = Buffer.from(bytes);
  badKeyChecksum[keyBlocks + 4] ^= 1;
  for (const [input, stage] of [[badRecords, "record-index"], [badKeyChecksum, "key-blocks"],
    [Buffer.concat([bytes, Buffer.from([0])]), "index-validation"]]) {
    const report = await inspect(input);
    assert.equal(report.compatibility.status, "invalid");
    assert.deepEqual(report.compatibility.reasons, [{ code: "mdx.corrupt_or_malformed", stage }]);
    assert.equal(report.route.importer, "none");
  }
});

test("MDX failures precede the separate unchanged MDD file limit", async () => {
  const bytes = await readBoundaryFixture("single-c.mdx");
  let reads = 0;
  const oversized = { name: "synthetic.mdd", size: 128 * 1024 * 1024 + 1,
    slice() { reads++; throw new Error("must not read oversized MDD"); } };
  const inspectPair = (mdx) => preflightLocalDictionaryFiles({ files: [new File([mdx], "synthetic.mdx"), oversized] });
  const invalid = await inspectPair(withFirstBoundary(bytes, "C", "c"));
  assert.equal(invalid.compatibility.reasons[0].code, "mdx.key_block_boundary_mismatch");
  const valid = await inspectPair(bytes);
  assert.equal(valid.compatibility.status, "partial");
  assert.equal(valid.compatibility.reasons[0].code, "mdd.file_too_large");
  assert.equal(reads, 0);
});
