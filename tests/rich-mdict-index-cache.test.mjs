import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { webcrypto } from "node:crypto";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import { createRichMdictLookupController } from "../src/background/packs/rich-mdict-lookup-controller.js";
import { cleanupCatalogVersions } from "../src/background/packs/rich-mdict-catalog-replacement.js";
import { createRichMdictPreferencesStore } from "../src/background/packs/rich-mdict-preferences.js";
import { RICH_MDICT_INDEX_PATH, RICH_MDICT_NORMALIZED_INDEX_PATH, RICH_MDICT_SOURCE_PATH, cacheKey, makeRichMdictSnapshot, richMdictIndexPath, sha256 } from "../src/background/packs/rich-mdict-contract.js";
import { createRichMdictIndexCache, RICH_MDICT_INDEX_CACHE_BUDGET_BYTES } from "../src/background/packs/rich-mdict-index-cache.js";

test("default budget is explicit and counts serialized bytes, not entry count", () => {
  assert.equal(RICH_MDICT_INDEX_CACHE_BUDGET_BYTES, 16 * 1024 * 1024);
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  const first = { id: "first" }, second = { id: "second" };
  assert.equal(cache.set("pack-a@v1", first, 4), true);
  assert.equal(cache.set("pack-b@v1", second, 6), true);
  assert.deepEqual(cache.snapshot(), {
    maximumBytes: 10, cachedBytes: 10, entries: 2, activeLeases: 0, pinnedEntries: 0,
    hits: 0, misses: 0, admissions: 2, evictions: 0, bypasses: 0
  });
});

test("LRU promotes reads and evicts the least recently used unpinned serialized index", () => {
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  const a = {}, b = {}, c = {};
  cache.set("a", a, 4);
  cache.set("b", b, 6);
  assert.equal(cache.get("a"), a);
  assert.equal(cache.set("c", c, 6), true);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), a);
  assert.equal(cache.snapshot().evictions, 1);
  assert.equal(cache.snapshot().cachedBytes, 10);
});

test("active leases pin entries and all-pinned pressure bypasses admission", () => {
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  const a = {}, b = {}, temporary = {};
  cache.set("a", a, 5);
  cache.set("b", b, 5);
  const first = cache.acquire("a");
  const second = cache.acquire("b");

  assert.equal(cache.set("temporary", temporary, 5), false);
  assert.equal(cache.snapshot().cachedBytes, 10);
  assert.equal(cache.snapshot().pinnedEntries, 2);
  assert.equal(cache.snapshot().activeLeases, 2);
  const held = cache.hold(temporary);
  assert.equal(held.index, temporary);
  assert.equal(cache.snapshot().activeLeases, 3);

  first.release();
  assert.equal(cache.set("temporary", temporary, 5), true);
  assert.equal(second.index, b);
  assert.equal(cache.get("b"), b);
  held.release();
  assert.equal(second.release(), true);
  assert.equal(second.release(), false);
  assert.equal(cache.snapshot().activeLeases, 0);
  assert.equal(cache.snapshot().cachedBytes, 10);
});

test("oversized entries and failed admission leave useful cache contents intact", () => {
  const cache = createRichMdictIndexCache({ maximumBytes: 5 });
  const original = {}, large = {};
  cache.set("small", original, 5);
  assert.equal(cache.set("large", large, 6), false);
  assert.equal(cache.get("small"), original);
  assert.equal(cache.snapshot().entries, 1);
  assert.equal(cache.snapshot().bypasses, 1);
  assert.equal(cache.snapshot().evictions, 0);
  assert.equal(createRichMdictIndexCache({ maximumBytes: 0 }).set("none", {}, 1), false);
});

test("replacement under a pinned identity does not substitute the leased object", () => {
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  const original = {}, replacement = {};
  cache.set("identity", original, 10);
  const lease = cache.acquire("identity");

  assert.equal(cache.set("identity", replacement, 10), false);
  assert.equal(cache.acquire("identity", replacement), null);
  const temporary = cache.hold(replacement);
  assert.equal(lease.index, original);
  assert.equal(cache.get("identity"), original);

  temporary.release();
  lease.release();
  assert.equal(cache.snapshot().pinnedEntries, 0);
  assert.equal(cache.snapshot().activeLeases, 0);
});

test("explicit invalidation and pack cleanup detach entries without breaking leased references", () => {
  const cache = createRichMdictIndexCache({ maximumBytes: 12 });
  const detached = { id: "detached" }, keep = { id: "keep" };
  cache.set("rich-mdict-alpha@v1", detached, 7);
  cache.set("rich-mdict-beta@v1", keep, 5);
  const lease = cache.acquire("rich-mdict-alpha@v1");

  assert.equal(cache.forgetPack("rich-mdict-alpha"), 1);
  assert.equal(cache.get("rich-mdict-alpha@v1"), undefined);
  assert.equal(lease.index, detached);
  assert.equal(cache.snapshot().cachedBytes, 5);
  assert.equal(cache.has("rich-mdict-beta@v1"), true);
  assert.equal(lease.release(), true);
  assert.equal(cache.snapshot().activeLeases, 0);
});

test("lookup releases its cache lease after success, error, and cancellation", { timeout: 10_000 }, async () => {
  for (const outcome of ["success", "error"]) {
    const { controller, cache } = makeLeaseController(async () => {
      if (outcome === "error") throw new Error("synthetic lookup failure");
      return { found: false };
    });
    await controller.lookupText("term", LEASE_PACK_ID);
    assert.equal(cache.snapshot().activeLeases, 0, `${outcome} released its lease`);
  }

  let lookupStarted;
  const started = new Promise((resolve) => { lookupStarted = resolve; });
  const { controller, cache } = makeLeaseController(({ signal }) => new Promise((resolve, reject) => {
    lookupStarted();
    signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true });
  }));
  const identity = { requestId: "selection-rich-lookup-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ownerKey: "extension:test" };
  const pending = controller.lookupText("term", LEASE_PACK_ID, identity);
  await started;
  assert.equal(cache.snapshot().activeLeases, 1);
  assert.deepEqual(controller.cancelLookup(identity.requestId, identity.ownerKey), { cancelled: true, phase: "active" });
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(cache.snapshot().activeLeases, 0, "cancellation released its lease");
});

test("uninstall invalidates every cached identity while an in-flight lease remains usable", async () => {
  const fixture = await makeOneDictionary();
  const store = new SyntheticPackStore([fixture]);
  const stateStore = new SyntheticPackStateStore([fixture]);
  const cache = createRichMdictIndexCache({ maximumBytes: 1024 * 1024 });
  const manager = createRichMdictManager({
    store,
    stateStore,
    cryptoProvider: webcrypto,
    storageManager: null,
    indexCache: cache,
    lookup: async () => ({ found: false })
  });

  await manager.lookupDictionary("cachefixture", fixture.snapshot.packId);
  const cachedLease = cache.acquire(cacheKey(fixture.snapshot));
  assert.ok(cachedLease);
  assert.equal(cache.snapshot().entries, 1);
  const removed = await manager.uninstall(fixture.snapshot.packId);
  assert.equal(removed.uninstalled, true);
  assert.equal(cache.snapshot().entries, 0);
  assert.equal(cache.snapshot().cachedBytes, 0);
  assert.ok(cachedLease.index.entryCount > 0);
  cachedLease.release();
  assert.equal(cache.snapshot().activeLeases, 0);
});

test("catalog replacement removes every old-version identity while a leased index remains usable", async () => {
  const packId = "rich-mdict-00000000-0000-4000-8000-000000000088";
  const oldSnapshot = { packId, packVersion: "catalog-old", indexSha256: "a".repeat(64) };
  const nextSnapshot = { packId, packVersion: "catalog-next", indexSha256: "b".repeat(64) };
  const oldIndex = { id: "old" }, nextIndex = { id: "next" };
  const oldKey = cacheKey(oldSnapshot), nextKey = cacheKey(nextSnapshot);
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  cache.set(oldKey, oldIndex, 4);
  cache.set(nextKey, nextIndex, 4);
  const lease = cache.acquire(oldKey);
  const removedVersions = [];

  await cleanupCatalogVersions({
    store: {
      async listVersions(id) { assert.equal(id, packId); return ["catalog-old", "catalog-next"]; },
      async removeVersion(id, version) { removedVersions.push(`${id}@${version}`); }
    },
    indexCache: cache,
    packId,
    activeVersion: "catalog-next",
    retainedResourceVersion: ""
  });

  assert.equal(cache.has(oldKey), false);
  assert.equal(cache.has(nextKey), true);
  assert.deepEqual(removedVersions, [`${packId}@catalog-old`]);
  assert.equal(lease.index, oldIndex);
  lease.release();
  assert.equal(cache.snapshot().activeLeases, 0);
});

test("invalid weights fail closed and diagnostic callback errors stay isolated", () => {
  for (const maximumBytes of [-1, NaN, Infinity, 0.5, null]) {
    assert.throws(() => createRichMdictIndexCache({ maximumBytes }));
  }
  const cache = createRichMdictIndexCache({ maximumBytes: 10, onEvent: () => { throw new Error("diagnostic failure"); } });
  cache.set("valid", {}, 5);
  for (const size of [0, -1, NaN, Infinity, 0.5, undefined]) {
    assert.throws(() => cache.set("invalid", {}, size));
  }
  assert.throws(() => cache.set("", {}, 1));
  assert.equal(cache.snapshot().cachedBytes, 5);
  cache.acquire("valid").release();
  assert.equal(cache.snapshot().activeLeases, 0);
});

test("20 installed synthetic dictionaries fit the measured 16 MiB budget and retain the preferred hot index", { timeout: 120_000 }, async () => {
  const fixtures = await makeTwentyDictionaries();
  const preferencesStore = createRichMdictPreferencesStore({ storageArea: createMemoryStorageArea() });
  const preferences = await preferencesStore.reconcile(fixtures.map(({ snapshot }) => ({
    id: snapshot.packId, title: snapshot.title, installedAt: snapshot.installedAt
  })));
  const enabledFixtures = fixtures.filter(({ snapshot }) => preferences[snapshot.packId]?.enabled !== false);
  const enabledPackIds = enabledFixtures.map(({ snapshot }) => snapshot.packId);
  assert.equal(fixtures.length, 20);
  assert.equal(enabledPackIds.length, 20);
  const preferredPackId = [...enabledFixtures].sort((left, right) =>
    preferences[left.snapshot.packId].order - preferences[right.snapshot.packId].order
  )[0].snapshot.packId;
  const fixtureById = new Map(enabledFixtures.map((fixture) => [fixture.snapshot.packId, fixture]));
  const serializedBytes = enabledFixtures.reduce((sum, fixture) => sum + fixture.indexBytes.byteLength, 0);
  assert.ok(serializedBytes < RICH_MDICT_INDEX_CACHE_BUDGET_BYTES);
  const record = "<p>Synthetic cache lookup.</p>";
  const recordBytes = new TextEncoder().encode(record).byteLength;
  const scenarios = [];

  for (const maximumBytes of [8 * 1024 * 1024, RICH_MDICT_INDEX_CACHE_BUDGET_BYTES, 32 * 1024 * 1024]) {
    const store = new SyntheticPackStore(enabledFixtures);
    const stateStore = new SyntheticPackStateStore(enabledFixtures);
    const preferredFixture = fixtureById.get(preferredPackId);
    const cache = createRichMdictIndexCache({ maximumBytes });
    const manager = createRichMdictManager({
      store,
      stateStore,
      cryptoProvider: webcrypto,
      storageManager: null,
      indexCache: cache,
      lookup: async ({ text }) => ({
        found: true,
        displayForm: text,
        rawRecord: record,
        sourceRecordBytes: recordBytes,
        decodedTextBytes: recordBytes,
        safeTextFallback: "Synthetic cache definition"
      })
    });

    const queryAll = async () => {
      const result = await manager.lookupDictionary("cachefixture");
      assert.equal(result.found, true, JSON.stringify(result.errors));
      assert.deepEqual(result.errors, []);
      assert.equal(result.dictionaries.length, enabledPackIds.length);
      assert.ok(result.dictionaries.every((dictionary) => dictionary.text === "Synthetic cache definition"));
      return result;
    };

    const coldStart = performance.now();
    await queryAll();
    const coldMs = performance.now() - coldStart;
    const readsAfterCold = store.indexReads;

    const warmStart = performance.now();
    await queryAll();
    await queryAll();
    const warmMs = performance.now() - warmStart;
    const readsAfterWarm = store.indexReads;

    const hotStart = performance.now();
    for (let repeat = 0; repeat < 12; repeat += 1) {
      const result = await manager.lookupDictionary("cachefixture", preferredFixture.snapshot.packId);
      assert.equal(result.found, true);
      assert.equal(result.dictionaries[0].text, "Synthetic cache definition");
    }
    const preferredHotMs = performance.now() - hotStart;
    const readsAfterHot = store.indexReads;
    const cacheState = cache.snapshot();
    assert.ok(cacheState.cachedBytes <= maximumBytes);
    assert.equal(cacheState.activeLeases, 0);

    scenarios.push({
      budgetBytes: maximumBytes,
      entriesAfterHot: cacheState.entries,
      cachedBytesAfterHot: cacheState.cachedBytes,
      serializedInputBytes: serializedBytes,
      coldOpenMs: Number(coldMs.toFixed(2)),
      coldIndexFileReads: readsAfterCold,
      warmThreePassIndexFileReads: readsAfterWarm - readsAfterCold,
      preferredHot12Ms: Number(preferredHotMs.toFixed(2)),
      preferredHotIndexFileReads: readsAfterHot - readsAfterWarm,
      evictions: cacheState.evictions,
      admissionBypasses: cacheState.bypasses
    });
  }

  const smaller = scenarios.find((scenario) => scenario.budgetBytes === 8 * 1024 * 1024);
  const selected = scenarios.find((scenario) => scenario.budgetBytes === RICH_MDICT_INDEX_CACHE_BUDGET_BYTES);
  const larger = scenarios.find((scenario) => scenario.budgetBytes === 32 * 1024 * 1024);
  assert.ok(smaller.warmThreePassIndexFileReads > 0, "8 MiB evicts entries from the 20-dictionary sequential working set");
  assert.equal(selected.entriesAfterHot, 20);
  assert.equal(selected.cachedBytesAfterHot, serializedBytes);
  assert.equal(selected.warmThreePassIndexFileReads, 0);
  assert.equal(selected.preferredHotIndexFileReads, 0);
  assert.equal(larger.warmThreePassIndexFileReads, 0);
  assert.equal(larger.preferredHotIndexFileReads, 0);
  console.log("[RICH_MDICT_INDEX_CACHE_MEASUREMENT]", JSON.stringify({
    installed: 20,
    enabled: enabledPackIds.length,
    queriesPerDictionary: 3,
    preferredHotQueries: 12,
    preferredPackId,
    entriesPerDictionary: enabledFixtures.map(({ snapshot }) => snapshot.entryCount),
    totalIndexedEntries: enabledFixtures.reduce((sum, { snapshot }) => sum + snapshot.entryCount, 0),
    serializedIndexBytes: enabledFixtures.map(({ indexBytes }) => indexBytes.byteLength),
    serializedInputBytes: serializedBytes,
    scenarios
  }));
});

async function makeTwentyDictionaries() {
  const fixtures = [];
  for (let dictionary = 0; dictionary < 20; dictionary += 1) {
    const packId = `rich-mdict-00000000-0000-4000-8000-${String(dictionary + 1).padStart(12, "0")}`;
    const packVersion = `import-cachefixture-${String(dictionary + 1).padStart(8, "0")}`;
    const entries = Array.from({ length: 1_600 }, (_, index) => [
      `dict${String(dictionary).padStart(2, "0")}word${String(index).padStart(5, "0")}${"x".repeat(48)}`,
      `<p>Dictionary ${dictionary} entry ${index}</p>`
    ]);
    const sourceBytes = makeRichMdx(entries, { keyBlockEntryCounts: Array(entries.length).fill(1) });
    const source = { size: sourceBytes.byteLength, read: async (offset, length) => sourceBytes.subarray(offset, offset + length) };
    const index = await buildRichMdictIndex({ source });
    const indexBytes = new TextEncoder().encode(JSON.stringify(index));
    const metadata = {
      packId,
      packVersion,
      sourceSize: sourceBytes.byteLength,
      indexSize: indexBytes.byteLength,
      indexSha256: await sha256(indexBytes, webcrypto),
      fileName: `fixture-${dictionary}.mdx`
    };
    fixtures.push({ sourceBytes, indexBytes, snapshot: makeRichMdictSnapshot(metadata, index) });
  }
  return fixtures;
}

async function makeOneDictionary() {
  const packId = LEASE_PACK_ID;
  const packVersion = "import-cachefixture-00000099";
  const sourceBytes = makeRichMdx([["cachefixture", "<p>Fixture definition.</p>"]]);
  const source = { size: sourceBytes.byteLength, read: async (offset, length) => sourceBytes.subarray(offset, offset + length) };
  const index = await buildRichMdictIndex({ source });
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const snapshot = makeRichMdictSnapshot({ packId, packVersion, sourceSize: sourceBytes.byteLength,
    indexSize: indexBytes.byteLength, indexSha256: await sha256(indexBytes, webcrypto), fileName: "fixture.mdx" }, index);
  return { sourceBytes, indexBytes, snapshot };
}

const LEASE_PACK_ID = "rich-mdict-00000000-0000-4000-8000-000000000099";

function makeLeaseController(lookup) {
  const snapshot = { packId: LEASE_PACK_ID, packVersion: "import-cachelease-00000099", sourceSize: 1,
    indexSize: 1, indexSha256: "a".repeat(64) };
  const index = { entryCount: 1 };
  const cache = createRichMdictIndexCache({ maximumBytes: 10 });
  const key = cacheKey(snapshot);
  cache.set(key, index, 1);
  const controller = createRichMdictLookupController({
    stateStore: { async read() { return { packs: { [LEASE_PACK_ID]: { sourceId: "local-rich-mdict", status: "healthy", active: snapshot } } }; } },
    lookup,
    assertSourceSize: async () => {},
    loadIndex: async () => index,
    acquireIndex: async () => cache.acquire(key),
    sourceReader: () => ({ size: 1, read: async () => new Uint8Array([1]) }),
    clampUtf8Text: (value) => String(value)
  });
  return { controller, cache };
}

class SyntheticPackStore {
  constructor(fixtures) {
    this.files = new Map();
    this.indexReads = 0;
    for (const { sourceBytes, indexBytes, snapshot } of fixtures) {
      this.files.set(this.key(snapshot, RICH_MDICT_SOURCE_PATH), sourceBytes);
      this.files.set(this.key(snapshot, richMdictIndexPath(snapshot)), indexBytes);
    }
  }

  key(snapshot, path) { return `${snapshot.packId}/${snapshot.packVersion}/${path}`; }
  async getFileSize(packId, packVersion, path) {
    return this.files.get(`${packId}/${packVersion}/${path}`)?.byteLength ?? 0;
  }
  async readFile(packId, packVersion, path) {
    if (path === RICH_MDICT_INDEX_PATH || path === RICH_MDICT_NORMALIZED_INDEX_PATH) this.indexReads += 1;
    const bytes = this.files.get(`${packId}/${packVersion}/${path}`);
    if (!bytes) throw new Error(`Synthetic file missing: ${path}`);
    return new Uint8Array(bytes);
  }
  async readFileRange(packId, packVersion, path, offset, length) {
    const bytes = this.files.get(`${packId}/${packVersion}/${path}`);
    if (!bytes) throw new Error(`Synthetic file missing: ${path}`);
    return new Uint8Array(bytes.subarray(offset, offset + length));
  }
  async writeFile() { throw new Error("Cache measurement must not write files."); }
  async removePack(packId) {
    for (const path of this.files.keys()) if (path.startsWith(`${packId}/`)) this.files.delete(path);
  }
}

class SyntheticPackStateStore {
  constructor(fixtures) {
    this.enabledPackIds = fixtures.map(({ snapshot }) => snapshot.packId);
    this.preferredPackId = this.enabledPackIds[0];
    this.state = { packs: Object.fromEntries(fixtures.map(({ snapshot }) => [snapshot.packId, {
      sourceId: "local-rich-mdict", status: "healthy", active: snapshot
    }])) };
  }
  async read() { return this.state; }
  async update(mutator) { this.state = mutator(structuredClone(this.state)); return this.state; }
}

function createMemoryStorageArea() {
  const values = new Map();
  return {
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))]));
    },
    async set(next) {
      for (const [key, value] of Object.entries(next)) values.set(key, structuredClone(value));
    }
  };
}
