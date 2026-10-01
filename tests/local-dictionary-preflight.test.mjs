import test from "node:test";
import assert from "node:assert/strict";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "./helpers/mdd-fixture.mjs";
import { makeMdx } from "./helpers/mdict-fixture.mjs";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich.js";
import { buildMddIndex } from "../src/background/packs/importers/mdd.js";
import {
  preflightLocalDictionaryFiles,
  LOCAL_DICTIONARY_PREFLIGHT_STATUS
} from "../src/background/packs/local-dictionary-preflight.js";
import { validateStarDictIndex, validateStarDictSynonyms } from "../src/background/packs/importers/stardict-binary.js";

test("rich MDX plus base and numbered MDD companions is classified without reading resource bodies", async () => {
  const mdxBytes = makeRichMdx([["alpha", "<p>definition</p>"]]);
  const mddBytes = makeMdd([["\\media\\one.png", Uint8Array.of(1, 2, 3)]]);
  const mdxIndex = await buildRichMdictIndex({ source: trackedSource(mdxBytes) });
  const mddIndex = await buildMddIndex({ source: trackedSource(mddBytes) });
  const mdx = trackedFile("My Dictionary.mdx", mdxBytes);
  const mdd = trackedFile("My Dictionary.mdd", mddBytes);
  const numbered = trackedFile("My Dictionary.1.mdd", mddBytes);

  const result = await preflightLocalDictionaryFiles({ files: [numbered, mdx, mdd] });

  assert.equal(result.compatibility.status, "supported");
  assert.equal(result.identity.family, "mdict-rich");
  assert.equal(result.route.importer, "rich-mdict");
  assert.equal(result.estimates.entryCount, 1);
  assert.deepEqual(result.resources.associatedMdd.map((item) => item.fileName), [
    "My Dictionary.mdd",
    "My Dictionary.1.mdd"
  ]);
  assert.equal(result.resources.associatedMdd.length, 2);
  assert.ok(result.compatibility.capabilitiesPresent.includes("mdx.record.html"));
  assert.ok(result.identity.hints.every((hint) => hint.verified === false &&
    hint.verification === "unverified"));
  assert.ok(result.identity.hints.every((hint) => hint.ranges.every((range) =>
    range.offset + range.length <= hint.readableEnd)));
  assert.ok(result.resources.associatedMdd[0].capabilities.includes("mdd.engine.v2"));
  assertNoRecordBodyReads(mdx.reads, mdxIndex.recordBlocksOffset, mdxIndex.recordBlocksBytes);
  for (const file of [mdd, numbered]) {
    assertNoRecordBodyReads(file.reads, mddIndex.recordBlocksOffset, mddIndex.recordBlocksBytes);
  }
  assert.deepEqual(LOCAL_DICTIONARY_PREFLIGHT_STATUS, ["supported", "partial", "unsupported", "invalid"]);
});

test("unassociated MDD is surfaced and never silently attached", async () => {
  const result = await preflightLocalDictionaryFiles({
    files: [
      namedBlob("EntryBook.mdx", makeRichMdx([["alpha", "plain"]], { title: "<svg onload=alert(1)>" })),
      namedBlob("DifferentBook.mdd", makeMdd([["\\media\\one.png", Uint8Array.of(1)]]))
    ]
  });

  assert.equal(result.compatibility.status, "partial");
  assert.deepEqual(result.resources.associatedMdd, []);
  assert.deepEqual(result.resources.unassociatedFiles, ["DifferentBook.mdd"]);
  assert.doesNotMatch(result.identity.displayTitle, /[<>]/u);
  assert.ok(result.compatibility.warnings.some((warning) => warning.code === "mdd.unassociated_files"));
});

test("plain-text MDX stays in the rich lane until the user confirms strict EN to zh-CN projection", async () => {
  const bytes = makeRichMdx([["hello", "你好"]], { format: "Text", styleSheet: "" });
  const defaultRoute = await preflightLocalDictionaryFiles({ files: [namedBlob("Plain.mdx", bytes)] });
  const wrongDirection = await preflightLocalDictionaryFiles({
    files: [namedBlob("Plain.mdx", bytes)],
    semanticConfirmation: true,
    sourceLanguage: "fr",
    targetLanguage: "zh-CN"
  });
  const structured = await preflightLocalDictionaryFiles({
    files: [namedBlob("Plain.mdx", bytes)],
    semanticConfirmation: true,
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  });

  assert.equal(defaultRoute.compatibility.status, "supported");
  assert.equal(defaultRoute.route.importer, "rich-mdict");
  assert.ok(defaultRoute.compatibility.warnings.some((warning) => warning.code === "mdx.structured_semantics_not_confirmed"));
  assert.equal(wrongDirection.compatibility.status, "partial");
  assert.equal(wrongDirection.route.importer, "rich-mdict");
  assert.equal(wrongDirection.compatibility.reasons[0].code, "mdx.structured_language_direction_unsupported");
  assert.equal(structured.compatibility.status, "supported");
  assert.equal(structured.identity.family, "mdict-structured");
  assert.equal(structured.route.importer, "structured-mdict");
  assert.equal(structured.route.requiresSemanticConfirmation, false);
});

test("well-formed unsupported MDict compression differs from corrupt MDX", async () => {
  const lzo = makeMdx([["alpha", "definition"]], { keyIndexCompression: "lzo" });
  const unsupported = await preflightLocalDictionaryFiles({ files: [namedBlob("Lzo.mdx", lzo)] });
  const corrupt = await preflightLocalDictionaryFiles({ files: [namedBlob("Broken.mdx", Uint8Array.of(1, 2, 3))] });

  assert.equal(unsupported.compatibility.status, "unsupported");
  assert.equal(unsupported.compatibility.reasons[0].code, "mdx.capability_unsupported");
  assert.equal(unsupported.compatibility.reasons[0].capability, "mdx.compression.lzo");
  assert.equal(corrupt.compatibility.status, "invalid");
  assert.equal(corrupt.compatibility.reasons[0].code, "mdx.corrupt_or_malformed");
});

test("StarDict set validates metadata/index, distinguishes missing components and defers text semantics", async () => {
  const files = makeStarDictFiles();
  const complete = await preflightLocalDictionaryFiles({ files });
  const missingData = await preflightLocalDictionaryFiles({ files: files.slice(0, 2) });
  const corrupt = await preflightLocalDictionaryFiles({
    files: [files[0], namedBlob("Sample.idx", Uint8Array.of(0xff)), files[2]]
  });

  assert.equal(complete.compatibility.status, "supported");
  assert.equal(complete.identity.family, "stardict");
  assert.equal(complete.route.importer, "stardict");
  assert.equal(complete.route.requiresSemanticConfirmation, true);
  assert.equal(complete.estimates.entryCount, 1);
  assert.equal(files[2].reads.length, 0, "preflight must not read StarDict definition bytes");
  assert.ok(complete.identity.hints.some((hint) => hint.fileName === "Sample.idx" &&
    hint.kind === "bounded-byte-sample-sha256" && hint.verified === false));
  assert.equal(missingData.compatibility.status, "partial");
  assert.equal(missingData.compatibility.reasons[0].code, "stardict.dictionary_data_missing");
  assert.deepEqual(missingData.resources.missingCompanionHints, ["Sample.dict or Sample.dict.dz"]);
  assert.equal(corrupt.compatibility.status, "invalid");
});

test("StarDict dictzip preflight reads its bounded RA header without extracting the dictionary", async () => {
  const ordinary = makeStarDictFiles();
  const dictzip = trackedFile("Sample.dict.dz", makeDictzipHeader(3000));
  const result = await preflightLocalDictionaryFiles({ files: [ordinary[0], ordinary[1], dictzip] });

  assert.equal(result.compatibility.status, "supported");
  assert.ok(dictzip.reads.some(({ end }) => end > 4096));
  assert.ok(dictzip.reads.every(({ end }) => end <= 12 + 4 + 6 + 3000 * 2));
});

test("TFLex profile is recognized while full hashes and records stay with the importer", async () => {
  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    normalizationVersion: 1,
    profile: "opfs-indexed-v1",
    distributionStatus: "user-import-only",
    semanticProfile: "en-zh-plain-text-translation-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    license: { id: "USER-PROVIDED-UNVERIFIED", source: "local-user-import" },
    packId: "local-fixture",
    packVersion: "v1",
    fingerprint: `sha256:${"a".repeat(64)}`,
    recordCount: 1
  };
  const result = await preflightLocalDictionaryFiles({
    files: [
      namedBlob("manifest.json", new TextEncoder().encode(JSON.stringify(manifest))),
      namedBlob("index.dat", Uint8Array.of(1)),
      namedBlob("entries.dat", Uint8Array.of(2))
    ]
  });
  const unknown = await preflightLocalDictionaryFiles({ files: [namedBlob("notes.txt", "hello")] });

  assert.equal(result.identity.family, "tflex");
  assert.equal(result.route.importer, "tflex");
  assert.equal(result.compatibility.status, "partial");
  assert.equal(result.compatibility.reasons[0].code, "tflex.full_validation_deferred");
  assert.deepEqual(result.identity.hints.map((hint) => hint.kind), [
    "tflex-pack-identity",
    "tflex-declared-fingerprint"
  ]);
  assert.ok(result.identity.hints.every((hint) => hint.verified === false &&
    hint.verification === "unverified"));
  assert.equal(unknown.compatibility.status, "unsupported");
  assert.equal(unknown.route.importer, "none");
});

test("StarDict large index validation yields cooperatively and observes cancellation mid-scan", async () => {
  const wordCount = 12000;
  const index = makeLargeStarDictIndex(wordCount);
  const synonyms = makeLargeStarDictSynonyms(wordCount);
  await assertStarDictScanCancels((options) => validateStarDictIndex(index, {
    ...options, wordCount, dictBytes: wordCount
  }));
  await assertStarDictScanCancels((options) => validateStarDictSynonyms(synonyms, {
    ...options, synonymCount: wordCount, wordCount
  }));
});

test("duplicate names, malformed MDD association and cancellation are explicit", async () => {
  const bytes = makeRichMdx([["alpha", "plain"]]);
  const duplicate = await preflightLocalDictionaryFiles({
    files: [namedBlob("same.mdx", bytes), namedBlob("SAME.MDX", bytes)]
  });
  const numbering = await preflightLocalDictionaryFiles({
    files: [
      namedBlob("set.mdx", bytes),
      namedBlob("set.mdd", makeMdd([["\\one", Uint8Array.of(1)]])),
      namedBlob("set.2.mdd", makeMdd([["\\two", Uint8Array.of(2)]]))
    ]
  });
  const controller = new AbortController();
  controller.abort();

  assert.equal(duplicate.compatibility.status, "invalid");
  assert.equal(duplicate.compatibility.reasons[0].code, "file_set.duplicate_name");
  assert.equal(numbering.compatibility.status, "invalid");
  assert.equal(numbering.compatibility.reasons[0].code, "mdd.numbering_not_consecutive");
  await assert.rejects(
    preflightLocalDictionaryFiles({ files: [namedBlob("cancel.mdx", bytes)], signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );

  let releaseRead;
  let signalReadStarted;
  const readStarted = new Promise((resolve) => { signalReadStarted = resolve; });
  const readGate = new Promise((resolve) => { releaseRead = resolve; });
  const delayed = delayedFile("delayed.mdx", bytes, signalReadStarted, readGate);
  const midReadController = new AbortController();
  const result = preflightLocalDictionaryFiles({ files: [delayed], signal: midReadController.signal });
  await readStarted;
  midReadController.abort();
  releaseRead();
  await assert.rejects(result, (error) => error?.name === "AbortError");
});

test("preflight makes no network requests or Provider calls", async () => {
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("unexpected network request"); };
  try {
    await preflightLocalDictionaryFiles({ files: [namedBlob("Local.mdx", makeRichMdx([["alpha", "plain"]]))] });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

function makeStarDictFiles() {
  const idx = Buffer.concat([Buffer.from("alpha\0"), u32(0), u32(1)]);
  const ifo = [
    "StarDict's dict ifo file",
    "version=2.4.2",
    "bookname=Open Fixture",
    "wordcount=1",
    `idxfilesize=${idx.byteLength}`,
    "sametypesequence=m",
    ""
  ].join("\n");
  return [
    namedBlob("Sample.ifo", ifo),
    namedBlob("Sample.idx", idx),
    trackedFile("Sample.dict", Uint8Array.of(120))
  ];
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function makeLargeStarDictIndex(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const word = Buffer.from(`word${String(index).padStart(6, "0")}`);
    records.push(word, Buffer.from([0]), u32(index), u32(1));
  }
  return Buffer.concat(records);
}

function makeLargeStarDictSynonyms(count) {
  const records = [];
  for (let index = 0; index < count; index += 1) {
    records.push(Buffer.from(`alias${String(index).padStart(6, "0")}`), Buffer.from([0]), u32(0));
  }
  return Buffer.concat(records);
}

async function assertStarDictScanCancels(scan) {
  const controller = new AbortController();
  let processedAtCancellation = 0;
  await assert.rejects(scan({
    signal: controller.signal,
    yieldEvery: 256,
    async yieldControl({ recordsProcessed }) {
      processedAtCancellation = recordsProcessed;
      controller.abort();
    }
  }), (error) => error?.name === "AbortError");
  assert.equal(processedAtCancellation, 256);
}

function makeDictzipHeader(chunkCount) {
  const ra = Buffer.alloc(6 + chunkCount * 2);
  ra.writeUInt16LE(1, 0);
  ra.writeUInt16LE(16, 2);
  ra.writeUInt16LE(chunkCount, 4);
  for (let index = 0; index < chunkCount; index += 1) ra.writeUInt16LE(1, 6 + index * 2);
  const extraBytes = 4 + ra.byteLength;
  const header = Buffer.alloc(12 + extraBytes);
  header.set([0x1f, 0x8b, 8, 0x04], 0);
  header.writeUInt16LE(extraBytes, 10);
  header.set([0x52, 0x41], 12);
  header.writeUInt16LE(ra.byteLength, 14);
  ra.copy(header, 16);
  return Buffer.concat([header, Buffer.from([0x03])]);
}

function namedBlob(name, input) {
  const blob = new Blob([input]);
  Object.defineProperty(blob, "name", { value: name, enumerable: true });
  return blob;
}

function trackedFile(name, input) {
  const blob = new Blob([input]);
  const reads = [];
  return {
    name,
    size: blob.size,
    reads,
    slice(start, end) {
      reads.push({ start, end });
      return blob.slice(start, end);
    }
  };
}

function delayedFile(name, input, started, gate) {
  const bytes = new Uint8Array(input);
  return {
    name,
    size: bytes.byteLength,
    slice(start, end) {
      return {
        async arrayBuffer() {
          started();
          await gate;
          const range = bytes.slice(start, end);
          return range.buffer.slice(range.byteOffset, range.byteOffset + range.byteLength);
        }
      };
    }
  };
}

function trackedSource(input) {
  const bytes = new Uint8Array(input);
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    }
  };
}

function assertNoRecordBodyReads(reads, recordStart, recordBytes) {
  const recordEnd = recordStart + recordBytes;
  assert.ok(reads.every(({ start, end }) => end <= recordStart || start >= recordEnd));
}
