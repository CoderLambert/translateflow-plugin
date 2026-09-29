import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { buildIndexedData } from "../scripts/build-tflex-freedict.mjs";
import {
  createOpfsIndexedTflexReader,
  validateIndexedIndex
} from "../src/background/lexical/opfs-indexed-reader.js";
import { LEXICAL_ERROR_CODES } from "../src/shared/lexical.js";

const encoder = new TextEncoder();

test("OPFS indexed reader resolves canonical and alias lookups with range reads only", async () => {
  const env = await fixtureEnvironment();
  const reader = createOpfsIndexedTflexReader({
    store: env.store,
    snapshot: env.snapshot,
    cryptoProvider: webcrypto
  });

  const direct = await reader.lookupAll("run");
  assert.equal(direct.length, 1);
  assert.equal(direct[0].record.lookupKey, "run");
  assert.equal(direct[0].matchedAlias, false);
  assert.equal(direct[0].exactCaseMatch, true);

  const alias = await reader.lookupAll("running");
  assert.equal(alias.length, 1);
  assert.equal(alias[0].record.lookupKey, "run");
  assert.equal(alias[0].matchedAlias, true);
  assert.equal(alias[0].aliasKey, "running");

  assert.equal(env.stats.fullEntryReads, 0);
  assert.equal(env.stats.indexReads, 1);
  assert.equal(env.stats.rangeReads, 1, "canonical + alias target should reuse the cached record slice");

  const metadata = await reader.inspect();
  assert.equal(metadata.packId, env.manifest.packId);
  assert.equal(metadata.profile, undefined);
  assert.equal(metadata.distributionStatus, "user-import-only");
  assert.equal(metadata.sources[0].licenseId, "USER-PROVIDED-UNVERIFIED");
});

test("OPFS indexed reader preserves ambiguous aliases without scanning entries.dat", async () => {
  const env = await fixtureEnvironment({
    records: [
      record("persistent", "持久的", ["stateful"]),
      record("session", "会话", ["stateful"])
    ]
  });
  const reader = createOpfsIndexedTflexReader({
    store: env.store,
    snapshot: env.snapshot,
    cryptoProvider: webcrypto
  });

  const hits = await reader.lookupAll("stateful");
  assert.deepEqual(hits.map((hit) => hit.record.lookupKey), ["persistent", "session"]);
  assert.ok(hits.every((hit) => hit.matchedAlias));
  assert.equal(env.stats.fullEntryReads, 0);
  assert.equal(env.stats.rangeReads, 2);
});

test("OPFS indexed reader detects corrupted targeted record bytes", async () => {
  const env = await fixtureEnvironment();
  const reader = createOpfsIndexedTflexReader({
    store: env.store,
    snapshot: env.snapshot,
    cryptoProvider: webcrypto
  });
  env.corruptRanges = true;

  await assert.rejects(
    reader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT &&
      /slice hash mismatch/.test(error.message)
  );
  assert.equal(env.stats.fullEntryReads, 0);
});

test("OPFS indexed reader verifies manifest and index bytes against the active snapshot", async () => {
  const manifestEnv = await fixtureEnvironment();
  manifestEnv.files["manifest.json"] = new Uint8Array(manifestEnv.files["manifest.json"]);
  manifestEnv.files["manifest.json"][0] ^= 1;
  const manifestReader = createOpfsIndexedTflexReader({
    store: manifestEnv.store,
    snapshot: manifestEnv.snapshot,
    cryptoProvider: webcrypto
  });
  await assert.rejects(
    manifestReader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT &&
      /file hash mismatch/.test(error.message)
  );

  const indexEnv = await fixtureEnvironment();
  indexEnv.files["index.dat"] = new Uint8Array(indexEnv.files["index.dat"]);
  indexEnv.files["index.dat"][0] ^= 1;
  const indexReader = createOpfsIndexedTflexReader({
    store: indexEnv.store,
    snapshot: indexEnv.snapshot,
    cryptoProvider: webcrypto
  });
  await assert.rejects(
    indexReader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT &&
      /file hash mismatch/.test(error.message)
  );
});

test("OPFS indexed reader classifies hash-valid malformed manifest JSON as corrupt", async () => {
  const env = await fixtureEnvironment();
  const malformed = encoder.encode("{");
  env.files["manifest.json"] = malformed;
  const descriptor = env.snapshot.files.find((file) => file.role === "manifest");
  descriptor.size = malformed.byteLength;
  descriptor.sha256 = sha256(malformed);

  const reader = createOpfsIndexedTflexReader({
    store: env.store,
    snapshot: env.snapshot,
    cryptoProvider: webcrypto
  });
  await assert.rejects(
    reader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT &&
      /manifest JSON is malformed/.test(error.message)
  );
});

test("OPFS indexed reader maps pack compatibility/storage failures to lexical errors", async () => {
  const incompatibleEnv = await fixtureEnvironment({ readerMinVersion: 2 });
  const incompatibleReader = createOpfsIndexedTflexReader({
    store: incompatibleEnv.store,
    snapshot: incompatibleEnv.snapshot,
    cryptoProvider: webcrypto,
    readerVersion: 1
  });
  await assert.rejects(
    incompatibleReader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.INCOMPATIBLE
  );

  const storageEnv = await fixtureEnvironment();
  storageEnv.failReads = true;
  const storageReader = createOpfsIndexedTflexReader({
    store: storageEnv.store,
    snapshot: storageEnv.snapshot,
    cryptoProvider: webcrypto
  });
  await assert.rejects(
    storageReader.lookup("run"),
    (error) => error?.code === LEXICAL_ERROR_CODES.STORAGE
  );
});

test("indexed metadata validation rejects aliases without canonical targets and out-of-bounds slices", async () => {
  const env = await fixtureEnvironment();
  const malformedAlias = structuredClone(env.index);
  const aliasItem = malformedAlias.entries.find((item) => item.key === "running");
  aliasItem.targets[0].lookupKey = "missing";
  assert.throws(
    () => validateIndexedIndex(malformedAlias, env.manifest, env.entriesDescriptor),
    /alias target has no canonical record/
  );

  const malformedRange = structuredClone(env.index);
  const canonical = malformedRange.entries.find((item) => item.key === "run");
  canonical.targets[0].offset = env.entriesDescriptor.size;
  assert.throws(
    () => validateIndexedIndex(malformedRange, env.manifest, env.entriesDescriptor),
    /target is malformed/
  );
});

test("OPFS indexed reader cache remains byte bounded", async () => {
  const env = await fixtureEnvironment();
  const reader = createOpfsIndexedTflexReader({
    store: env.store,
    snapshot: env.snapshot,
    cryptoProvider: webcrypto,
    cacheMaxEntries: 1,
    cacheMaxBytes: 1024
  });

  await reader.lookup("persistent");
  await reader.lookup("run");
  const stats = reader.stats().cache;
  assert.ok(stats.entries <= 1);
  assert.ok(stats.bytes <= 1024);
});

async function fixtureEnvironment({
  records = [
    record("persistent", "持久的"),
    record("run", "运行", ["running"])
  ],
  readerMinVersion = 1
} = {}) {
  const indexed = buildIndexedData(records);
  const indexBytes = encoder.encode(indexed.indexText);
  const entriesBytes = encoder.encode(indexed.entriesText);
  const packId = "local-runtime-fixture";
  const packVersion = "fixture-v1";
  const fingerprint = "sha256:" + "a".repeat(64);
  const indexDescriptor = {
    role: "lookup-index",
    path: "index.dat",
    size: indexBytes.byteLength,
    sha256: sha256(indexBytes)
  };
  const entriesDescriptor = {
    role: "lexical-data",
    path: "entries.dat",
    size: entriesBytes.byteLength,
    sha256: sha256(entriesBytes)
  };
  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion,
    normalizationVersion: 1,
    profile: "opfs-indexed-v1",
    packId,
    packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    distributionStatus: "user-import-only",
    fingerprint,
    recordCount: records.length,
    sources: [{
      id: "fixture-source",
      version: "fixture-v1",
      provenance: "test-only source",
      license: { id: "USER-PROVIDED-UNVERIFIED" }
    }],
    files: [entriesDescriptor, indexDescriptor]
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const manifestDescriptor = {
    role: "manifest",
    path: "manifest.json",
    size: manifestBytes.byteLength,
    sha256: sha256(manifestBytes)
  };
  const snapshot = {
    packId,
    packVersion,
    fingerprint,
    files: [manifestDescriptor, indexDescriptor, entriesDescriptor]
  };
  const files = {
    "manifest.json": manifestBytes,
    "index.dat": indexBytes,
    "entries.dat": entriesBytes
  };
  const stats = { indexReads: 0, fullEntryReads: 0, rangeReads: 0 };
  const env = {
    manifest,
    snapshot,
    index: indexed.index,
    entriesDescriptor,
    files,
    stats,
    corruptRanges: false,
    failReads: false
  };
  env.store = {
    async readFile(readPackId, readVersion, path) {
      assert.equal(readPackId, packId);
      assert.equal(readVersion, packVersion);
      if (env.failReads) {
        const error = new Error("fixture storage failure");
        error.code = "PACK_STORAGE";
        throw error;
      }
      if (path === "index.dat") stats.indexReads += 1;
      if (path === "entries.dat") stats.fullEntryReads += 1;
      const value = files[path];
      if (!value) throw new Error("missing fixture file: " + path);
      return new Uint8Array(value);
    },
    async readFileRange(readPackId, readVersion, path, offset, length) {
      assert.equal(readPackId, packId);
      assert.equal(readVersion, packVersion);
      assert.equal(path, "entries.dat");
      stats.rangeReads += 1;
      let value = files[path].slice(offset, offset + length);
      if (env.corruptRanges) {
        value = new Uint8Array(value);
        value[0] ^= 1;
      }
      return new Uint8Array(value);
    }
  };
  return env;
}

function record(lookupKey, translation, aliases = []) {
  return {
    lookupKey,
    exactLookupKeys: [lookupKey],
    displayForm: lookupKey,
    kind: "lexical",
    aliases,
    senses: [{
      id: "fixture:" + lookupKey,
      translations: [translation],
      domains: [],
      sourceRefs: [{ sourceId: "fixture-source", recordId: lookupKey }]
    }]
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
