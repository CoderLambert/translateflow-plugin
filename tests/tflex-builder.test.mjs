import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  compileTflexCore,
  normalizeEnglishDisplay,
  normalizeExactLookupKey,
  normalizeLookupKey,
  validateCoreRecords,
  validateSourceLock,
  validateTflexCoreOutput
} from "../scripts/build-tflex-core.mjs";

const fixtureRoot = new URL("./fixtures/tflex-core/", import.meta.url);

async function build(name, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-" + name + "-"));
  const outDir = join(root, "out");
  const result = await compileTflexCore({
    englishPath: fileURLToPath(new URL("wn-data-eng.tab", fixtureRoot)),
    chinesePath: fileURLToPath(new URL("wn-data-cmn.tab", fixtureRoot)),
    sourceLockPath: fileURLToPath(new URL("source-lock.json", fixtureRoot)),
    outDir,
    maxShardBytes: options.maxShardBytes || 900
  });
  return { root, outDir, result };
}

async function snapshotDir(root, relative = "") {
  const path = join(root, relative);
  const entries = await readdir(path, { withFileTypes: true });
  const result = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) Object.assign(result, await snapshotDir(root, rel));
    else result[rel.replaceAll("\\", "/")] = await readFile(join(root, rel), "utf8");
  }
  return result;
}

test("TFLex compiler is deterministic and emits bounded attributable artifacts", async () => {
  const first = await build("a");
  const second = await build("b");
  assert.deepEqual(await snapshotDir(first.outDir), await snapshotDir(second.outDir));
  assert.equal(first.result.manifest.format, "tflex");
  assert.equal(first.result.manifest.formatVersion, 1);
  assert.equal(first.result.manifest.readerMinVersion, 1);
  assert.equal(first.result.manifest.compilerVersion, 1);
  assert.equal(first.result.manifest.normalizationVersion, 1);
  assert.equal(first.result.manifest.profile, "bundled-sharded-v1");
  assert.deepEqual(first.result.manifest.profileOptions, { maxShardBytes: 900 });
  assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.result.directory.shards.length >= 2);
  assert.ok(first.result.directory.shards.every((shard) => shard.size <= 900));
  assert.ok(first.result.manifest.files.some((file) => file.role === "license-notice"));
  assert.ok(first.result.manifest.sources.every((source) => source.dataSha256));
  const validated = await validateTflexCoreOutput({ outDir: first.outDir, readerVersion: 1 });
  assert.equal(validated.recordCount, first.result.manifest.recordCount);
});

test("TFLex compiler preserves polysemy, source forms and display normalization", async () => {
  const { result } = await build("polysemy");
  const persistent = result.records.find((record) => record.lookupKey === "persistent");
  assert.ok(persistent);
  assert.equal(persistent.displayForm, "Persistent");
  assert.deepEqual(persistent.exactLookupKeys, ["Persistent"]);
  assert.deepEqual(persistent.sourceForms, ["Persistent"]);
  assert.deepEqual(persistent.senses.map((sense) => sense.id), [
    "pwn3:00000001-a",
    "pwn3:00000007-a"
  ]);
  assert.deepEqual(persistent.senses[0].translations, ["持久的", "持续的"]);
  assert.deepEqual(persistent.senses[0].rawTranslations, ["持久+的", "持续+的"]);
  const phrase = result.records.find((record) => record.lookupKey === "terminal multiplexer");
  assert.equal(phrase.displayForm, "terminal multiplexer");
  assert.equal(phrase.senses[0].partOfSpeech, "noun");
  assert.equal(normalizeEnglishDisplay(" Terminal_Multiplexer "), "Terminal Multiplexer");
  assert.equal(normalizeExactLookupKey("  C#   Runtime  "), "C# Runtime");
  assert.equal(normalizeLookupKey("  C#   Runtime  "), "c# runtime");
});

test("TFLex compiler records the effective shard budget in build identity", async () => {
  const small = await build("budget-small", { maxShardBytes: 900 });
  const large = await build("budget-large", { maxShardBytes: 64 * 1024 });
  assert.deepEqual(small.result.manifest.profileOptions, { maxShardBytes: 900 });
  assert.deepEqual(large.result.manifest.profileOptions, { maxShardBytes: 64 * 1024 });
  assert.notEqual(small.result.manifest.fingerprint, large.result.manifest.fingerprint);
});

test("TFLex compiler refuses to delete a non-empty output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-safe-out-"));
  const outDir = join(root, "out");
  const sentinel = join(outDir, "keep.txt");
  await mkdir(outDir, { recursive: true });
  await writeFile(sentinel, "do not delete", "utf8");

  await assert.rejects(
    compileTflexCore({
      englishPath: fileURLToPath(new URL("wn-data-eng.tab", fixtureRoot)),
      chinesePath: fileURLToPath(new URL("wn-data-cmn.tab", fixtureRoot)),
      sourceLockPath: fileURLToPath(new URL("source-lock.json", fixtureRoot)),
      outDir
    }),
    /output directory must be empty/
  );
  assert.equal(await readFile(sentinel, "utf8"), "do not delete");
});

test("TFLex record validator rejects duplicate lookup keys", async () => {
  const { result } = await build("duplicate-key");
  const record = result.records[0];
  assert.throws(
    () => validateCoreRecords([record, structuredClone(record)]),
    /duplicate TFLex lookup key/
  );
});

test("TFLex output validator rejects a reader below readerMinVersion", async () => {
  const built = await build("reader-version");
  const manifestPath = join(built.outDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.readerMinVersion = 2;
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    validateTflexCoreOutput({ outDir: built.outDir, readerVersion: 1 }),
    /incompatible TFLex reader version/
  );
});

test("TFLex output validator detects manifest fingerprint corruption", async () => {
  const built = await build("fingerprint-corruption");
  const manifestPath = join(built.outDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.packVersion += "-tampered";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    validateTflexCoreOutput({ outDir: built.outDir, readerVersion: 1 }),
    /TFLex manifest fingerprint mismatch/
  );
});

test("TFLex output validator detects corrupted shard bytes", async () => {
  const built = await build("corruption");
  const shardPath = join(built.outDir, built.result.directory.shards[0].path);
  await writeFile(shardPath, (await readFile(shardPath, "utf8")) + " ", "utf8");
  await assert.rejects(
    validateTflexCoreOutput({ outDir: built.outDir, readerVersion: 1 }),
    /TFLex file size mismatch|TFLex file hash mismatch/
  );
});

test("TFLex compiler rejects source drift before parsing", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-drift-"));
  const changed = join(root, "eng.tab");
  await writeFile(changed, "# modified\n", "utf8");
  await assert.rejects(
    compileTflexCore({
      englishPath: changed,
      chinesePath: fileURLToPath(new URL("wn-data-cmn.tab", fixtureRoot)),
      sourceLockPath: fileURLToPath(new URL("source-lock.json", fixtureRoot)),
      outDir: join(root, "out")
    }),
    /SHA-256 mismatch for pwn-3\.0/
  );
});

test("source-lock validation fails closed on missing license evidence", () => {
  assert.throws(
    () => validateSourceLock({
      schemaVersion: 1,
      formatVersion: 1,
      readerMinVersion: 1,
      normalizationVersion: 1,
      packId: "x",
      packVersion: "1",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      sources: [
        { id: "pwn-3.0", version: "3", provenance: "x", data: { url: "x", sha256: "a".repeat(64) }, license: { id: "x", name: "x", source: "x", notice: "" } },
        { id: "chinese-open-wordnet", version: "1", provenance: "x", data: { url: "x", sha256: "b".repeat(64) }, license: { id: "x", name: "x", source: "x", notice: "ok" } }
      ]
    }),
    /license notice/
  );
});

test("source-lock validation rejects unverified extra Core sources", async () => {
  const lock = JSON.parse(await readFile(new URL("./fixtures/tflex-core/source-lock.json", import.meta.url), "utf8"));
  lock.sources.push({
    id: "unexpected-source",
    version: "1",
    provenance: "fixture",
    data: { url: "fixture://unexpected", sha256: "c".repeat(64) },
    license: { id: "fixture", name: "Fixture", source: "fixture://license", notice: "fixture" }
  });
  assert.throws(() => validateSourceLock(lock), /unsupported source id for core pack: unexpected-source/);
});

test("compiler rejects generic HTML-like markup in lexical source strings", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tflex-markup-"));
  const engText = "00000001-n\tlemma\t<b>unsafe display markup</b>\n";
  const cmnText = "00000001-n\tcmn:lemma\t测试\n";
  const engPath = join(root, "eng.tab");
  const cmnPath = join(root, "cmn.tab");
  const lockPath = join(root, "lock.json");
  const { createHash } = await import("node:crypto");
  const digest = (text) => createHash("sha256").update(text).digest("hex");
  await Promise.all([writeFile(engPath, engText), writeFile(cmnPath, cmnText)]);
  await writeFile(lockPath, JSON.stringify({
    schemaVersion: 1,
    formatVersion: 1,
    readerMinVersion: 1,
    normalizationVersion: 1,
    packId: "fixture",
    packVersion: "1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    sources: [
      { id: "pwn-3.0", version: "x", provenance: "x", data: { url: "fixture://eng", sha256: digest(engText) }, license: { id: "x", name: "x", source: "x", notice: "ok" } },
      { id: "chinese-open-wordnet", version: "x", provenance: "x", data: { url: "fixture://cmn", sha256: digest(cmnText) }, license: { id: "x", name: "x", source: "x", notice: "ok" } }
    ]
  }));
  await assert.rejects(
    compileTflexCore({ englishPath: engPath, chinesePath: cmnPath, sourceLockPath: lockPath, outDir: join(root, "out") }),
    /HTML-like markup or an executable scheme/
  );
});

test("source-lock validation rejects incompatible language metadata", async () => {
  const lock = JSON.parse(await readFile(new URL("./fixtures/tflex-core/source-lock.json", import.meta.url), "utf8"));
  lock.targetLanguage = "fr";
  assert.throws(() => validateSourceLock(lock), /targetLanguage is incompatible/);
});

test("source-lock validation rejects incompatible TFLex versions", () => {
  const base = {
    schemaVersion: 1,
    formatVersion: 2,
    readerMinVersion: 1,
    normalizationVersion: 1,
    packId: "x",
    packVersion: "1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    sources: [
      { id: "pwn-3.0", version: "3", provenance: "x", data: { url: "x", sha256: "a".repeat(64) }, license: { id: "x", name: "x", source: "x", notice: "ok" } },
      { id: "chinese-open-wordnet", version: "1", provenance: "x", data: { url: "x", sha256: "b".repeat(64) }, license: { id: "x", name: "x", source: "x", notice: "ok" } }
    ]
  };
  assert.throws(() => validateSourceLock(base), /formatVersion is incompatible/);
});
