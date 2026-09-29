import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_POC_LIMITS,
  StarDictImportError,
  parseStarDictDictzipHeader,
  parseStarDictIfo,
  parseStarDictIndex,
  parseStarDictSynonyms,
  projectStarDictPlainText,
  projectStarDictPoc,
  readStarDictDictionaryFile,
  sanitizePlainText
} from "../scripts/project-stardict-import.mjs";
import * as browserStarDict from "../src/background/packs/importers/stardict-core.js";

test("StarDict Node POC re-exports the exact browser-safe parser core", async () => {
  assert.equal(
    projectStarDictPlainText,
    browserStarDict.projectStarDictPlainText
  );
  assert.equal(
    parseStarDictIfo,
    browserStarDict.parseStarDictIfo
  );
  assert.equal(
    parseStarDictIndex,
    browserStarDict.parseStarDictIndex
  );
  assert.equal(
    parseStarDictSynonyms,
    browserStarDict.parseStarDictSynonyms
  );
  assert.equal(
    parseStarDictDictzipHeader,
    browserStarDict.parseStarDictDictzipHeader
  );
  assert.equal(
    sanitizePlainText,
    browserStarDict.sanitizePlainText
  );
  assert.equal(
    StarDictImportError,
    browserStarDict.StarDictImportError
  );
  assert.equal(
    STARDICT_IMPORT_ERROR,
    browserStarDict.STARDICT_IMPORT_ERROR
  );
});

test("StarDict browser core accepts Web byte types and matches Node Buffer projection", () => {
  const fixture = makeFixture([
    ["alpha", "第一"],
    ["beta", "第二"]
  ], [
    ["alpha alias", 0],
    ["shared", 0],
    ["shared", 1]
  ]);
  const expected = projectStarDictPlainText({
    ...fixture,
    sourceId: "fixture-browser",
    sourceVersion: "v1"
  });
  const actual = browserStarDict.projectStarDictPlainText({
    ifoText: fixture.ifoText,
    idxBytes: copyArrayBuffer(fixture.idxBytes),
    dictBytes: new DataView(copyArrayBuffer(fixture.dictBytes)),
    synBytes: new Uint8Array(copyArrayBuffer(fixture.synBytes)),
    sourceId: "fixture-browser",
    sourceVersion: "v1"
  });
  assert.deepEqual(actual, expected);
});

test("StarDict browser parser modules have no Node runtime dependency", async () => {
  for (const relative of [
    "../src/background/packs/importers/stardict-contract.js",
    "../src/background/packs/importers/stardict-binary.js",
    "../src/background/packs/importers/stardict-dictzip.js",
    "../src/background/packs/importers/stardict-browser-dictzip.js",
    "../src/background/packs/importers/stardict-core.js",
    "../src/background/packs/importers/stardict-semantic.js",
    "../src/background/packs/importers/tflex-local-builder.js",
    "../src/background/packs/importers/stardict-local-adapter.js",
    "../src/background/packs/importers/stardict-import-action.js"
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']node:/);
    assert.doesNotMatch(source, /\bBuffer\b/);
    assert.doesNotMatch(source, /\bprocess\b/);
  }
});

test("StarDict dictzip header parser accepts RA metadata and rejects non-dictzip gzip", () => {
  const payload = Buffer.from("dictionary payload", "utf8");
  const dictzip = makeDictzip(payload);
  const parsed = parseStarDictDictzipHeader(dictzip);

  assert.deepEqual(parsed, {
    version: 1,
    chunkLength: 65535,
    chunkCount: 1,
    compressedChunkBytes: dictzip.compressedChunkBytes
  });
  assertCode(
    () => parseStarDictDictzipHeader(gzipSync(payload)),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictDictzipHeader(makeDictzip(payload, { duplicateRa: true })),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const unsupportedVersion = Buffer.from(dictzip);
  unsupportedVersion[16] = 2;
  unsupportedVersion[17] = 0;
  assertCode(
    () => parseStarDictDictzipHeader(unsupportedVersion),
    STARDICT_IMPORT_ERROR.UNSUPPORTED
  );

  const malformed = Buffer.from(dictzip);
  malformed[20] = 2;
  malformed[21] = 0;
  assertCode(
    () => parseStarDictDictzipHeader(malformed),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
});

test("StarDict dictzip decompression is output-bounded before lexical parsing", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-stardict-dictzip-limit-"));
  try {
    const path = join(root, "bomb.dict.dz");
    await writeFile(path, makeDictzip(Buffer.alloc(1024, 0x61)));
    await assert.rejects(
      readStarDictDictionaryFile(path, {
        limits: {
          ...STARDICT_POC_LIMITS,
          dictArchiveBytes: 1024 * 1024,
          dictBytes: 32
        }
      }),
      (error) => error instanceof StarDictImportError &&
        error.code === STARDICT_IMPORT_ERROR.LIMIT
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("StarDict POC projects deterministic UTF-8 plain-text entries as build-only source facts", () => {
  const fixture = makeFixture([
    ["hello", "你好\n问候"],
    ["run", "跑；运行"]
  ]);
  const result = projectStarDictPlainText({
    ...fixture,
    sourceId: "fixture-stardict",
    sourceVersion: "2026.09"
  });

  assert.deepEqual(result.dictionary, {
    bookname: "Safe Fixture",
    version: "2.4.2",
    wordcount: 2,
    idxfilesize: fixture.idxBytes.byteLength,
    synwordcount: 0,
    sametypesequence: "m"
  });
  assert.deepEqual(result.entries, [
    {
      lookupKey: "hello",
      exactLookupKey: "hello",
      displayForm: "hello",
      plainText: "你好\n问候",
      sourceRef: {
        sourceId: "fixture-stardict",
        recordId: "idx:1"
      }
    },
    {
      lookupKey: "run",
      exactLookupKey: "run",
      displayForm: "run",
      plainText: "跑；运行",
      sourceRef: {
        sourceId: "fixture-stardict",
        recordId: "idx:2"
      }
    }
  ]);
  assert.equal(result.policy.semanticStatus, "unclassified-plain-text");
  assert.equal(result.policy.runtimeStatus, "build-test-only");
  assert.equal(result.policy.tflexMapping, "not-yet-approved");
  assert.ok(result.unsupportedFeatures.includes("rich StarDict field types"));
});

test("StarDict IFO fails closed on unsupported rich fields and 64-bit offsets", () => {
  for (const extra of [
    "sametypesequence=h",
    "sametypesequence=m\nidxoffsetbits=64"
  ]) {
    const ifo = [
      "StarDict's dict ifo file",
      "version=2.4.2",
      "bookname=Unsafe Fixture",
      "wordcount=1",
      "idxfilesize=10",
      extra,
      ""
    ].join("\n");

    assert.throws(
      () => parseStarDictIfo(ifo),
      (error) => error instanceof StarDictImportError &&
        error.code === STARDICT_IMPORT_ERROR.UNSUPPORTED
    );
  }
});

test("StarDict IFO rejects duplicate metadata, unsupported versions and declared resource limits", () => {
  const duplicate = [
    "StarDict's dict ifo file",
    "version=2.4.2",
    "version=2.4.2",
    "bookname=Fixture",
    "wordcount=1",
    "idxfilesize=10",
    "sametypesequence=m",
    ""
  ].join("\n");
  assertCode(() => parseStarDictIfo(duplicate), STARDICT_IMPORT_ERROR.CORRUPT);

  const unsupported = baseIfo({ version: "4.0.0", wordcount: 1, idxfilesize: 10 });
  assertCode(() => parseStarDictIfo(unsupported), STARDICT_IMPORT_ERROR.UNSUPPORTED);

  const limits = { ...STARDICT_POC_LIMITS, entryCount: 1 };
  const tooMany = baseIfo({ wordcount: 2, idxfilesize: 20 });
  assertCode(() => parseStarDictIfo(tooMany, limits), STARDICT_IMPORT_ERROR.LIMIT);
});

test("StarDict synonym parser accepts bounded sorted aliases and validates target indexes", () => {
  const bytes = encodeSynonyms([
    ["alpha alias", 0],
    ["beta alias", 1],
    ["shared", 0],
    ["shared", 1]
  ]);
  assert.deepEqual(parseStarDictSynonyms(bytes, {
    synonymCount: 4,
    wordCount: 2
  }), [
    { word: "alpha alias", targetIndex: 0 },
    { word: "beta alias", targetIndex: 1 },
    { word: "shared", targetIndex: 0 },
    { word: "shared", targetIndex: 1 }
  ]);
  assert.deepEqual(parseStarDictSynonyms(encodeSynonyms([
    ["apple alias", 0],
    ["Zebra alias", 1]
  ]), {
    synonymCount: 2,
    wordCount: 2
  }), [
    { word: "apple alias", targetIndex: 0 },
    { word: "Zebra alias", targetIndex: 1 }
  ]);

  assertCode(
    () => parseStarDictSynonyms(encodeSynonyms([["bad", 2]]), {
      synonymCount: 1,
      wordCount: 2
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictSynonyms(encodeSynonyms([["beta", 0], ["alpha", 1]]), {
      synonymCount: 2,
      wordCount: 2
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictSynonyms(encodeSynonyms([["alpha", 0]]), {
      synonymCount: 2,
      wordCount: 2
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictSynonyms(undefined, {
      synonymCount: 1,
      wordCount: 2
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictSynonyms(encodeSynonyms([["<b>alias</b>", 0]]), {
      synonymCount: 1,
      wordCount: 1
    }),
    STARDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
  assertCode(
    () => parseStarDictSynonyms(Buffer.from([0xc3, 0x28, 0, 0, 0, 0, 0]), {
      synonymCount: 1,
      wordCount: 1
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
  assertCode(
    () => parseStarDictSynonyms(Buffer.concat([
      Buffer.from("alias\0", "utf8"),
      Buffer.from([0, 0, 0])
    ]), {
      synonymCount: 1,
      wordCount: 1
    }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const tinyLimits = { ...STARDICT_POC_LIMITS, synonymCount: 1 };
  assertCode(
    () => parseStarDictSynonyms(bytes, {
      synonymCount: 4,
      wordCount: 2,
      limits: tinyLimits
    }),
    STARDICT_IMPORT_ERROR.LIMIT
  );
});

test("StarDict projection attaches .syn aliases to their source rows without inventing senses", () => {
  const fixture = makeFixture([
    ["alpha", "第一"],
    ["beta", "第二"]
  ], [
    ["alpha alias", 0],
    ["shared", 0],
    ["shared", 1]
  ]);
  const result = projectStarDictPlainText(fixture);

  assert.equal(result.dictionary.synwordcount, 3);
  assert.deepEqual(result.entries[0].aliases, ["alpha alias", "shared"]);
  assert.deepEqual(result.entries[1].aliases, ["shared"]);
  assert.equal("senses" in result.entries[0], false);
  assert.equal(result.unsupportedFeatures.includes(".syn aliases"), false);
});

test("StarDict index rejects truncation, unsorted keys, out-of-bounds slices and oversized entries", () => {
  const good = encodeIndex([
    ["alpha", 0, 2],
    ["beta", 2, 2]
  ]);
  assert.deepEqual(parseStarDictIndex(good, {
    wordCount: 2,
    dictBytes: 4
  }), [
    { word: "alpha", offset: 0, size: 2 },
    { word: "beta", offset: 2, size: 2 }
  ]);
  const stardictSorted = encodeIndex([
    ["apple", 0, 1],
    ["Zebra", 1, 1]
  ]);
  assert.deepEqual(parseStarDictIndex(stardictSorted, {
    wordCount: 2,
    dictBytes: 2
  }).map((entry) => entry.word), ["apple", "Zebra"]);

  assertCode(
    () => parseStarDictIndex(good.subarray(0, good.length - 2), { wordCount: 2, dictBytes: 4 }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const unsorted = encodeIndex([
    ["beta", 0, 1],
    ["alpha", 1, 1]
  ]);
  assertCode(
    () => parseStarDictIndex(unsorted, { wordCount: 2, dictBytes: 2 }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const outside = encodeIndex([["alpha", 3, 2]]);
  assertCode(
    () => parseStarDictIndex(outside, { wordCount: 1, dictBytes: 4 }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const tinyLimits = { ...STARDICT_POC_LIMITS, entryBytes: 1 };
  const large = encodeIndex([["alpha", 0, 2]]);
  assertCode(
    () => parseStarDictIndex(large, { wordCount: 1, dictBytes: 2, limits: tinyLimits }),
    STARDICT_IMPORT_ERROR.LIMIT
  );
});

test("StarDict POC rejects renderable markup, unsafe controls and invalid UTF-8", () => {
  assertCode(
    () => sanitizePlainText("<b>definition</b>"),
    STARDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );
  assertCode(
    () => sanitizePlainText("safe\u0001unsafe"),
    STARDICT_IMPORT_ERROR.UNSAFE_CONTENT
  );

  const fixture = makeFixture([["alpha", "safe"]]);
  fixture.dictBytes = Uint8Array.from([0xc3, 0x28, 0x20, 0x20]);
  assertCode(
    () => projectStarDictPlainText(fixture),
    STARDICT_IMPORT_ERROR.CORRUPT
  );
});

test("StarDict POC requires index size/count consistency and never guesses rich semantics", () => {
  const fixture = makeFixture([["alpha", "definition"]]);
  const wrongSizeIfo = baseIfo({
    wordcount: 1,
    idxfilesize: fixture.idxBytes.byteLength + 1
  });
  assertCode(
    () => projectStarDictPlainText({ ...fixture, ifoText: wrongSizeIfo }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const wrongCountIfo = baseIfo({
    wordcount: 2,
    idxfilesize: fixture.idxBytes.byteLength
  });
  assertCode(
    () => projectStarDictPlainText({ ...fixture, ifoText: wrongCountIfo }),
    STARDICT_IMPORT_ERROR.CORRUPT
  );

  const result = projectStarDictPlainText(fixture);
  assert.equal("translations" in result.entries[0], false);
  assert.equal("senses" in result.entries[0], false);
  assert.equal(result.entries[0].plainText, "definition");
});

test("StarDict file POC writes deterministic output and accepts bounded .dict.dz", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-stardict-"));
  try {
    const fixture = makeFixture([
      ["alpha", "第一"],
      ["beta", "第二"]
    ]);
    const ifo = join(root, "safe.ifo");
    const idx = join(root, "safe.idx");
    const dict = join(root, "safe.dict");
    const dictzip = join(root, "safe.dict.dz");
    const outA = join(root, "a.jsonl");
    const reportA = join(root, "a-report.json");
    const outB = join(root, "b.jsonl");
    const reportB = join(root, "b-report.json");
    const outDz = join(root, "dz.jsonl");
    const reportDz = join(root, "dz-report.json");

    await Promise.all([
      writeFile(ifo, fixture.ifoText),
      writeFile(idx, fixture.idxBytes),
      writeFile(dict, fixture.dictBytes),
      writeFile(dictzip, makeDictzip(fixture.dictBytes))
    ]);

    await projectStarDictPoc({
      ifoPath: ifo,
      idxPath: idx,
      dictPath: dict,
      outPath: outA,
      reportPath: reportA,
      sourceId: "fixture",
      sourceVersion: "v1"
    });
    await projectStarDictPoc({
      ifoPath: ifo,
      idxPath: idx,
      dictPath: dict,
      outPath: outB,
      reportPath: reportB,
      sourceId: "fixture",
      sourceVersion: "v1"
    });
    await projectStarDictPoc({
      ifoPath: ifo,
      idxPath: idx,
      dictPath: dictzip,
      outPath: outDz,
      reportPath: reportDz,
      sourceId: "fixture",
      sourceVersion: "v1"
    });

    assert.equal(await readFile(outA, "utf8"), await readFile(outB, "utf8"));
    assert.equal(await readFile(outA, "utf8"), await readFile(outDz, "utf8"));
    assert.equal(await readFile(reportA, "utf8"), await readFile(reportB, "utf8"));
    const report = JSON.parse(await readFile(reportA, "utf8"));
    assert.equal(report.output.entries, 2);
    assert.equal(report.policy.runtimeStatus, "build-test-only");
    assert.equal(report.policy.tflexMapping, "not-yet-approved");

    const dzReport = JSON.parse(await readFile(reportDz, "utf8"));
    assert.equal(dzReport.input.dictCompression, "dictzip");
    assert.equal(dzReport.input.dictBytes, fixture.dictBytes.byteLength);
    assert.equal(dzReport.input.dictzip.chunkCount, 1);
    assert.equal(dzReport.input.dictzip.version, 1);

    const fakeDictzip = join(root, "fake.dict.dz");
    await writeFile(fakeDictzip, gzipSync(fixture.dictBytes));
    await assert.rejects(
      projectStarDictPoc({
        ifoPath: ifo,
        idxPath: idx,
        dictPath: fakeDictzip
      }),
      (error) => error instanceof StarDictImportError &&
        error.code === STARDICT_IMPORT_ERROR.CORRUPT
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function makeDictzip(input, { duplicateRa = false } = {}) {
  const payload = Buffer.from(input);
  const gzip = gzipSync(payload);
  const compressedChunkBytes = gzip.byteLength - 18;
  if (compressedChunkBytes <= 0 || compressedChunkBytes > 0xffff) {
    throw new Error("dictzip test fixture compressed chunk does not fit uint16");
  }

  const raPayload = Buffer.alloc(8);
  raPayload.writeUInt16LE(1, 0);
  raPayload.writeUInt16LE(0xffff, 2);
  raPayload.writeUInt16LE(1, 4);
  raPayload.writeUInt16LE(compressedChunkBytes, 6);

  const makeRa = () => {
    const length = Buffer.alloc(2);
    length.writeUInt16LE(raPayload.byteLength, 0);
    return Buffer.concat([Buffer.from("RA", "ascii"), length, raPayload]);
  };
  const extras = duplicateRa ? Buffer.concat([makeRa(), makeRa()]) : makeRa();
  const extraLength = Buffer.alloc(2);
  extraLength.writeUInt16LE(extras.byteLength, 0);
  const header = Buffer.from(gzip.subarray(0, 10));
  header[3] |= 0x04;

  const result = Buffer.concat([
    header,
    extraLength,
    extras,
    gzip.subarray(10)
  ]);
  result.compressedChunkBytes = compressedChunkBytes;
  return result;
}

function makeFixture(entries, synonyms = []) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const dictChunks = [];
  const indexRows = [];
  let offset = 0;
  for (const [word, text] of sorted) {
    const payload = Buffer.from(text, "utf8");
    dictChunks.push(payload);
    indexRows.push([word, offset, payload.byteLength]);
    offset += payload.byteLength;
  }
  const idxBytes = encodeIndex(indexRows);
  return {
    ifoText: baseIfo({
      wordcount: sorted.length,
      idxfilesize: idxBytes.byteLength,
      synwordcount: synonyms.length
    }),
    idxBytes,
    dictBytes: Buffer.concat(dictChunks),
    ...(synonyms.length ? { synBytes: encodeSynonyms(synonyms) } : {})
  };
}

function baseIfo({
  version = "2.4.2",
  wordcount,
  idxfilesize,
  synwordcount = 0,
  bookname = "Safe Fixture"
}) {
  return [
    "StarDict's dict ifo file",
    "version=" + version,
    "bookname=" + bookname,
    "wordcount=" + wordcount,
    "idxfilesize=" + idxfilesize,
    ...(synwordcount ? ["synwordcount=" + synwordcount] : []),
    "sametypesequence=m",
    ""
  ].join("\n");
}

function encodeIndex(rows) {
  const chunks = [];
  for (const [word, offset, size] of rows) {
    const wordBytes = Buffer.from(word, "utf8");
    const numbers = Buffer.alloc(8);
    numbers.writeUInt32BE(offset, 0);
    numbers.writeUInt32BE(size, 4);
    chunks.push(wordBytes, Buffer.from([0]), numbers);
  }
  return Buffer.concat(chunks);
}

function encodeSynonyms(rows) {
  const chunks = [];
  for (const [word, targetIndex] of rows) {
    const wordBytes = Buffer.from(word, "utf8");
    const target = Buffer.alloc(4);
    target.writeUInt32BE(targetIndex, 0);
    chunks.push(wordBytes, Buffer.from([0]), target);
  }
  return Buffer.concat(chunks);
}

function copyArrayBuffer(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

function assertCode(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof StarDictImportError && error.code === code
  );
}
