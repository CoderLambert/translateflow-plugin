import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  StarDictImportError
} from "../src/background/packs/importers/stardict-core.js";
import {
  decompressStarDictDictzip
} from "../src/background/packs/importers/stardict-browser-dictzip.js";
import {
  buildStarDictDictzipLocalTflex,
  buildStarDictPlainLocalTflex
} from "../src/background/packs/importers/stardict-local-adapter.js";
import {
  importStarDictDictzipDictionary
} from "../src/background/packs/importers/stardict-import-action.js";

test("browser dictzip decompressor validates RA metadata and inflates gzip bytes", async () => {
  const payload = new TextEncoder().encode("dictionary payload");
  const dictzip = makeDictzip(payload);
  const result = await decompressStarDictDictzip(
    new Blob([dictzip])
  );

  assert.deepEqual(result.bytes, payload);
  assert.equal(result.inputBytes, dictzip.byteLength);
  assert.equal(result.dictzip.version, 1);
  assert.equal(result.dictzip.chunkCount, 1);
  assert.equal(result.dictzip.chunkLength, 65535);
});

test("browser dictzip rejects ordinary gzip before decompression", async () => {
  const gzip = gzipSync(Buffer.from("ordinary gzip"));
  let decompressorCreated = false;
  await assert.rejects(
    decompressStarDictDictzip(
      new Blob([gzip]),
      {
        decompressionStreamFactory() {
          decompressorCreated = true;
          throw new Error(
            "ordinary gzip must fail before decompression"
          );
        }
      }
    ),
    (error) =>
      error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.CORRUPT &&
      /missing (?:the gzip extra field|dictzip RA metadata)/.test(
        error.message
      )
  );
  assert.equal(decompressorCreated, false);
});

test("browser dictzip enforces compressed and decompressed byte ceilings", async () => {
  const payload = Buffer.alloc(4096, 0x61);
  const dictzip = makeDictzip(payload);

  await assert.rejects(
    decompressStarDictDictzip(
      new Blob([dictzip]),
      {
        limits: {
          ...STARDICT_IMPORT_LIMITS,
          dictArchiveBytes: dictzip.byteLength - 1
        }
      }
    ),
    (error) =>
      error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.LIMIT
  );

  await assert.rejects(
    decompressStarDictDictzip(
      new Blob([dictzip]),
      {
        limits: {
          ...STARDICT_IMPORT_LIMITS,
          dictArchiveBytes: 1024 * 1024,
          dictBytes: 32
        }
      }
    ),
    (error) =>
      error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.LIMIT &&
      /decompressed bytes/.test(error.message)
  );
});

test("browser dictzip maps corrupt gzip body/trailer to a typed corrupt error", async () => {
  const dictzip = Buffer.from(
    makeDictzip(Buffer.from("checksum fixture"))
  );
  dictzip[dictzip.byteLength - 8] ^= 0xff;

  await assert.rejects(
    decompressStarDictDictzip(new Blob([dictzip])),
    (error) =>
      error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.CORRUPT &&
      /decompression failed/.test(error.message)
  );
});

test("browser dictzip honors AbortSignal before and during decompression", async () => {
  const payload = Buffer.alloc(1024, 0x61);
  const dictzip = makeDictzip(payload);

  const before = new AbortController();
  before.abort();
  await assert.rejects(
    decompressStarDictDictzip(
      new Blob([dictzip]),
      { signal: before.signal }
    ),
    (error) => error?.name === "AbortError"
  );

  const during = new AbortController();
  let transformed = false;
  await assert.rejects(
    decompressStarDictDictzip(
      new Blob([dictzip]),
      {
        signal: during.signal,
        decompressionStreamFactory() {
          return new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk);
              if (!transformed) {
                transformed = true;
                during.abort();
              }
            }
          });
        }
      }
    ),
    (error) => error?.name === "AbortError"
  );
  assert.equal(transformed, true);
});

test("browser dictzip and plain StarDict produce byte-identical local TFLex", async () => {
  const fixture = makeStarDict([
    ["hello", "你好"],
    ["run", "运行"]
  ], [
    ["running", 1]
  ]);
  const common = {
    ifoBytes: new TextEncoder().encode(fixture.ifoText),
    idxBytes: fixture.idxBytes,
    synBytes: fixture.synBytes,
    recipe: recipeFixture(),
    cryptoProvider: webcrypto
  };

  const plain = await buildStarDictPlainLocalTflex({
    ...common,
    dictBytes: fixture.dictBytes
  });
  const zipped = await buildStarDictDictzipLocalTflex({
    ...common,
    dictzipBlob: new Blob([
      makeDictzip(fixture.dictBytes)
    ])
  });

  for (const name of [
    "manifest.json",
    "index.dat",
    "entries.dat"
  ]) {
    assert.deepEqual(
      zipped.files[name],
      plain.files[name],
      name + " must match"
    );
  }
  assert.equal(zipped.compression.type, "dictzip");
  assert.equal(
    zipped.compression.outputBytes,
    fixture.dictBytes.byteLength
  );
  assert.equal(
    zipped.compression.metadata.chunkCount,
    1
  );
});

test("dictzip import action commits only after bounded decompression and validation", async () => {
  const fixture = makeStarDict([
    ["run", "运行"]
  ]);
  let received = null;
  const result = await importStarDictDictzipDictionary({
    ifoBytes: new TextEncoder().encode(fixture.ifoText),
    idxBytes: fixture.idxBytes,
    dictzipBlob: new Blob([
      makeDictzip(fixture.dictBytes)
    ]),
    synBytes: fixture.synBytes,
    recipe: recipeFixture(),
    requestId: "dictzip-import-1",
    cryptoProvider: webcrypto,
    async importTflex(input) {
      received = input;
      return { status: "imported" };
    }
  });

  assert.equal(received.requestId, "dictzip-import-1");
  assert.deepEqual(
    Object.keys(received.files).sort(),
    ["entries.dat", "index.dat", "manifest.json"]
  );
  assert.equal(result.status, "imported");
  assert.equal(result.packId, "local-stardict-fixture");
  assert.equal(result.compression.type, "dictzip");
});

function makeStarDict(entries, synonyms = []) {
  const sorted = [...entries].sort(
    (a, b) =>
      Buffer.compare(
        Buffer.from(a[0]),
        Buffer.from(b[0])
      )
  );
  const dictChunks = [];
  const idxChunks = [];
  let offset = 0;

  for (const [word, text] of sorted) {
    const wordBytes = Buffer.from(word, "utf8");
    const payload = Buffer.from(text, "utf8");
    const numbers = Buffer.alloc(8);
    numbers.writeUInt32BE(offset, 0);
    numbers.writeUInt32BE(payload.byteLength, 4);
    idxChunks.push(
      wordBytes,
      Buffer.from([0]),
      numbers
    );
    dictChunks.push(payload);
    offset += payload.byteLength;
  }

  const idxBytes = Buffer.concat(idxChunks);
  return {
    ifoText: [
      "StarDict's dict ifo file",
      "version=2.4.2",
      "bookname=Fixture EN-ZH",
      "wordcount=" + sorted.length,
      "idxfilesize=" + idxBytes.byteLength,
      ...(synonyms.length
        ? ["synwordcount=" + synonyms.length]
        : []),
      "sametypesequence=m",
      ""
    ].join("\n"),
    idxBytes,
    dictBytes: Buffer.concat(dictChunks),
    synBytes: encodeSynonyms(synonyms)
  };
}

function encodeSynonyms(rows) {
  const chunks = [];
  for (const [word, targetIndex] of rows) {
    const target = Buffer.alloc(4);
    target.writeUInt32BE(targetIndex, 0);
    chunks.push(
      Buffer.from(word, "utf8"),
      Buffer.from([0]),
      target
    );
  }
  return Buffer.concat(chunks);
}

function recipeFixture() {
  return {
    schemaVersion: 1,
    semanticProfile:
      "en-zh-plain-text-translation-v1",
    packId: "local-stardict-fixture",
    packVersion: "fixture-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      bookname: "Fixture EN-ZH",
      sourceId: "fixture-stardict",
      sourceVersion: "fixture-v1"
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

function makeDictzip(input) {
  const gzip = gzipSync(Buffer.from(input));
  const compressedChunkBytes = gzip.byteLength - 18;
  if (
    compressedChunkBytes <= 0 ||
    compressedChunkBytes > 0xffff
  ) {
    throw new Error(
      "dictzip fixture compressed chunk does not fit uint16"
    );
  }

  const raPayload = Buffer.alloc(8);
  raPayload.writeUInt16LE(1, 0);
  raPayload.writeUInt16LE(0xffff, 2);
  raPayload.writeUInt16LE(1, 4);
  raPayload.writeUInt16LE(
    compressedChunkBytes,
    6
  );

  const raLength = Buffer.alloc(2);
  raLength.writeUInt16LE(
    raPayload.byteLength,
    0
  );
  const extra = Buffer.concat([
    Buffer.from("RA", "ascii"),
    raLength,
    raPayload
  ]);
  const extraLength = Buffer.alloc(2);
  extraLength.writeUInt16LE(
    extra.byteLength,
    0
  );

  const header = Buffer.from(
    gzip.subarray(0, 10)
  );
  header[3] |= 0x04;
  return Buffer.concat([
    header,
    extraLength,
    extra,
    gzip.subarray(10)
  ]);
}
