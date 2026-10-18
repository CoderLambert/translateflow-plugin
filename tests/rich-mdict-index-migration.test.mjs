import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { buildRichMdictIndex, lookupRichMdict } from "../src/background/packs/importers/mdict-rich.js";
import { parseRichMdictHeader } from "../src/background/packs/importers/mdict-rich-metadata.js";
import { validateRichMdictIndex } from "../src/background/packs/importers/mdict-rich-validation.js";
import { createRichMdictManager, serializeRichMdictPack } from "../src/background/packs/rich-mdict.js";
import { createRichMdictIndexLoader } from "../src/background/packs/rich-mdict-index-migration.js";
import { createPackStateStore } from "../src/background/packs/state.js";
import { cacheKey, isValidSnapshot, richMdictIndexPath, sha256 } from "../src/background/packs/rich-mdict-contract.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";

const id = "rich-mdict-123e4567-e89b-42d3-a456-426614174270";
const version = "import-test-12345678";
const stateKey = "tfRichMdictStateV1";
const source = (bytes) => ({ size: bytes.byteLength, async read(offset, length) { return bytes.slice(offset, offset + length); } });

for (const [name, options, expected] of [
  ["standard Yes", { StripKey: "Yes" }, true], ["standard No", { StripKey: "No" }, false],
  ["confirmed alias Yes", { Stripkey: "Yes" }, true], ["confirmed alias No", { Stripkey: "No" }, false],
  ["missing", {}, false], ["unknown spelling", { stripkey: "Yes" }, false],
  ["both agreeing", { StripKey: "Yes", Stripkey: "Yes" }, true]
]) {
  test(`StripKey header: ${name}`, () => {
    const header = parseRichMdictHeader(makeRichMdx([["fixture", "fixture"]], { keyOptions: { KeyCaseSensitive: "Yes", ...options } }));
    assert.equal(header.stripKey, expected);
    assert.equal(header.keyCaseSensitive, true, "case sensitivity is not relaxed");
  });
}

test("conflicting StripKey/Stripkey and invalid values fail closed", () => {
  for (const keyOptions of [{ StripKey: "Yes", Stripkey: "No" }, { StripKey: "No", Stripkey: "Yes" }, { Stripkey: "Maybe" }]) {
    assert.throws(() => parseRichMdictHeader(makeRichMdx([["fixture", "fixture"]], { keyOptions })), /conflict|invalid/u);
  }
});

test("the confirmed alias changes punctuation matching only when Yes and preserves case-sensitive keys", async () => {
  for (const [options, strips] of [[{ Stripkey: "Yes" }, true], [{ Stripkey: "No" }, false], [{ StripKey: "Yes" }, true], [{ StripKey: "No" }, false], [{}, false], [{ STRIPKEY: "Yes" }, false]]) {
    const bytes = makeRichMdx([["Alpha-Beta", "Synthetic definition"]], { keyOptions: { KeyCaseSensitive: "Yes", ...options } });
    const index = await buildRichMdictIndex({ source: source(bytes) });
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text: "Alpha Beta" })).found, strips);
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text: "alpha-beta" })).found, false);
    assert.equal((await lookupRichMdict({ source: source(bytes), index, text: "Alpha-Beta" })).found, true);
  }
});

test("new indexes use schema2 while legacy1 retains equally strict validation", async () => {
  const index = await buildRichMdictIndex({ source: source(fixtureBytes(true)) });
  assert.equal(index.schemaVersion, 2);
  const legacy = { ...index, schemaVersion: 1 };
  assert.equal(validateRichMdictIndex(legacy), legacy);
  for (const schemaVersion of [1, 2, 0, 3, "2"]) {
    const corrupt = { ...index, schemaVersion, recordBlocks: [] };
    assert.throws(() => validateRichMdictIndex(corrupt));
  }
});

test("affected legacy index migrates atomically, retains every raw file/settings/resource and survives manager restart", async () => {
  const h = await environment(true);
  const before = await h.stateStore.read();
  const originalFiles = new Map(h.store.files);
  const result = await h.manager.lookupDictionary("alpha beta", id);
  assert.equal(result.found, true);
  assert.match(result.dictionaries[0].text, /Synthetic migration definition/u);
  assert.equal(h.buildCalls(), 1);
  const active = (await h.stateStore.read()).packs[id].active;
  assert.equal(active.indexPath, "index-normalized-v2.json");
  assert.equal(active.indexSchemaVersion, 2);
  assert.equal(active.header.stripKey, true);
  assert.notEqual(active.indexSha256, before.packs[id].active.indexSha256);
  assert.deepEqual({ ...active, indexPath: undefined, indexSchemaVersion: undefined, indexSize: before.packs[id].active.indexSize,
    indexSha256: before.packs[id].active.indexSha256, header: before.packs[id].active.header },
  { ...before.packs[id].active, indexPath: undefined, indexSchemaVersion: undefined });
  for (const [path, bytes] of originalFiles) assert.deepEqual(h.store.files.get(path), bytes);
  assert.deepEqual(h.storage.values.preferences, { dictionaries: { [id]: { enabled: true, order: 3 } } });
  const restarted = h.createManager();
  assert.equal((await restarted.lookupDictionary("alpha beta", id)).found, true);
  assert.equal(h.buildCalls(), 1, "persisted schema2 needs no rebuilding after restart");
});

test("unaffected schema1 verifies only the bounded raw header, never rebuilds or writes", async () => {
  const h = await environment(false);
  const before = await h.stateStore.read();
  assert.equal((await h.manager.lookupDictionary("alpha beta", id)).found, true);
  assert.equal(h.buildCalls(), 0);
  assert.deepEqual(await h.stateStore.read(), before);
  assert.equal(h.store.writes.length, 0);
  assert.deepEqual(h.store.ranges.slice(0, 2).map(({ offset, length }) => [offset, length]), [[0, 4], [0, h.bytes.readUInt32BE(0) + 8]]);
  assert.ok(h.store.fullReads.every((path) => path.endsWith("index.json")), "MDX is never read as one blob");
});

test("legacy alias No remains untouched and unrelated case/standard-option mismatches are rejected", async () => {
  const h = await environment(true, { KeyCaseSensitive: "No", Stripkey: "No" });
  await h.load(h.snapshot);
  assert.equal(h.buildCalls(), 0);
  assert.equal(h.store.writes.length, 0);
  for (const mismatch of ["case", "standard"]) {
    const broken = await environment(mismatch === "case");
    if (mismatch === "case") broken.legacy.header.keyCaseSensitive = true;
    else broken.legacy.header.stripKey = false;
    const bytes = new TextEncoder().encode(JSON.stringify(broken.legacy));
    broken.store.files.set(broken.store.key(id, version, "index.json"), bytes);
    await broken.stateStore.update((current) => { current.packs[id].active.indexSize = bytes.byteLength; return current; });
    const digest = await sha256(bytes, webcrypto);
    await broken.stateStore.update((current) => { current.packs[id].active.indexSha256 = digest; return current; });
    const before = await broken.stateStore.read();
    await assert.rejects(broken.load(before.packs[id].active), { code: "RICH_MDICT_CORRUPT" });
    assert.deepEqual(await broken.stateStore.read(), before);
    assert.equal(broken.buildCalls(), 0);
    assert.equal(broken.store.writes.length, 0);
  }
});

for (const phase of ["write", "hash", "validation", "state", "source", "old-hash"]) {
  test(`migration ${phase} failure leaves the previous pointer and raw files intact and remains retryable`, async () => {
    const h = await environment(true);
    const originalState = await h.stateStore.read();
    const originals = new Map(h.store.files);
    const originalWrite = h.store.writeFile.bind(h.store);
    const originalRead = h.store.readFile.bind(h.store);
    const originalRange = h.store.readFileRange.bind(h.store);
    if (phase === "write") h.store.writeFile = async () => { throw new Error("synthetic write failure"); };
    if (phase === "hash") h.store.readFile = async (...args) => { const bytes = await originalRead(...args); if (args[2] === "index-normalized-v2.json") bytes[0] ^= 1; return bytes; };
    if (phase === "validation") h.setBuilder(async () => ({ schemaVersion: 2 }));
    if (phase === "state") h.setStateFailure(true);
    if (phase === "source") h.store.readFileRange = async (...args) => { const bytes = await originalRange(...args); if (args[3] === 0) bytes[0] ^= 1; return bytes; };
    if (phase === "old-hash") h.store.readFile = async (...args) => { const bytes = await originalRead(...args); bytes[0] ^= 1; return bytes; };
    const failed = await h.manager.lookupDictionary("alpha beta", id);
    assert.equal(failed.found, false);
    assert.equal(failed.errors.length, 1);
    assert.deepEqual(await h.stateStore.read(), originalState);
    for (const [path, bytes] of originals) assert.deepEqual(h.store.files.get(path), bytes);
    h.store.writeFile = originalWrite; h.store.readFile = originalRead; h.store.readFileRange = originalRange;
    h.setBuilder(buildRichMdictIndex); h.setStateFailure(false);
    assert.equal((await h.manager.lookupDictionary("alpha beta", id)).found, true);
  });
}

test("concurrent cold list and lookup serialize one migration and use the current same-version pointer", async () => {
  const h = await environment(true);
  const [listed, lookedUp] = await Promise.all([h.manager.list(), h.manager.lookupDictionary("alpha beta", id)]);
  assert.equal(listed.dictionaries[0].status, "ready");
  assert.equal(lookedUp.found, true);
  assert.equal(h.buildCalls(), 1);
});

test("Selection cancellation before activation preserves the old pointer, after commit preserves the real migration", async () => {
  const requestId = "selection-rich-lookup-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const ownerKey = "selection:270:0:fixture";
  for (const afterCommit of [false, true]) {
    const h = await environment(true);
    const before = await h.stateStore.read();
    if (afterCommit) h.storage.afterSet = () => h.manager.cancelLookup(requestId, ownerKey);
    else {
      const nativeWrite = h.store.writeFile.bind(h.store);
      h.store.writeFile = async (...args) => {
        await nativeWrite(...args);
        assert.equal(h.manager.cancelLookup(requestId, ownerKey).cancelled, true);
      };
    }
    await assert.rejects(h.manager.lookupDictionary("alpha beta", id, { requestId, ownerKey }), { name: "AbortError" });
    const state = await h.stateStore.read();
    if (afterCommit) assert.equal(state.packs[id].active.indexSchemaVersion, 2);
    else assert.deepEqual(state, before);
  }
});

test("cancelling at the final pre-activation boundary leaves the old active pointer", async () => {
  const h = await environment(true);
  const before = await h.stateStore.read();
  const controller = new AbortController();
  const nativeWrite = h.store.writeFile.bind(h.store);
  h.store.writeFile = async (...args) => { await nativeWrite(...args); controller.abort(); };
  await assert.rejects(h.load(h.snapshot, controller.signal), { name: "AbortError" });
  assert.deepEqual(await h.stateStore.read(), before);
  assert.ok(h.store.files.has(h.store.key(id, version, "index.json")));
});

test("cancellation after irreversible storage commit preserves the successfully activated pointer", async () => {
  const h = await environment(true);
  const controller = new AbortController();
  h.storage.afterSet = () => controller.abort();
  const index = await h.load(h.snapshot, controller.signal);
  assert.equal(index.schemaVersion, 2);
  assert.equal((await h.stateStore.read()).packs[id].active.indexPath, "index-normalized-v2.json");
});

test("stale packVersion or checksum changes reject activation without overwriting the new active entry", async () => {
  for (const changed of [{ packVersion: "import-fresh-87654321" }, { indexSha256: "a".repeat(64) }]) {
    const h = await environment(true);
    const nativeWrite = h.store.writeFile.bind(h.store);
    h.store.writeFile = async (...args) => {
      await nativeWrite(...args);
      await h.stateStore.update((current) => { Object.assign(current.packs[id].active, changed); return current; });
    };
    await assert.rejects(h.load(h.snapshot), { code: "RICH_MDICT_STALE" });
    const active = (await h.stateStore.read()).packs[id].active;
    assert.equal(active.indexPath, undefined);
    for (const [key, value] of Object.entries(changed)) assert.equal(active[key], value);
  }
});

test("uninstall queued during migration runs afterward and cannot be resurrected", async () => {
  const h = await environment(true);
  const started = deferred(), released = deferred();
  const nativeWrite = h.store.writeFile.bind(h.store);
  h.store.writeFile = async (...args) => { started.resolve(); await released.promise; return nativeWrite(...args); };
  const loading = h.load(h.snapshot);
  await started.promise;
  const uninstalling = h.manager.uninstall(id);
  released.resolve();
  await loading;
  await uninstalling;
  assert.equal((await h.stateStore.read()).packs[id], undefined);
  assert.equal(h.store.files.size, 0);
  await assert.rejects(h.load(h.snapshot), { code: "RICH_MDICT_STALE" });
});

test("uninstall or replacement that wins the queue rejects an old snapshot before source reads", async () => {
  for (const uninstall of [true, false]) {
    const h = await environment(true);
    await serializeRichMdictPack(id, () => h.stateStore.update((current) => {
      if (uninstall) delete current.packs[id];
      else current.packs[id].active.packVersion = "import-fresh-87654321";
      return current;
    }));
    await assert.rejects(h.load(h.snapshot), { code: "RICH_MDICT_STALE" });
    assert.equal(h.store.ranges.length, 0);
    assert.equal(h.store.writes.length, 0);
  }
});

test("an old cached schema1 cannot bypass normalization migration or serve a previous miss", async () => {
  const h = await environment(true);
  h.cache.set(cacheKey(h.snapshot), h.legacy);
  const index = await h.load(h.snapshot);
  assert.equal(index.schemaVersion, 2);
  assert.equal(h.cache.has(cacheKey(h.snapshot)), false);
  const again = await h.load(h.snapshot);
  assert.equal(again, index, "a waiting old snapshot can reuse the current same-source migrated pointer");
  assert.equal(h.buildCalls(), 1);
  assert.equal((await lookupRichMdict({ source: source(h.bytes), index: again, text: "alpha beta" })).found, true);
});

test("only the two fixed index paths can reach storage and normalized pointers require schema2", async () => {
  const h = await environment(false);
  for (const indexPath of ["../source.mdx", "source.mdx", "x/index.json", "index-normalized-v3.json", null, ""]) {
    const active = { ...h.snapshot, indexPath };
    assert.equal(isValidSnapshot(id, active), false);
    assert.throws(() => richMdictIndexPath(active), /invalid/u);
    await h.stateStore.update((current) => { current.packs[id].active = active; return current; });
    await assert.rejects(h.load(active), { code: "RICH_MDICT_CORRUPT" });
  }
  assert.equal(isValidSnapshot(id, { ...h.snapshot, indexPath: "index-normalized-v2.json", indexSchemaVersion: 1 }), false);
  assert.equal(h.store.ranges.length, 0);
});

function fixtureBytes(affected, keyOptions) {
  return makeRichMdx([["Alpha-Beta", "<p>Synthetic migration definition.</p>"], ["gamma", "<p>Another synthetic entry.</p>"]], {
    keyOptions: keyOptions || { KeyCaseSensitive: "No", [affected ? "Stripkey" : "StripKey"]: "Yes" },
    keyBlockEntryCounts: [1, 1],
    keyBlockDescriptorOverrides: [{ firstKey: "Alpha-Beta", lastKey: "Alpha-Beta" }, { firstKey: "gamma", lastKey: "gamma" }]
  });
}
async function environment(affected, keyOptions) {
  const bytes = fixtureBytes(affected, keyOptions);
  const legacy = await buildRichMdictIndex({ source: source(bytes) });
  legacy.schemaVersion = 1;
  if (affected) { legacy.header.stripKey = false; legacy.keyBlocks[0].lookupMinKey = "alpha-beta"; legacy.keyBlocks[0].lookupMaxKey = "alpha-beta"; }
  const indexBytes = new TextEncoder().encode(JSON.stringify(legacy));
  const snapshot = { packId: id, packVersion: version, sourceSize: bytes.byteLength, entryCount: legacy.entryCount,
    indexSize: indexBytes.byteLength, indexSha256: await sha256(indexBytes, webcrypto), header: legacy.header,
    title: "Synthetic migration fixture", installedAt: 123, customFlag: "retained", resources: { packVersion: version, sources: [{ sourcePath: "resources.mdd", sourceSize: 3 }] } };
  const storage = { values: { [stateKey]: { version: 1, packs: { [id]: { sourceId: "local-rich-mdict", status: "healthy", active: snapshot } } },
    preferences: { dictionaries: { [id]: { enabled: true, order: 3 } } } },
    async get() { return structuredClone(this.values); },
    async set(value) { if (this.fail) throw new Error("synthetic state failure"); Object.assign(this.values, structuredClone(value)); this.afterSet?.(); } };
  const stateStore = createPackStateStore({ storageArea: storage, stateKey });
  const store = new MemoryStore();
  store.files.set(store.key(id, version, "source.mdx"), new Uint8Array(bytes));
  store.files.set(store.key(id, version, "index.json"), indexBytes);
  store.files.set(store.key(id, version, "resources.mdd"), Uint8Array.of(1, 2, 3));
  let calls = 0, builder = buildRichMdictIndex;
  const buildIndex = async (input) => { calls += 1; return builder(input); };
  const cache = new Map();
  const sourceReader = (packId, active, signal) => ({ size: active.sourceSize, read: (offset, length) => store.readFileRange(packId, active.packVersion, "source.mdx", offset, length, signal) });
  const assertSourceSize = async (active) => assert.equal(await store.getFileSize(id, active.packVersion, "source.mdx"), active.sourceSize);
  const load = createRichMdictIndexLoader({ store, stateStore, cryptoProvider: webcrypto, buildIndex, indexCache: cache,
    serialize: serializeRichMdictPack, sourceReader, assertSourceSize });
  const createManager = () => createRichMdictManager({ store, stateStore, cryptoProvider: webcrypto, buildIndex, storageManager: null });
  return { manager: createManager(), createManager, load, store, stateStore, storage, bytes, snapshot, legacy, cache,
    buildCalls: () => calls, setBuilder: (value) => { builder = value; }, setStateFailure: (value) => { storage.fail = value; } };
}
class MemoryStore {
  files = new Map(); writes = []; ranges = []; fullReads = [];
  key(id, version, path) { return `${id}/${version}/${path}`; }
  async writeFile(id, version, path, bytes) { this.writes.push(path); this.files.set(this.key(id, version, path), new Uint8Array(bytes)); }
  async readFile(id, version, path) { this.fullReads.push(path); const bytes = this.files.get(this.key(id, version, path)); if (!bytes) throw new Error("missing synthetic file"); return new Uint8Array(bytes); }
  async readFileRange(id, version, path, offset, length) { this.ranges.push({ offset, length }); return this.files.get(this.key(id, version, path)).slice(offset, offset + length); }
  async getFileSize(id, version, path) { const bytes = this.files.get(this.key(id, version, path)); if (!bytes) throw new Error("missing synthetic file"); return bytes.byteLength; }
  async removePack(id) { for (const path of this.files.keys()) if (path.startsWith(`${id}/`)) this.files.delete(path); }
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
