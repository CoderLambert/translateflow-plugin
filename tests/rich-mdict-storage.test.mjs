import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createDictionaryPackManager } from "../src/background/packs/manager.js";
import { createOpfsPackStore } from "../src/background/packs/opfs-store.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_OPFS_ROOT,
  RICH_MDICT_SOURCE_PATH
} from "../src/background/packs/rich-mdict-contract.js";
import { createPackStateStore } from "../src/background/packs/state.js";
import { PACK_MANAGER_STATE_KEY } from "../src/shared/pack-manager.js";

const encoder = new TextEncoder();
const SOURCE_BYTES = new Uint8Array(128).fill(0x61);
const BASE_ID = {
  requestId: "rich-storage-request-1",
  packId: "rich-mdict-123e4567-e89b-42d3-a456-426614174000",
  packVersion: "import-m1234-123e4567"
};

test("Rich MDict commit rechecks the compact index and lookup uses OPFS ranges after reload", async () => {
  const env = createEnvironment();
  const metadata = await stage(env, BASE_ID);
  const committed = await env.manager.commit({ ...BASE_ID, metadata });
  assert.equal(committed.status, "installed");
  assert.equal(committed.dictionary.title, "真实词典标题");

  const restarted = env.createManager();
  const listed = await restarted.list();
  assert.equal(listed.dictionaries[0].status, "ready");
  assert.equal(listed.dictionaries[0].title, "真实词典标题");
  const lookup = await restarted.lookup("run");
  assert.equal(lookup.found, true);
  assert.equal(lookup.dictionaries[0].text, "run — 运行");
  assert.ok(env.store.ranges.some(({ path }) => path === RICH_MDICT_SOURCE_PATH));
  assert.equal(env.store.fullReads.some(({ path }) => path === RICH_MDICT_SOURCE_PATH), false);
  assert.ok(env.store.ranges.every(({ length }) => length < SOURCE_BYTES.length));
});

test("a same-size persisted index that differs from the MDX source is rejected before activation", async () => {
  const env = createEnvironment();
  const index = createIndex(SOURCE_BYTES.length);
  index.header.title = "tampered title";
  const metadata = await stage(env, BASE_ID, index);

  await assert.rejects(
    env.manager.commit({ ...BASE_ID, metadata }),
    (error) => error?.code === "RICH_MDICT_CORRUPT"
  );
  assert.deepEqual((await env.stateStore.read()).packs, {});
  assert.deepEqual((await env.stateStore.read()).reservations, {});
  assert.deepEqual(await env.store.listVersions(BASE_ID.packId), []);
});

test("cancel, abort, commit and uninstall serialize without leaving a cancelled active pack", async () => {
  let releaseBuild;
  let signalBuildStarted;
  const buildStarted = new Promise((resolve) => { signalBuildStarted = resolve; });
  const env = createEnvironment({
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      signalBuildStarted();
      await new Promise((resolve) => { releaseBuild = resolve; });
      return createIndex(source.size);
    }
  });
  const metadata = await stage(env, BASE_ID);
  const committing = env.manager.commit({ ...BASE_ID, metadata });
  await buildStarted;
  const aborting = env.manager.abortImport(BASE_ID);
  releaseBuild();

  await committing;
  assert.deepEqual(await aborting, { removed: false, installed: true });
  assert.equal((await env.manager.list()).dictionaries[0].status, "ready");
  assert.deepEqual(await env.manager.uninstall(BASE_ID.packId), { uninstalled: true });
  assert.deepEqual(await env.manager.list(), { dictionaries: [] });
});

test("commit cancellation removes reserved staging and does not publish active state", async () => {
  let releaseBuild;
  let signalBuildStarted;
  const buildStarted = new Promise((resolve) => { signalBuildStarted = resolve; });
  const env = createEnvironment({
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      signalBuildStarted();
      await new Promise((resolve) => { releaseBuild = resolve; });
      return createIndex(source.size);
    }
  });
  const metadata = await stage(env, BASE_ID);
  const committing = env.manager.commit({ ...BASE_ID, metadata });
  await buildStarted;

  assert.deepEqual(env.manager.cancel(BASE_ID.requestId), { cancelled: true, phase: "verify" });
  releaseBuild();
  await assert.rejects(committing, (error) => error?.name === "AbortError");
  assert.deepEqual((await env.stateStore.read()).packs, {});
  assert.deepEqual((await env.stateStore.read()).reservations, {});
  assert.deepEqual(await env.store.listVersions(BASE_ID.packId), []);
});

test("duplicate dictionary identity is rejected and cached lookups notice a missing index", async () => {
  const env = createEnvironment();
  await env.manager.preflightQuota(SOURCE_BYTES.length, BASE_ID);
  await assert.rejects(
    env.manager.preflightQuota(SOURCE_BYTES.length, BASE_ID),
    (error) => error?.code === "RICH_MDICT_EXISTS"
  );
  await env.manager.abortImport(BASE_ID);
  const metadata = await stage(env, BASE_ID);
  await env.manager.commit({ ...BASE_ID, metadata });
  const sourceBefore = await env.store.readFile(BASE_ID.packId, BASE_ID.packVersion, RICH_MDICT_SOURCE_PATH);

  await assert.rejects(
    env.manager.preflightQuota(SOURCE_BYTES.length, {
      requestId: "rich-storage-request-2",
      packId: BASE_ID.packId,
      packVersion: "import-m5678-123e4567"
    }),
    (error) => error?.code === "RICH_MDICT_EXISTS"
  );
  assert.deepEqual(
    await env.store.readFile(BASE_ID.packId, BASE_ID.packVersion, RICH_MDICT_SOURCE_PATH),
    sourceBefore
  );

  await env.manager.lookup("run");
  env.store.deleteFile(BASE_ID.packId, BASE_ID.packVersion, RICH_MDICT_INDEX_PATH);
  const list = await env.manager.list();
  assert.equal(list.dictionaries[0].status, "missing");
});

test("failed uninstall retains a visible row and a retry removes it cleanly", async () => {
  const env = createEnvironment();
  const metadata = await stage(env, BASE_ID);
  await env.manager.commit({ ...BASE_ID, metadata });
  env.store.failRemovePackOnce = true;

  await assert.rejects(env.manager.uninstall(BASE_ID.packId), /fixture remove failure/);
  assert.equal((await env.manager.list()).dictionaries[0].status, "ready");
  assert.deepEqual(await env.manager.uninstall(BASE_ID.packId), { uninstalled: true });
  assert.deepEqual(await env.manager.list(), { dictionaries: [] });
});

test("structured pack recovery does not delete active or staged rich data in the shared OPFS root", async () => {
  const root = new MemoryDirectory();
  const rootProvider = async () => root;
  const structuredStore = createOpfsPackStore({ rootProvider });
  const richStore = createOpfsPackStore({ rootProvider, rootDir: RICH_MDICT_OPFS_ROOT });
  const storageArea = new MemoryStorageArea();
  const richStateStore = createPackStateStore({ storageArea, stateKey: "rich-mdict-root-test" });
  const structuredStateStore = createPackStateStore({ storageArea, stateKey: PACK_MANAGER_STATE_KEY });
  const richManager = createRichMdictManager({
    store: richStore,
    stateStore: richStateStore,
    cryptoProvider: webcrypto,
    storageManager: null,
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      return createIndex(source.size);
    },
    lookup: async () => ({ found: false })
  });
  const activeMetadata = await stageWithStore(richManager, richStore, BASE_ID);
  await richManager.commit({ ...BASE_ID, metadata: activeMetadata });

  const stagedIdentity = {
    requestId: "rich-storage-request-staged",
    packId: "rich-mdict-123e4567-e89b-42d3-a456-426614174001",
    packVersion: "import-m5678-123e4567"
  };
  await richManager.preflightQuota(SOURCE_BYTES.length, stagedIdentity);
  await richStore.writeFile(stagedIdentity.packId, stagedIdentity.packVersion, RICH_MDICT_SOURCE_PATH, SOURCE_BYTES);

  const structuredManager = createDictionaryPackManager({
    store: structuredStore,
    stateStore: structuredStateStore,
    permissions: null,
    storageManager: null,
    cryptoProvider: webcrypto
  });
  await structuredManager.recoverAll();

  assert.deepEqual(await structuredStore.listPacks(), []);
  assert.deepEqual(await richStore.listPacks(), [BASE_ID.packId, stagedIdentity.packId].sort());
  assert.equal(await richStore.getFileSize(BASE_ID.packId, BASE_ID.packVersion, RICH_MDICT_SOURCE_PATH), SOURCE_BYTES.length);
  assert.equal(await richStore.getFileSize(stagedIdentity.packId, stagedIdentity.packVersion, RICH_MDICT_SOURCE_PATH), SOURCE_BYTES.length);
  assert.equal((await richManager.list()).dictionaries[0].status, "ready");
});

async function stage(env, identity, index = createIndex(SOURCE_BYTES.length)) {
  await env.manager.preflightQuota(SOURCE_BYTES.length, identity);
  await env.store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_SOURCE_PATH, SOURCE_BYTES);
  const indexBytes = encoder.encode(JSON.stringify(index));
  await env.store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_INDEX_PATH, indexBytes);
  return {
    sourceSize: SOURCE_BYTES.length,
    indexSize: indexBytes.length,
    indexSha256: await sha256(indexBytes),
    entryCount: index.entryCount,
    title: "ignored filename title",
    fileName: "english-filename.mdx",
    format: index.header.format,
    header: index.header
  };
}

async function stageWithStore(manager, store, identity) {
  await manager.preflightQuota(SOURCE_BYTES.length, identity);
  await store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_SOURCE_PATH, SOURCE_BYTES);
  const index = createIndex(SOURCE_BYTES.length);
  const indexBytes = encoder.encode(JSON.stringify(index));
  await store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_INDEX_PATH, indexBytes);
  return {
    sourceSize: SOURCE_BYTES.length,
    indexSize: indexBytes.length,
    indexSha256: await sha256(indexBytes),
    entryCount: index.entryCount,
    title: "test",
    fileName: "filename.mdx",
    format: index.header.format,
    header: index.header
  };
}

function createEnvironment(overrides = {}) {
  const store = new MemoryStore();
  const storageArea = new MemoryStorageArea();
  const stateStore = createPackStateStore({ storageArea, stateKey: "rich-mdict-test-state" });
  const builder = overrides.buildIndex || (async ({ source }) => {
    await source.read(0, 1);
    return createIndex(source.size);
  });
  const dependencies = {
    store,
    stateStore,
    cryptoProvider: webcrypto,
    storageManager: null,
    buildIndex: builder,
    lookup: overrides.lookup || (async ({ source, text }) => {
      await source.read(92, 8);
      return text === "run"
        ? { found: true, displayForm: "run", safeTextFallback: "run — 运行" }
        : { found: false };
    })
  };
  const createManager = () => createRichMdictManager(dependencies);
  const manager = createManager();
  return { store, stateStore, manager, createManager };
}

function createIndex(sourceSize) {
  return {
    schemaVersion: 1,
    format: "mdx-v2-rich",
    sourceSize,
    entryCount: 1,
    totalRecordBytes: 6,
    keyPreambleOffset: 0,
    keyInfoOffset: 44,
    keyInfoCompressedBytes: 8,
    keyBlocksOffset: 52,
    keyBlocksBytes: 8,
    recordSectionOffset: 60,
    recordBlocksOffset: 92,
    recordBlocksBytes: sourceSize - 92,
    keyInfoCompression: "zlib",
    keyInfoEncrypted: false,
    header: {
      generatedByEngineVersion: "2.0",
      requiredEngineVersion: "2.0",
      title: "真实词典标题",
      format: "Html",
      encoding: "UTF-8",
      encrypted: 0,
      keyCaseSensitive: false,
      stripKey: false,
      compact: "No",
      compat: "No",
      styleSheet: "",
      styleSheetRules: []
    },
    keyBlocks: [{
      dataOffset: 52,
      compressedBytes: 8,
      decompressedBytes: 12,
      entryCount: 1,
      firstEntryIndex: 0,
      firstRecordOffset: 0,
      lastRecordOffset: 5,
      firstKey: "run",
      lastKey: "run",
      lookupMinKey: "run",
      lookupMaxKey: "run"
    }],
    recordBlocks: [{
      dataOffset: 92,
      uncompressedOffset: 0,
      compressedBytes: sourceSize - 92,
      decompressedBytes: 6
    }]
  };
}

async function sha256(bytes) {
  const digest = new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

class MemoryStorageArea {
  values = {};
  async get(keys) {
    const result = {};
    for (const key of keys) if (key in this.values) result[key] = structuredClone(this.values[key]);
    return result;
  }
  async set(values) {
    Object.assign(this.values, structuredClone(values));
  }
}

class MemoryStore {
  files = new Map();
  ranges = [];
  fullReads = [];
  failRemovePackOnce = false;

  key(packId, version, path) { return `${packId}/${version}/${path}`; }
  async writeFile(packId, version, path, bytes) {
    const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(await new Blob([bytes]).arrayBuffer());
    this.files.set(this.key(packId, version, path), data);
  }
  async readFile(packId, version, path) {
    this.fullReads.push({ packId, version, path });
    const data = this.files.get(this.key(packId, version, path));
    if (!data) throw missingFile();
    return new Uint8Array(data);
  }
  async readFileRange(packId, version, path, offset, length) {
    this.ranges.push({ packId, version, path, offset, length });
    const data = this.files.get(this.key(packId, version, path));
    if (!data) throw missingFile();
    if (offset < 0 || length <= 0 || offset + length > data.length) throw new Error("invalid range");
    return data.slice(offset, offset + length);
  }
  async getFileSize(packId, version, path) {
    const data = this.files.get(this.key(packId, version, path));
    if (!data) throw missingFile();
    return data.length;
  }
  async listVersions(packId) {
    const prefix = `${packId}/`;
    return [...new Set([...this.files.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length).split("/")[0]))];
  }
  async removeVersion(packId, version) {
    const prefix = `${packId}/${version}/`;
    let removed = false;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        this.files.delete(key);
        removed = true;
      }
    }
    return removed;
  }
  async removePack(packId) {
    if (this.failRemovePackOnce) {
      this.failRemovePackOnce = false;
      throw new Error("fixture remove failure");
    }
    let removed = false;
    for (const key of this.files.keys()) {
      if (key.startsWith(`${packId}/`)) {
        this.files.delete(key);
        removed = true;
      }
    }
    return removed;
  }
  deleteFile(packId, version, path) {
    this.files.delete(this.key(packId, version, path));
  }
}

class MemoryDirectory {
  directories = new Map();
  files = new Map();

  async getDirectoryHandle(name, { create = false } = {}) {
    let directory = this.directories.get(name);
    if (!directory && create) {
      directory = new MemoryDirectory();
      this.directories.set(name, directory);
    }
    if (!directory) throw opfsNotFound();
    return directory;
  }

  async getFileHandle(name, { create = false } = {}) {
    let file = this.files.get(name);
    if (!file && create) {
      file = new MemoryFile();
      this.files.set(name, file);
    }
    if (!file) throw opfsNotFound();
    return file;
  }

  async removeEntry(name) {
    if (this.files.delete(name)) return;
    if (!this.directories.delete(name)) throw opfsNotFound();
  }

  async *entries() {
    for (const [name, value] of this.directories) yield [name, { ...value, kind: "directory" }];
    for (const [name, value] of this.files) yield [name, { ...value, kind: "file" }];
  }
}

class MemoryFile {
  kind = "file";
  bytes = new Uint8Array();
  async createWritable() {
    let pending = this.bytes;
    return {
      write: async (value) => {
        if (value instanceof Uint8Array) pending = new Uint8Array(value);
        else pending = new Uint8Array(await new Blob([value]).arrayBuffer());
      },
      close: async () => { this.bytes = new Uint8Array(pending); },
      abort: async () => {}
    };
  }
  async getFile() { return new Blob([this.bytes]); }
}

function missingFile() {
  const error = new Error("fixture file is missing");
  error.code = "PACK_STORAGE";
  error.missing = true;
  return error;
}

function opfsNotFound() {
  const error = new Error("fixture entry is missing");
  error.name = "NotFoundError";
  return error;
}
