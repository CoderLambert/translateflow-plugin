import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import {
  STARDICT_BILINGUAL_PROFILE,
  STARDICT_LOCAL_IMPORT_LICENSE_ID,
  buildStarDictTflexRecords,
  compileTflexStarDictImport,
  createStarDictTflexPocReader,
  validateStarDictImportRecipe,
  validateStarDictTflexPackOutput
} from "../scripts/build-tflex-stardict-import.mjs";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { validateInstalledManifest } from "../src/background/packs/health.js";
import { validateLocalTflexImport } from "../src/background/packs/local-import.js";
import {
  buildStarDictPlainLocalTflex
} from "../src/background/packs/importers/stardict-local-adapter.js";
import {
  importStarDictPlainDictionary
} from "../src/background/packs/importers/stardict-import-action.js";
import {
  buildStarDictTflexRecords as browserBuildStarDictTflexRecords,
  validateStarDictImportRecipe as browserValidateStarDictImportRecipe
} from "../src/background/packs/importers/stardict-semantic.js";
import {
  STARDICT_IMPORT_ERROR,
  StarDictImportError
} from "../src/background/packs/importers/stardict-core.js";

test("StarDict Node compiler re-exports shared browser semantic mapping", () => {
  assert.equal(
    buildStarDictTflexRecords,
    browserBuildStarDictTflexRecords
  );
  assert.equal(
    validateStarDictImportRecipe,
    browserValidateStarDictImportRecipe
  );
});

test("browser plain StarDict adapter is byte-identical to the Node compiler output", async () => {
  const env = await buildFixture("browser-byte-parity");
  try {
    const browser = await buildStarDictPlainLocalTflex({
      ifoBytes: new TextEncoder().encode(env.encoded.ifoText),
      idxBytes: copyArrayBuffer(env.encoded.idxBytes),
      dictBytes: new DataView(copyArrayBuffer(env.encoded.dictBytes)),
      synBytes: new Uint8Array(copyArrayBuffer(env.encoded.synBytes)),
      recipe: recipeFixture(),
      cryptoProvider: webcrypto
    });

    for (const name of ["manifest.json", "index.dat", "entries.dat"]) {
      assert.deepEqual(
        Buffer.from(browser.files[name]),
        await readFile(join(env.outDir, name)),
        name + " must match byte-for-byte"
      );
    }
    assert.deepEqual(browser.manifest, env.result.manifest);
    assert.deepEqual(browser.index, env.result.index);
    assert.deepEqual(browser.records, env.result.records);
  } finally {
    await cleanup(env);
  }
});

test("browser StarDict adapter rejects dictzip bytes until bounded browser decompression is enabled", async () => {
  const encoded = makeStarDict([
    ["alpha", "第一"]
  ]);
  await assert.rejects(
    buildStarDictPlainLocalTflex({
      ifoBytes: new TextEncoder().encode(encoded.ifoText),
      idxBytes: encoded.idxBytes,
      dictBytes: makeDictzip(encoded.dictBytes),
      synBytes: encoded.synBytes,
      recipe: recipeFixture(),
      cryptoProvider: webcrypto
    }),
    (error) =>
      error instanceof StarDictImportError &&
      error.code === STARDICT_IMPORT_ERROR.UNSUPPORTED &&
      /separate bounded browser decompression adapter/.test(error.message)
  );
});

test("browser StarDict import adapter forwards verified TFLex bytes into the local transaction", async () => {
  const encoded = makeStarDict([
    ["hello", "你好"],
    ["run", "运行"]
  ], [
    ["running", 1]
  ]);
  let received = null;
  const result = await importStarDictPlainDictionary({
    ifoBytes: new TextEncoder().encode(encoded.ifoText),
    idxBytes: encoded.idxBytes,
    dictBytes: encoded.dictBytes,
    synBytes: encoded.synBytes,
    recipe: recipeFixture(),
    requestId: "browser-import-1",
    cryptoProvider: webcrypto,
    async importTflex(input) {
      received = input;
      return { status: "imported" };
    }
  });

  assert.equal(received.requestId, "browser-import-1");
  const validated = await validateLocalTflexImport({
    files: received.files,
    cryptoProvider: webcrypto
  });
  assert.equal(validated.manifest.packId, "local-stardict-fixture");
  assert.equal(result.status, "imported");
  assert.equal(result.packId, "local-stardict-fixture");
  assert.equal(result.packVersion, "fixture-v1");
  assert.equal(result.sourceEntryCount, 2);
  assert.equal(result.sourceAliasCount, 1);
});

test("declared bilingual StarDict compiles deterministically to user-import-only opfs-indexed TFLex", async () => {
  const first = await buildFixture("deterministic-a");
  const second = await buildFixture("deterministic-b");

  assert.deepEqual(await snapshot(first.outDir), await snapshot(second.outDir));
  assert.equal(first.result.manifest.profile, "opfs-indexed-v1");
  assert.equal(first.result.manifest.distributionStatus, "user-import-only");
  assert.equal(first.result.manifest.semanticProfile, STARDICT_BILINGUAL_PROFILE);
  assert.equal(first.result.manifest.license.id, STARDICT_LOCAL_IMPORT_LICENSE_ID);
  assert.equal(first.result.manifest.recordCount, 3);
  assert.equal(first.result.manifest.sourceEntryCount, 4);
  assert.equal(first.result.manifest.sourceAliasCount, 2);
  assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    first.result.manifest.files.map((file) => [file.role, file.path]),
    [
      ["lexical-data", "entries.dat"],
      ["lookup-index", "index.dat"]
    ]
  );
  assert.equal(
    (await validateStarDictTflexPackOutput({ outDir: first.outDir })).validatedRecords,
    3
  );

  await cleanup(first, second);
});

test("StarDict compiler output passes the production local-import trust boundary", async () => {
  const env = await buildFixture("production-local-import");
  try {
    const validated = await validateLocalTflexImport({
      files: await readLocalTflexFiles(env.outDir),
      cryptoProvider: webcrypto
    });
    assert.equal(validated.manifest.packId, "local-stardict-fixture");
    assert.equal(validated.snapshot.packVersion, "fixture-v1");
    assert.equal(validated.snapshot.files.length, 3);
  } finally {
    await cleanup(env);
  }
});

test("StarDict dictzip and plain bodies compile to identical local TFLex output", async () => {
  const plain = await buildFixture("dictzip-plain");
  const zipped = await buildFixture("dictzip-zipped", { dictzip: true });
  try {
    assert.deepEqual(await snapshot(zipped.outDir), await snapshot(plain.outDir));
    assert.equal(zipped.result.projection.report.input.dictCompression, "dictzip");
    assert.equal(
      zipped.result.projection.report.input.dictBytes,
      zipped.encoded.dictBytes.byteLength
    );
    assert.equal(zipped.result.projection.report.input.dictzip.chunkCount, 1);
    assert.equal(zipped.result.report.importInput.dictCompression, "dictzip");
    assert.equal(zipped.result.report.importInput.dictzip.chunkCount, 1);
    assert.equal(
      zipped.result.report.importInput.dictBytes,
      zipped.encoded.dictBytes.byteLength
    );
  } finally {
    await cleanup(plain, zipped);
  }
});

test("StarDict semantic mapping preserves duplicate source rows as attributable lexical senses", () => {
  const recipe = recipeFixture();
  const records = buildStarDictTflexRecords([
    projectionRow("run", "跑", "idx:1", ["running"]),
    projectionRow("run", "运行", "idx:2", ["execute"]),
    projectionRow("session", "会话", "idx:3")
  ], recipe);

  const run = records.find((record) => record.lookupKey === "run");
  assert.ok(run);
  assert.equal(run.senses.length, 2);
  assert.deepEqual(run.senses.map((sense) => sense.translations), [["跑"], ["运行"]]);
  assert.deepEqual(run.senses.map((sense) => sense.sourceRefs[0].recordId), ["idx:1", "idx:2"]);
  assert.ok(run.senses.every((sense) => sense.sourceRefs[0].sourceId === "fixture-stardict"));
  assert.deepEqual(run.aliases, ["execute", "running"]);
});

test("StarDict TFLex POC reader feeds the existing Lexical Gateway candidate/provenance model", async () => {
  const env = await buildFixture("gateway");
  try {
    const reader = await createStarDictTflexPocReader({ packDir: env.outDir });
    const inspect = await reader.inspect();
    assert.equal(inspect.packId, "local-stardict-fixture");
    assert.equal(inspect.recordCount, 3);
    assert.equal(inspect.sources[0].licenseId, STARDICT_LOCAL_IMPORT_LICENSE_ID);

    const direct = await reader.lookupAll("run");
    assert.equal(direct.length, 1);
    assert.equal(direct[0].record.senses.length, 2);
    assert.equal(direct[0].matchedAlias, false);

    const alias = await reader.lookupAll("running");
    assert.equal(alias.length, 1);
    assert.equal(alias[0].record.lookupKey, "run");
    assert.equal(alias[0].matchedAlias, true);
    assert.equal(alias[0].aliasKey, "running");

    const gateway = createLexicalGateway({ packReaders: [reader] });
    const result = await gateway.lookup({
      text: "run",
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });

    assert.equal(result.status, "candidates");
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.translations),
      [["跑"], ["运行"]]
    );
    assert.ok(result.candidates.every(
      (candidate) => candidate.provenance.packId === "local-stardict-fixture"
    ));
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.provenance.sourceRefs[0].recordId),
      ["idx:3", "idx:4"]
    );
    assert.equal(reader.stats().productionRuntimeConnected, false);
  } finally {
    await cleanup(env);
  }
});

test("StarDict local TFLex output satisfies the existing optional-pack manifest health contract", async () => {
  const env = await buildFixture("pack-health");
  try {
    const files = {};
    for (const name of ["manifest.json", "index.dat", "entries.dat"]) {
      files[name] = new Uint8Array(await readFile(join(env.outDir, name)));
    }
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    const snapshotValue = {
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      fingerprint: manifest.fingerprint,
      files: [
        fileDescriptor("manifest", "manifest.json", files["manifest.json"]),
        ...manifest.files.map((file) => ({ ...file }))
      ]
    };
    const store = {
      async readFile(packId, version, path) {
        assert.equal(packId, manifest.packId);
        assert.equal(version, manifest.packVersion);
        if (!files[path]) throw new Error("missing fixture file: " + path);
        return files[path];
      }
    };

    const validated = await validateInstalledManifest({
      store,
      snapshot: snapshotValue,
      readerVersion: 1
    });
    assert.equal(validated.profile, "opfs-indexed-v1");
    assert.equal(validated.distributionStatus, "user-import-only");
    assert.equal(validated.semanticProfile, STARDICT_BILINGUAL_PROFILE);
  } finally {
    await cleanup(env);
  }
});

test("StarDict semantic mapping refuses inference without an explicit bilingual import recipe", () => {
  const base = recipeFixture();

  for (const changed of [
    { ...base, semanticProfile: "plain-text-v1" },
    { ...base, sourceLanguage: "auto" },
    { ...base, targetLanguage: "zh" },
    { ...base, packId: "official-looking-pack" },
    { ...base, assertions: { ...base.assertions, plainTextRepresentsTargetTranslation: false } },
    { ...base, assertions: { ...base.assertions, localUseOnly: false } }
  ]) {
    assert.throws(() => validateStarDictImportRecipe(changed));
  }
});

test("StarDict TFLex compiler binds the recipe to the selected dictionary bookname", async () => {
  const env = await fixtureFiles("bookname");
  try {
    const recipe = recipeFixture();
    recipe.dictionary.bookname = "Different Dictionary";
    await writeFile(env.recipePath, JSON.stringify(recipe));

    await assert.rejects(
      compileTflexStarDictImport({
        ifoPath: env.ifoPath,
        idxPath: env.idxPath,
        dictPath: env.dictPath,
        synPath: env.synPath,
        recipePath: env.recipePath,
        outDir: env.outDir
      }),
      /recipe bookname mismatch/
    );
  } finally {
    await cleanup(env);
  }
});

test("StarDict local TFLex validation detects entry tampering", async () => {
  const env = await buildFixture("tamper");
  try {
    await writeFile(join(env.outDir, "entries.dat"), "tampered\n", "utf8");
    await assert.rejects(
      validateStarDictTflexPackOutput({ outDir: env.outDir }),
      /descriptor mismatch|record hash mismatch/
    );
  } finally {
    await cleanup(env);
  }
});

async function buildFixture(name, options) {
  const env = await fixtureFiles(name, options);
  const result = await compileTflexStarDictImport({
    ifoPath: env.ifoPath,
    idxPath: env.idxPath,
    dictPath: env.dictPath,
    synPath: env.synPath,
    recipePath: env.recipePath,
    outDir: env.outDir,
    reportPath: env.reportPath
  });
  return { ...env, result };
}

async function fixtureFiles(name, { dictzip = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-stardict-tflex-" + name + "-"));
  const entries = [
    ["hello", "你好"],
    ["persistent", "持久的"],
    ["run", "跑"],
    ["run", "运行"]
  ];
  const encoded = makeStarDict(entries, [
    ["lasting", 1],
    ["running", 2]
  ]);
  const ifoPath = join(root, "fixture.ifo");
  const idxPath = join(root, "fixture.idx");
  const dictPath = join(root, dictzip ? "fixture.dict.dz" : "fixture.dict");
  const synPath = join(root, "fixture.syn");
  const recipePath = join(root, "recipe.json");
  const outDir = join(root, "out");
  const reportPath = join(root, "report.json");

  await Promise.all([
    writeFile(ifoPath, encoded.ifoText),
    writeFile(idxPath, encoded.idxBytes),
    writeFile(dictPath, dictzip ? makeDictzip(encoded.dictBytes) : encoded.dictBytes),
    writeFile(synPath, encoded.synBytes),
    writeFile(recipePath, JSON.stringify(recipeFixture()))
  ]);
  return { root, ifoPath, idxPath, dictPath, synPath, recipePath, outDir, reportPath, encoded };
}

function recipeFixture() {
  return {
    schemaVersion: 1,
    semanticProfile: STARDICT_BILINGUAL_PROFILE,
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

function projectionRow(word, translation, recordId, aliases) {
  return {
    lookupKey: word,
    exactLookupKey: word,
    displayForm: word,
    plainText: translation,
    ...(aliases?.length ? { aliases } : {}),
    sourceRef: {
      sourceId: "fixture-stardict",
      recordId
    }
  };
}

function makeStarDict(entries, synonyms = []) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const dictChunks = [];
  const idxChunks = [];
  let offset = 0;
  for (const [word, text] of sorted) {
    const wordBytes = Buffer.from(word, "utf8");
    const payload = Buffer.from(text, "utf8");
    const numbers = Buffer.alloc(8);
    numbers.writeUInt32BE(offset, 0);
    numbers.writeUInt32BE(payload.byteLength, 4);
    idxChunks.push(wordBytes, Buffer.from([0]), numbers);
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
      ...(synonyms.length ? ["synwordcount=" + synonyms.length] : []),
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
    const wordBytes = Buffer.from(word, "utf8");
    const target = Buffer.alloc(4);
    target.writeUInt32BE(targetIndex, 0);
    chunks.push(wordBytes, Buffer.from([0]), target);
  }
  return Buffer.concat(chunks);
}

function makeDictzip(input) {
  const gzip = gzipSync(Buffer.from(input));
  const compressedChunkBytes = gzip.byteLength - 18;
  if (compressedChunkBytes <= 0 || compressedChunkBytes > 0xffff) {
    throw new Error("dictzip test fixture compressed chunk does not fit uint16");
  }
  const raPayload = Buffer.alloc(8);
  raPayload.writeUInt16LE(1, 0);
  raPayload.writeUInt16LE(0xffff, 2);
  raPayload.writeUInt16LE(1, 4);
  raPayload.writeUInt16LE(compressedChunkBytes, 6);
  const raLength = Buffer.alloc(2);
  raLength.writeUInt16LE(raPayload.byteLength, 0);
  const extra = Buffer.concat([Buffer.from("RA", "ascii"), raLength, raPayload]);
  const extraLength = Buffer.alloc(2);
  extraLength.writeUInt16LE(extra.byteLength, 0);
  const header = Buffer.from(gzip.subarray(0, 10));
  header[3] |= 0x04;
  return Buffer.concat([header, extraLength, extra, gzip.subarray(10)]);
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

function fileDescriptor(role, path, bytes) {
  return {
    role,
    path,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function readLocalTflexFiles(root) {
  return {
    "manifest.json": new Uint8Array(await readFile(join(root, "manifest.json"))),
    "index.dat": new Uint8Array(await readFile(join(root, "index.dat"))),
    "entries.dat": new Uint8Array(await readFile(join(root, "entries.dat")))
  };
}

async function snapshot(root) {
  const result = {};
  for (const entry of (await readdir(root, { withFileTypes: true }))
    .filter((item) => item.isFile())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    result[entry.name] = await readFile(join(root, entry.name), "utf8");
  }
  return result;
}

async function cleanup(...environments) {
  for (const env of environments) {
    if (env?.root) await rm(env.root, { recursive: true, force: true });
  }
}
