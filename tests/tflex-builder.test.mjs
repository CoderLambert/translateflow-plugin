import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { webcrypto } from "node:crypto";
import {
  writeTflexPack, normalizeExactLookupKey, normalizeLookupKey,
  validateTflexRecords, validateTflexOutput
} from "../scripts/tflex-writer.mjs";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";

const source = {
  id: "user-fixture", version: "1", provenance: "Synthetic test data",
  data: { url: "fixture://dictionary", sha256: "a".repeat(64) },
  license: { id: "TEST", name: "Test fixture", source: "fixture://license", notice: "Synthetic test data only." }
};
const records = ["alpha", "beta", "gamma"].map((key) => ({
  lookupKey: key, displayForm: key, exactLookupKeys: [key], kind: "lexical", aliases: [],
  sourceForms: [key], sourceRefs: [{ sourceId: source.id, recordId: key }],
  senses: [1, 2].map((number) => ({
    id: key + ":" + number, partOfSpeech: "noun", translations: ["测试" + number],
    senseNumber: number, tagCount: 3 - number,
    sourceRefs: [{ sourceId: source.id, recordId: key + ":" + number }]
  }))
}));

async function build(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-writer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outDir = join(root, "out");
  const result = await writeTflexPack({ records, sources: [source], packId: "user-fixture", packVersion: "1", outDir, maxShardBytes: 1000, ...options });
  return { root, outDir, result };
}

async function snapshotDir(root, relative = "") {
  const result = {};
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshotDir(root, rel));
    else result[rel.replaceAll("\\", "/")] = await readFile(join(root, rel), "utf8");
  }
  return result;
}

test("generic TFLex writer emits deterministic bounded attributable user packs", async (t) => {
  const first = await build(t);
  const second = await build(t, { records: [...records].reverse() });
  assert.deepEqual(await snapshotDir(first.outDir), await snapshotDir(second.outDir));
  assert.equal(first.result.manifest.profile, "bundled-sharded-v1");
  assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(first.result.directory.shards.length >= 2);
  assert.ok(first.result.directory.shards.every((shard) => shard.size <= 1000));
  assert.ok(first.result.manifest.files.some((file) => file.role === "license-notice"));
  assert.equal((await validateTflexOutput({ outDir: first.outDir })).recordCount, records.length);
  const reader = createTflexReader({ packBasePath: "fixture", cryptoProvider: webcrypto,
    readBytes: async (path) => new Uint8Array(await readFile(join(first.outDir, path.replace(/^fixture\//u, "")))) });
  const result = await reader.lookup("alpha");
  assert.equal(result.pack.packId, "user-fixture");
  assert.deepEqual(result.record.senses, records[0].senses);
  assert.equal(await reader.lookup("absent"), null);
});

test("generic TFLex normalization and shard budget retain their compatibility identity", async (t) => {
  assert.equal(normalizeExactLookupKey("  C#   Runtime  "), "C# Runtime");
  assert.equal(normalizeLookupKey("  C#   Runtime  "), "c# runtime");
  const small = await build(t);
  const large = await build(t, { maxShardBytes: 64000 });
  assert.notEqual(small.result.manifest.fingerprint, large.result.manifest.fingerprint);
  assert.deepEqual(small.result.manifest.profileOptions, { maxShardBytes: 1000 });
});

test("TFLex writer refuses to delete existing output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-safe-out-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outDir = join(root, "out");
  await mkdir(outDir);
  await writeFile(join(outDir, "keep.txt"), "keep");
  await assert.rejects(writeTflexPack({ records, sources: [source], packId: "fixture", packVersion: "1", outDir }), /output directory must be empty/u);
  assert.equal(await readFile(join(outDir, "keep.txt"), "utf8"), "keep");
});

test("TFLex record validation rejects duplicate keys and executable markup", () => {
  assert.throws(() => validateTflexRecords([records[0], records[0]]), /duplicate TFLex lookup key/u);
  assert.throws(() => validateTflexRecords([{ ...records[0], displayForm: "<b>unsafe</b>" }]), /HTML-like markup/u);
});

for (const [name, mutate, expected] of [
  ["reader compatibility", (manifest) => { manifest.readerMinVersion = 2; }, /incompatible TFLex reader version/u],
  ["fingerprint", (manifest) => { manifest.packVersion += "-tampered"; }, /manifest fingerprint mismatch/u],
  ["duplicate sources", (manifest) => { manifest.sources.push(manifest.sources[0]); }, /duplicate manifest source/u]
]) test("TFLex output validation rejects " + name + " corruption", async (t) => {
  const built = await build(t);
  const path = join(built.outDir, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  mutate(manifest);
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(validateTflexOutput({ outDir: built.outDir }), expected);
});

test("TFLex output validation verifies shard bytes", async (t) => {
  const built = await build(t);
  const shard = join(built.outDir, built.result.directory.shards[0].path);
  await writeFile(shard, (await readFile(shard, "utf8")) + " ");
  await assert.rejects(validateTflexOutput({ outDir: built.outDir }), /file size mismatch|file hash mismatch/u);
});

test("TFLex writer rejects missing license evidence", async (t) => {
  await assert.rejects(build(t, { sources: [{ ...source, license: { ...source.license, notice: "" } }] }), /source license notice/u);
});

test("generic sharded writer preserves caller-supplied concept records and alias policy", async (t) => {
  const concept = { lookupKey: "example concept", displayForm: "Example concept", exactLookupKeys: ["Example concept"],
    kind: "technical-concept", translations: ["示例概念"], typeLabels: ["concept"],
    sourceRefs: [{ sourceId: source.id, recordId: "concept" }] };
  const aliases = [{ key: "ec", caseSensitive: true, exactLookupKeys: ["EC"], targets: ["example concept"] }];
  const built = await build(t, { records: [concept], aliases });
  const reader = createTflexReader({ packBasePath: "fixture", cryptoProvider: webcrypto,
    readBytes: async (path) => new Uint8Array(await readFile(join(built.outDir, path.replace(/^fixture\//u, "")))) });
  assert.equal((await reader.lookup("EC")).record.kind, "technical-concept");
  assert.equal(await reader.lookup("ec"), null);
  assert.deepEqual(built.result.directory.aliases, aliases);
});
