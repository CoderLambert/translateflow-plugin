import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import {
  MDICT_BILINGUAL_PROFILE,
  MDICT_LOCAL_IMPORT_LICENSE_ID,
  buildMdictTflexRecords,
  compileTflexMdictImport,
  createMdictTflexPocReader,
  validateMdictImportRecipe,
  validateMdictTflexPackOutput
} from "../scripts/build-tflex-mdict-import.mjs";
import { adler32 } from "../scripts/project-mdict-import.mjs";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { validateInstalledManifest } from "../src/background/packs/health.js";
import { validateLocalTflexImport } from "../src/background/packs/local-import.js";

test("declared bilingual MDict compiles deterministically to user-import-only opfs-indexed TFLex", async () => {
  const first = await buildFixture("deterministic-a");
  const second = await buildFixture("deterministic-b");
  try {
    assert.deepEqual(await snapshot(first.outDir), await snapshot(second.outDir));
    assert.equal(first.result.manifest.profile, "opfs-indexed-v1");
    assert.equal(first.result.manifest.distributionStatus, "user-import-only");
    assert.equal(first.result.manifest.semanticProfile, MDICT_BILINGUAL_PROFILE);
    assert.equal(first.result.manifest.license.id, MDICT_LOCAL_IMPORT_LICENSE_ID);
    assert.equal(first.result.manifest.recordCount, 3);
    assert.equal(first.result.manifest.sourceEntryCount, 4);
    assert.equal(first.result.manifest.sourceFileSha256, first.mdxSha256);
    assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(
      first.result.manifest.files.map((file) => [file.role, file.path]),
      [
        ["lexical-data", "entries.dat"],
        ["lookup-index", "index.dat"]
      ]
    );
    assert.equal(
      (await validateMdictTflexPackOutput({ outDir: first.outDir })).validatedRecords,
      3
    );
  } finally {
    await cleanup(first, second);
  }
});

test("MDict compiler output passes the production local-import trust boundary", async () => {
  const env = await buildFixture("production-local-import");
  try {
    const validated = await validateLocalTflexImport({
      files: await readLocalTflexFiles(env.outDir),
      cryptoProvider: webcrypto
    });
    assert.equal(validated.manifest.packId, "local-mdict-fixture");
    assert.equal(validated.snapshot.packVersion, "fixture-v1");
    assert.equal(validated.snapshot.files.length, 3);
  } finally {
    await cleanup(env);
  }
});

test("MDict semantic mapping preserves duplicate source rows as attributable lexical senses", () => {
  const recipe = recipeFixture("0".repeat(64));
  const records = buildMdictTflexRecords([
    projectionRow("run", "跑", "entry:1"),
    projectionRow("run", "运行", "entry:2"),
    projectionRow("session", "会话", "entry:3")
  ], recipe);

  const run = records.find((record) => record.lookupKey === "run");
  assert.ok(run);
  assert.equal(run.senses.length, 2);
  assert.deepEqual(run.senses.map((sense) => sense.translations), [["跑"], ["运行"]]);
  assert.deepEqual(run.senses.map((sense) => sense.sourceRefs[0].recordId), ["entry:1", "entry:2"]);
  assert.ok(run.senses.every((sense) => sense.sourceRefs[0].sourceId === "fixture-mdict"));
  assert.deepEqual(run.aliases, []);
});

test("MDict TFLex reader feeds the existing Lexical Gateway candidate/provenance model", async () => {
  const env = await buildFixture("gateway");
  try {
    const reader = await createMdictTflexPocReader({ packDir: env.outDir });
    const inspect = await reader.inspect();
    assert.equal(inspect.packId, "local-mdict-fixture");
    assert.equal(inspect.recordCount, 3);
    assert.equal(inspect.sources[0].licenseId, MDICT_LOCAL_IMPORT_LICENSE_ID);

    const direct = await reader.lookupAll("run");
    assert.equal(direct.length, 1);
    assert.equal(direct[0].record.senses.length, 2);
    assert.equal(direct[0].matchedAlias, false);

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
      (candidate) => candidate.provenance.packId === "local-mdict-fixture"
    ));
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.provenance.sourceRefs[0].recordId),
      ["entry:3", "entry:4"]
    );
    assert.equal(reader.stats().productionRuntimeConnected, false);
  } finally {
    await cleanup(env);
  }
});

test("MDict local TFLex output satisfies the existing optional-pack manifest health contract", async () => {
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
    assert.equal(validated.semanticProfile, MDICT_BILINGUAL_PROFILE);
  } finally {
    await cleanup(env);
  }
});

test("MDict semantic mapping refuses inference without an explicit bilingual recipe", () => {
  const base = recipeFixture("0".repeat(64));
  for (const changed of [
    { ...base, semanticProfile: "plain-text-v1" },
    { ...base, sourceLanguage: "auto" },
    { ...base, targetLanguage: "zh" },
    { ...base, packId: "official-looking-pack" },
    { ...base, dictionary: { ...base.dictionary, generatedByEngineVersion: "3.0" } },
    { ...base, dictionary: { ...base.dictionary, encoding: "GBK" } },
    { ...base, dictionary: { ...base.dictionary, format: "Html" } },
    { ...base, dictionary: { ...base.dictionary, mdxSha256: "ABC" } },
    { ...base, assertions: { ...base.assertions, plainTextRepresentsTargetTranslation: false } },
    { ...base, assertions: { ...base.assertions, localUseOnly: false } }
  ]) {
    assert.throws(() => validateMdictImportRecipe(changed));
  }
});

test("MDict compiler binds recipe to exact selected MDX hash and metadata", async () => {
  const env = await fixtureFiles("recipe-binding");
  try {
    const wrongHash = recipeFixture("f".repeat(64));
    await writeFile(env.recipePath, JSON.stringify(wrongHash));
    await assert.rejects(
      compileTflexMdictImport({
        mdxPath: env.mdxPath,
        recipePath: env.recipePath,
        outDir: env.outDir
      }),
      /mdxSha256 mismatch/
    );

    const wrongTitle = recipeFixture(env.mdxSha256);
    wrongTitle.dictionary.title = "Different Dictionary";
    await writeFile(env.recipePath, JSON.stringify(wrongTitle));
    await assert.rejects(
      compileTflexMdictImport({
        mdxPath: env.mdxPath,
        recipePath: env.recipePath,
        outDir: env.outDir
      }),
      /recipe title mismatch/
    );
  } finally {
    await cleanup(env);
  }
});

test("MDict local TFLex validation detects entry tampering", async () => {
  const env = await buildFixture("tamper");
  try {
    await writeFile(join(env.outDir, "entries.dat"), "tampered\n", "utf8");
    await assert.rejects(
      validateMdictTflexPackOutput({ outDir: env.outDir }),
      /descriptor mismatch|record hash mismatch/
    );
  } finally {
    await cleanup(env);
  }
});

async function buildFixture(name) {
  const env = await fixtureFiles(name);
  const result = await compileTflexMdictImport({
    mdxPath: env.mdxPath,
    recipePath: env.recipePath,
    outDir: env.outDir,
    reportPath: env.reportPath
  });
  return { ...env, result };
}

async function fixtureFiles(name) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-mdict-tflex-" + name + "-"));
  const mdxBytes = makeMdx([
    ["hello", "你好"],
    ["persistent", "持久的"],
    ["run", "跑"],
    ["run", "运行"]
  ]);
  const mdxSha256 = sha256Bytes(mdxBytes);
  const mdxPath = join(root, "fixture.mdx");
  const recipePath = join(root, "recipe.json");
  const outDir = join(root, "out");
  const reportPath = join(root, "report.json");
  await Promise.all([
    writeFile(mdxPath, mdxBytes),
    writeFile(recipePath, JSON.stringify(recipeFixture(mdxSha256)))
  ]);
  return { root, mdxPath, mdxSha256, recipePath, outDir, reportPath };
}

function recipeFixture(mdxSha256) {
  return {
    schemaVersion: 1,
    semanticProfile: MDICT_BILINGUAL_PROFILE,
    packId: "local-mdict-fixture",
    packVersion: "fixture-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      title: "Safe Fixture",
      generatedByEngineVersion: "2.0",
      encoding: "UTF-8",
      format: "Text",
      sourceId: "fixture-mdict",
      sourceVersion: "fixture-v1",
      mdxSha256
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

function projectionRow(word, translation, recordId) {
  return {
    lookupKey: word,
    exactLookupKey: word,
    displayForm: word,
    plainText: translation,
    sourceRef: {
      sourceId: "fixture-mdict",
      recordId
    }
  };
}

function makeMdx(entries) {
  const codec = {
    unitBytes: 1,
    encode(value) {
      return Buffer.from(String(value), "utf8");
    }
  };
  const recordParts = [];
  const offsets = [];
  let recordOffset = 0;
  for (const [, definition] of entries) {
    offsets.push(recordOffset);
    const record = Buffer.concat([codec.encode(definition), Buffer.alloc(1)]);
    recordParts.push(record);
    recordOffset += record.byteLength;
  }

  const keyRawParts = [];
  for (let index = 0; index < entries.length; index += 1) {
    keyRawParts.push(
      u64be(offsets[index]),
      codec.encode(entries[index][0]),
      Buffer.alloc(1)
    );
  }
  const keyBlockRaw = Buffer.concat(keyRawParts);
  const keyBlock = wrapBlock(keyBlockRaw);

  const firstKeyBytes = codec.encode(entries[0][0]);
  const lastKeyBytes = codec.encode(entries[entries.length - 1][0]);
  const keyIndexRaw = Buffer.concat([
    u64be(entries.length),
    u16be(firstKeyBytes.byteLength),
    firstKeyBytes,
    Buffer.alloc(1),
    u16be(lastKeyBytes.byteLength),
    lastKeyBytes,
    Buffer.alloc(1),
    u64be(keyBlock.byteLength),
    u64be(keyBlockRaw.byteLength)
  ]);
  const keyIndexBlock = wrapBlock(keyIndexRaw);
  const keyPreamble = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(keyIndexRaw.byteLength),
    u64be(keyIndexBlock.byteLength),
    u64be(keyBlock.byteLength)
  ]);

  const recordRaw = Buffer.concat(recordParts);
  const recordBlock = wrapBlock(recordRaw);
  const recordHeader = Buffer.concat([
    u64be(1),
    u64be(entries.length),
    u64be(16),
    u64be(recordBlock.byteLength),
    u64be(recordBlock.byteLength),
    u64be(recordRaw.byteLength)
  ]);

  const headerText = [
    '<Dictionary',
    ' GeneratedByEngineVersion="2.0"',
    ' RequiredEngineVersion="2.0"',
    ' Encrypted="0"',
    ' Encoding="UTF-8"',
    ' Format="Text"',
    ' Compact="No"',
    ' Compat="No"',
    ' KeyCaseSensitive="No"',
    ' Description="Safe fixture"',
    ' Title="Safe Fixture"',
    ' StyleSheet=""',
    '/>\r\n\u0000'
  ].join("");
  const headerBytes = Buffer.from(headerText, "utf16le");

  return Buffer.concat([
    u32be(headerBytes.byteLength),
    headerBytes,
    u32le(adler32(headerBytes)),
    keyPreamble,
    u32be(adler32(keyPreamble)),
    keyIndexBlock,
    keyBlock,
    recordHeader,
    recordBlock
  ]);
}

function wrapBlock(rawInput) {
  const raw = Buffer.from(rawInput);
  const header = Buffer.alloc(8);
  header[0] = 2;
  header.writeUInt32BE(adler32(raw), 4);
  return Buffer.concat([header, deflateSync(raw)]);
}

function u16be(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value, 0);
  return bytes;
}

function u32be(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value >>> 0, 0);
  return bytes;
}

function u32le(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0, 0);
  return bytes;
}

function u64be(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value), 0);
  return bytes;
}

function fileDescriptor(role, path, bytes) {
  return {
    role,
    path,
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes)
  };
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
