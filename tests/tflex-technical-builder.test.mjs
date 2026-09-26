import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import {
  buildTechnicalAliasIndex,
  buildTechnicalRecords,
  compileTflexTechnical,
  validateTechnicalSourceLock
} from "../scripts/build-tflex-technical.mjs";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";

const extractPath = fileURLToPath(new URL("../lexicon/sources/wikidata-tech-entities.json", import.meta.url));
const lockPath = fileURLToPath(new URL("../lexicon/source-locks/technical-wikidata.json", import.meta.url));

async function build(name, maxShardBytes = 1200) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tech-pack-" + name + "-"));
  const outDir = join(root, "out");
  const result = await compileTflexTechnical({
    extractPath,
    sourceLockPath: lockPath,
    outDir,
    maxShardBytes
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

function readerFor(outDir) {
  return createTflexReader({
    packBasePath: "pack",
    cryptoProvider: webcrypto,
    readBytes: async (path) => new Uint8Array(
      await readFile(join(outDir, path.replace(/^pack\//, "")))
    )
  });
}

test("technical TFLex build is deterministic, source-locked and bounded", async () => {
  const first = await build("a");
  const second = await build("b");
  assert.deepEqual(await snapshotDir(first.outDir), await snapshotDir(second.outDir));

  assert.equal(first.result.manifest.packId, "technical-wikidata-en-zh");
  assert.equal(first.result.manifest.packVersion, "wikidata-revision-set-2026-09");
  assert.equal(first.result.manifest.recordCount, 10);
  assert.equal(first.result.manifest.sources.length, 1);
  assert.equal(first.result.manifest.sources[0].id, "wikidata");
  assert.equal(first.result.manifest.sources[0].license.id, "CC0-1.0");
  assert.deepEqual(first.result.manifest.sources[0].snapshot, {
    kind: "qid-revision-set",
    version: "2026-09-26",
    lockedAt: "2026-09-26T14:38:56Z",
    extractRuleVersion: 1
  });
  assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.result.directory.shards.length >= 2);
  assert.ok(first.result.directory.shards.every((shard) => shard.size <= 1200));
  assert.ok(first.result.manifest.files.some((file) => file.role === "license-notice"));
});

test("runtime reader resolves named entities and approved aliases locally", async () => {
  const built = await build("runtime", 4096);
  const reader = readerFor(built.outDir);

  const tmux = await reader.lookup("tmux");
  assert.equal(tmux.record.kind, "technical-entity");
  assert.equal(tmux.record.entityId, "Q1935361");
  assert.deepEqual(tmux.record.typeLabels, ["free software", "terminal multiplexer"]);

  const k8s = await reader.lookupAll("K8s");
  assert.equal(k8s.length, 1);
  assert.equal(k8s[0].record.displayForm, "Kubernetes");
  assert.equal(k8s[0].matchedAlias, true);
  assert.equal(k8s[0].exactCaseMatch, true);
  const lowerK8s = await reader.lookupAll("k8s");
  assert.equal(lowerK8s.length, 1);
  assert.equal(lowerK8s[0].record.displayForm, "Kubernetes");
  assert.equal(lowerK8s[0].exactCaseMatch, false);

  const react = await reader.lookupAll("React.js");
  assert.equal(react.length, 1);
  assert.equal(react[0].record.displayForm, "React");
  assert.deepEqual(await reader.lookupAll("react.js"), []);

  const postgres = await reader.lookupAll("postgres");
  assert.equal(postgres.length, 1);
  assert.equal(postgres[0].record.displayForm, "PostgreSQL");

  const runtime = await reader.lookupAll("runtime system");
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0].record.kind, "technical-concept");
  assert.deepEqual(runtime[0].record.translations, []);
  assert.deepEqual(runtime[0].record.domains, ["runtime"]);
  assert.equal("description" in runtime[0].record, false);
  assert.deepEqual(await reader.lookupAll("runtime"), []);

  const session = await reader.lookup("session");
  assert.equal(session.record.kind, "technical-concept");
  assert.deepEqual(session.record.translations, []);
  assert.deepEqual(session.record.domains, ["protocol"]);
  assert.deepEqual(await reader.lookupAll("container"), []);
});

test("generic source aliases are explicitly excluded from lookup index", async () => {
  const built = await build("generic-alias");
  const kubernetes = built.result.records.find((record) => record.entityId === "Q22661306");
  assert.ok(kubernetes);
  assert.ok(kubernetes.aliases.includes("K8s"));
  assert.ok(!kubernetes.aliases.includes("container orchestrator"));
  assert.ok(!built.result.aliases.some((alias) => alias.key === "container orchestrator"));
});

test("ambiguous aliases retain multiple canonical targets", async () => {
  const lock = validateTechnicalSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const extract = {
    schemaVersion: 1,
    source: "Wikidata main namespace structured data",
    license: "CC0-1.0",
    entities: [
      {
        qid: "Q1",
        revision: 1,
        label: "AlphaTool",
        aliases: ["shared-tool"],
        types: ["free software"],
        permanentUrl: "https://www.wikidata.org/w/index.php?title=Q1&oldid=1"
      },
      {
        qid: "Q2",
        revision: 2,
        label: "BetaTool",
        aliases: ["shared-tool"],
        types: ["free software"],
        permanentUrl: "https://www.wikidata.org/w/index.php?title=Q2&oldid=2"
      }
    ]
  };
  const records = buildTechnicalRecords(extract, lock.policy);
  const aliases = buildTechnicalAliasIndex(records, lock.policy);
  const shared = aliases.find((alias) => alias.key === "shared-tool");
  assert.ok(shared);
  assert.deepEqual(shared.targets, ["alphatool", "betatool"]);
  assert.equal(shared.caseSensitive, false);
});

test("non-technical types are excluded by the explicit allowlist", async () => {
  const lock = validateTechnicalSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const records = buildTechnicalRecords({
    schemaVersion: 1,
    source: "Wikidata main namespace structured data",
    license: "CC0-1.0",
    entities: [{
      qid: "Q3",
      revision: 3,
      label: "NotATool",
      aliases: [],
      types: ["human"],
      permanentUrl: "https://www.wikidata.org/w/index.php?title=Q3&oldid=3"
    }]
  }, lock.policy);
  assert.deepEqual(records, []);
});

test("official extract matches the exact locked QID/revision set and concept kinds", async () => {
  const lock = validateTechnicalSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const extract = JSON.parse(await readFile(extractPath, "utf8"));
  const records = buildTechnicalRecords(extract, lock.policy, lock.entities);
  assert.equal(records.length, lock.entities.length);
  assert.equal(records.find((record) => record.entityId === "Q1004415").kind, "technical-concept");
  assert.equal(records.find((record) => record.entityId === "Q1935361").kind, "technical-entity");
  assert.ok(records.every((record) => !("description" in record)));
  assert.ok(records.every((record) => Array.isArray(record.translations) && record.translations.length === 0));

  const changed = structuredClone(extract);
  changed.entities[0].revision += 1;
  assert.throws(
    () => buildTechnicalRecords(changed, lock.policy, lock.entities),
    /revision mismatch/
  );

  const unexpected = structuredClone(extract);
  unexpected.entities.push({
    qid: "Q999999999",
    revision: 1,
    label: "Unexpected",
    aliases: [],
    types: ["free software"],
    permanentUrl: "https://www.wikidata.org/w/index.php?title=Q999999999&oldid=1"
  });
  assert.throws(
    () => buildTechnicalRecords(unexpected, lock.policy, lock.entities),
    /entity set does not match|unexpected Wikidata entity/
  );
});

test("technical extract rejects media, prose and unproven target-label schema expansion", async () => {
  const lock = validateTechnicalSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  const extract = JSON.parse(await readFile(extractPath, "utf8"));

  for (const [field, value] of [
    ["logo", "SomeLogo.svg"],
    ["description", "prose must not enter the release extract"],
    ["zhLabel", "未锁定来源的中文标签"]
  ]) {
    const changed = structuredClone(extract);
    changed.entities[0][field] = value;
    assert.throws(
      () => buildTechnicalRecords(changed, lock.policy, lock.entities),
      new RegExp("unsupported Wikidata extract field: " + field)
    );
  }
});

test("technical builder fails closed on source drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-tech-drift-"));
  const changed = join(root, "extract.json");
  await writeFile(changed, (await readFile(extractPath, "utf8")) + "\n", "utf8");
  await assert.rejects(
    compileTflexTechnical({
      extractPath: changed,
      sourceLockPath: lockPath,
      outDir: join(root, "out")
    }),
    /extract size mismatch|extract SHA-256 mismatch/
  );
});

test("technical source lock requires Wikidata CC0 evidence", async () => {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.source.license.id = "unknown";
  assert.throws(() => validateTechnicalSourceLock(lock), /CC0-1\.0/);
});

test("technical source lock requires explicit revision-set snapshot metadata", async () => {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  delete lock.source.snapshot.extractRuleVersion;
  assert.throws(() => validateTechnicalSourceLock(lock), /extractRuleVersion/);
});

test("technical entity strings remain data-only", async () => {
  const lock = validateTechnicalSourceLock(JSON.parse(await readFile(lockPath, "utf8")));
  assert.throws(
    () => buildTechnicalRecords({
      schemaVersion: 1,
      source: "Wikidata main namespace structured data",
      license: "CC0-1.0",
      entities: [{
        qid: "Q4",
        revision: 4,
        label: "<img src=x>",
        aliases: [],
        types: ["free software"],
        permanentUrl: "https://www.wikidata.org/w/index.php?title=Q4&oldid=4"
      }]
    }, lock.policy),
    /HTML-like markup/
  );
});

test("technical release builder has no live SPARQL or fetch dependency", async () => {
  const source = await readFile(new URL("../scripts/build-tflex-technical.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /query\.wikidata\.org|SPARQL|\bfetch\s*\(/i);
});
