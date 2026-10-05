import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createDictionaryPackManager } from "../src/background/packs/manager.js";
import { createOpfsPackStore } from "../src/background/packs/opfs-store.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import {
  hasExactJsonShapeAndValues,
  makeCuratedRichMdictProvenance,
  validateCuratedRichMdictProvenance
} from "../src/background/packs/rich-mdict-contract.js";
import { createRichMddResourceManager } from "../src/background/packs/rich-mdd-resources.js";
import { createMddResourceImportWorkerHandler } from "../src/options/workers/mdd-resource-import-worker-core.js";
import { MDD_RESOURCE_WORKER_MESSAGES } from "../src/options/workers/mdd-resource-import-worker-protocol.js";
import { makeMdd } from "./helpers/mdd-fixture.mjs";
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
const CURATED_PACK_ID = "rich-mdict-18500000-0000-4000-8000-000000000028";
const CURATED_RECIPE_ID = "ecdict-en-zh-mdx-curated";
const CURATED_PROVENANCE = makeCuratedRichMdictProvenance(CURATED_RECIPE_ID);

test("exact JSON comparison handles alphabetically reordered arrays longer than ten", () => {
  const expected = { nested: { values: Array.from({ length: 12 }, (_, index) => index) } };
  const reordered = { nested: { values: [...expected.nested.values] } };
  assert.equal(hasExactJsonShapeAndValues(reordered, expected), true);
  reordered.nested.values[10] = -1;
  assert.equal(hasExactJsonShapeAndValues(reordered, expected), false);
});

test("curated provenance validation ignores Chrome storage key order but rejects shape or value changes", () => {
  const chromeStored = Object.fromEntries(
    Object.keys(CURATED_PROVENANCE)
      .sort()
      .map((key) => [key, CURATED_PROVENANCE[key]])
  );
  assert.deepEqual(
    validateCuratedRichMdictProvenance(chromeStored, CURATED_PACK_ID),
    CURATED_PROVENANCE
  );

  assert.throws(
    () => validateCuratedRichMdictProvenance({ ...chromeStored, injected: true }, CURATED_PACK_ID),
    (error) => error?.code === "RICH_MDICT_PROVENANCE"
  );
  const missingField = Object.fromEntries(
    Object.entries(chromeStored).filter(([key]) => key !== "sourceLicenseNotice")
  );
  assert.throws(
    () => validateCuratedRichMdictProvenance(missingField, CURATED_PACK_ID),
    (error) => error?.code === "RICH_MDICT_PROVENANCE"
  );
  assert.throws(
    () => validateCuratedRichMdictProvenance({
      ...chromeStored,
      knownLimitations: [...chromeStored.knownLimitations, "tampered"]
    }, CURATED_PACK_ID),
    (error) => error?.code === "RICH_MDICT_PROVENANCE"
  );
  assert.throws(
    () => validateCuratedRichMdictProvenance({
      ...chromeStored,
      downloadBytes: chromeStored.downloadBytes + 1
    }, CURATED_PACK_ID),
    (error) => error?.code === "RICH_MDICT_PROVENANCE"
  );
});

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
  assert.equal(lookup.dictionaries[0].packVersion, BASE_ID.packVersion);
  assert.ok(env.store.ranges.some(({ path }) => path === RICH_MDICT_SOURCE_PATH));
  assert.equal(env.store.fullReads.some(({ path }) => path === RICH_MDICT_SOURCE_PATH), false);
  assert.ok(env.store.ranges.every(({ length }) => length < SOURCE_BYTES.length));
});

test("rich lookup returns the bounded raw record with the validated rendering metadata", async () => {
  const index = createIndex(SOURCE_BYTES.length);
  index.header.styleSheet = "1\n<b>\n</b>";
  index.header.styleSheetRules = [{ id: 1, begin: "<b>", end: "</b>" }];
  const env = createEnvironment({
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      return index;
    },
    lookup: async () => ({
      found: true,
      displayForm: "run",
      safeTextFallback: "run — 运行",
      rawRecord: "🦭".repeat(400_000)
    })
  });
  const metadata = await stage(env, BASE_ID, index);
  await env.manager.commit({ ...BASE_ID, metadata });

  const response = await env.manager.lookup("run");
  const richRecord = response.dictionaries[0].richRecord;
  assert.equal(response.dictionaries[0].text, "run — 运行");
  assert.equal(new TextEncoder().encode(richRecord.rawRecord).byteLength, 1024 * 1024);
  assert.equal(richRecord.format, "Html");
  assert.deepEqual(richRecord.styleSheetRules, [{ id: 1, begin: "<b>", end: "</b>" }]);
});

test("MDD preflight enforces the package-wide 4,000,000,000-byte selected-source budget", async () => {
  const env = createEnvironment();
  const metadata = await stage(env, BASE_ID);
  await env.manager.commit({ ...BASE_ID, metadata });
  const resourceManager = createRichMddResourceManager({
    store: env.store,
    stateStore: env.stateStore,
    cryptoProvider: webcrypto
  });
  const request = {
    dictionaryId: BASE_ID.packId,
    requestId: "package-budget-mdd-preflight",
    resourceVersion: "import-budget-a23e4567",
    mdxFileName: metadata.fileName,
    files: [{ fileName: "english-filename.mdd", size: 4_000_000_000 - metadata.sourceSize + 1 }]
  };
  await assert.rejects(resourceManager.preflight(request), (error) => error?.code === "RICH_MDD_LIMIT");
  assert.deepEqual((await env.stateStore.read()).resourceReservations || {}, {});
});

test("MDD worker rejects an individual or combined input over its 4,000,000,000-byte cap", async () => {
  const handler = createMddResourceImportWorkerHandler({
    postMessage() {},
    store: new MemoryStore(),
    cryptoProvider: webcrypto,
    buildIndex: async () => ({ keyCount: 1 }),
    validateIndex() {}
  });
  const fakeFile = (name, size) => ({ name, size, slice() { return new Blob([new Uint8Array([0])]); } });
  const input = {
    dictionaryId: BASE_ID.packId,
    requestId: "mdd-worker-size-guard",
    resourceVersion: "import-size-a23e4567",
    mdxFileName: "filename.mdx",
    files: [fakeFile("filename.mdd", 4_000_000_001)],
    sidecars: []
  };
  await assert.rejects(handler.handleMessage({ type: MDD_RESOURCE_WORKER_MESSAGES.START, requestId: input.requestId, input }),
    (error) => error?.code === "RICH_MDD_LIMIT");

  input.files = [fakeFile("filename.mdd", 3_999_999_990)];
  input.sidecars = [{ path: "audio/tone.wav", file: fakeFile("tone.wav", 20) }];
  await assert.rejects(handler.handleMessage({ type: MDD_RESOURCE_WORKER_MESSAGES.START, requestId: input.requestId, input }),
    (error) => error?.code === "RICH_MDD_LIMIT");

  const stored = new Map();
  const progress = [];
  const maxSource = fakeFile("filename.mdd", 4_000_000_000);
  const maxHandler = createMddResourceImportWorkerHandler({
    postMessage: (message) => progress.push(message),
    cryptoProvider: webcrypto,
    buildIndex: async ({ source }) => { await source.read(0, 1); return { keyCount: 1 }; },
    validateIndex() {},
    store: {
      async listVersions() { return []; },
      async writeFile(packId, version, path, value, options = {}) {
        const bytes = value.size ?? value.byteLength;
        stored.set(`${packId}/${version}/${path}`, bytes);
        options.onProgress?.({ bytesWritten: bytes, totalBytes: bytes });
      },
      async getFileSize(packId, version, path) { return stored.get(`${packId}/${version}/${path}`) || 0; },
      async removeVersion() { return true; }
    }
  });
  const validMaxInput = { ...input, requestId: "mdd-worker-max-source", resourceVersion: "import-max-a23e4567", files: [maxSource], sidecars: [] };
  const result = await maxHandler.handleMessage({ type: MDD_RESOURCE_WORKER_MESSAGES.START, requestId: validMaxInput.requestId, input: validMaxInput });
  assert.equal(result.type, MDD_RESOURCE_WORKER_MESSAGES.READY);
  assert.ok(progress.some((message) => message.phase === "index" && message.bytesRead === 1 && message.fileBytes === 4_000_000_000));
  assert.ok(progress.some((message) => message.phase === "store-source" && message.bytesWritten === 4_000_000_000 && message.totalBytes === 4_000_000_000));
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

test("failed curated reinstall preserves the previous active ECDICT version and lookup", async () => {
  let failNextBuild = false;
  const env = createEnvironment({
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      if (failNextBuild) throw new Error("fixture replacement index failure");
      return createIndex(source.size);
    }
  });
  const old = curatedIdentity("import-old-123e4567", "curated-old");
  const oldMetadata = await stageCurated(env, old, CURATED_PROVENANCE);
  await env.manager.commit({ ...old, metadata: oldMetadata });

  const replacement = {
    recipeId: CURATED_RECIPE_ID,
    expectedActiveVersion: old.packVersion
  };
  const next = curatedIdentity("import-new-223e4567", "curated-failed-reinstall", replacement);
  const nextMetadata = await stageCurated(env, next, CURATED_PROVENANCE);
  failNextBuild = true;
  await assert.rejects(
    env.manager.commit({ ...next, metadata: nextMetadata, catalogReplacement: replacement }),
    /fixture replacement index failure/u
  );

  const listed = await env.manager.list();
  assert.equal(listed.dictionaries.length, 1);
  assert.equal(listed.dictionaries[0].status, "ready");
  assert.equal(listed.dictionaries[0].packVersion, old.packVersion);
  assert.deepEqual(await env.store.listVersions(CURATED_PACK_ID), [old.packVersion]);
  assert.deepEqual((await env.stateStore.read()).reservations, {});
  assert.equal((await env.manager.lookup("run")).dictionaries[0].text, "run — 运行");
});

test("cancelled curated reinstall preserves the previous active ECDICT version and bytes", async () => {
  let blockNextBuild = false;
  let releaseBuild;
  let signalBuildStarted;
  const buildStarted = new Promise((resolve) => { signalBuildStarted = resolve; });
  const env = createEnvironment({
    buildIndex: async ({ source }) => {
      await source.read(0, 1);
      if (blockNextBuild) {
        blockNextBuild = false;
        signalBuildStarted();
        await new Promise((resolve) => { releaseBuild = resolve; });
      }
      return createIndex(source.size);
    }
  });
  const old = curatedIdentity("import-old-323e4567", "curated-old-cancel");
  const oldMetadata = await stageCurated(env, old, CURATED_PROVENANCE);
  await env.manager.commit({ ...old, metadata: oldMetadata });
  const oldSource = await env.store.readFile(CURATED_PACK_ID, old.packVersion, RICH_MDICT_SOURCE_PATH);

  const replacement = {
    recipeId: CURATED_RECIPE_ID,
    expectedActiveVersion: old.packVersion
  };
  const next = curatedIdentity("import-new-423e4567", "curated-cancelled-reinstall", replacement);
  const nextMetadata = await stageCurated(env, next, CURATED_PROVENANCE);
  blockNextBuild = true;
  const commit = env.manager.commit({ ...next, metadata: nextMetadata, catalogReplacement: replacement });
  await buildStarted;
  assert.deepEqual(env.manager.cancel(next.requestId), { cancelled: true, phase: "verify" });
  releaseBuild();
  await assert.rejects(commit, (error) => error?.name === "AbortError");

  const listed = await env.manager.list();
  assert.equal(listed.dictionaries[0].packVersion, old.packVersion);
  assert.deepEqual(await env.store.listVersions(CURATED_PACK_ID), [old.packVersion]);
  assert.deepEqual(
    await env.store.readFile(CURATED_PACK_ID, old.packVersion, RICH_MDICT_SOURCE_PATH),
    oldSource
  );
  assert.deepEqual((await env.stateStore.read()).reservations, {});
});

test("successful curated MDX replacement retains a usable attached MDD version and cleans the prior MDX", async () => {
  const env = createEnvironment();
  const old = curatedIdentity("import-old-723e4567", "curated-old-with-mdd");
  const oldMetadata = await stageCurated(env, old, CURATED_PROVENANCE);
  await env.manager.commit({ ...old, metadata: oldMetadata });

  const resourceManager = createRichMddResourceManager({
    store: env.store,
    stateStore: env.stateStore,
    cryptoProvider: webcrypto
  });
  const resourceBytes = makeMdd([["\\ecdict\\probe.css", encoder.encode(".probe{color:#123;}")]]);
  const resourceFile = new Blob([resourceBytes]);
  Object.defineProperty(resourceFile, "name", {
    value: "简明英汉字典增强版.mdd"
  });
  const resourceRequest = {
    dictionaryId: CURATED_PACK_ID,
    requestId: "curated-mdx-resource-attach",
    resourceVersion: "import-resource-823e4567",
    mdxFileName: "简明英汉字典增强版.mdx",
    files: [{ fileName: resourceFile.name, size: resourceFile.size }]
  };
  await resourceManager.preflight(resourceRequest);
  const resourceMessages = [];
  const resourceWorker = createMddResourceImportWorkerHandler({
    postMessage: (message) => resourceMessages.push(message),
    store: env.store,
    cryptoProvider: webcrypto
  });
  const ready = await resourceWorker.handleMessage({
    type: MDD_RESOURCE_WORKER_MESSAGES.START,
    requestId: resourceRequest.requestId,
    input: { ...resourceRequest, files: [resourceFile] }
  });
  assert.equal(ready.type, MDD_RESOURCE_WORKER_MESSAGES.READY);
  await resourceManager.commit({
    dictionaryId: resourceRequest.dictionaryId,
    requestId: resourceRequest.requestId,
    resourceVersion: resourceRequest.resourceVersion,
    metadata: ready.metadata
  });
  const resourceBefore = await resourceManager.lookupResource({
    dictionaryId: CURATED_PACK_ID,
    path: "ecdict/probe.css"
  });
  assert.equal(resourceBefore.found, true);
  assert.equal(Buffer.from(resourceBefore.base64, "base64").toString("utf8"), ".probe{color:#123;}");

  const replacement = {
    recipeId: CURATED_RECIPE_ID,
    expectedActiveVersion: old.packVersion
  };
  const next = curatedIdentity("import-new-923e4567", "curated-replace-with-mdd", replacement);
  const nextMetadata = await stageCurated(env, next, CURATED_PROVENANCE);
  const replaced = await env.manager.commit({
    ...next,
    metadata: nextMetadata,
    catalogReplacement: replacement
  });

  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.dictionary.packVersion, next.packVersion);
  const state = await env.stateStore.read();
  const active = state.packs[CURATED_PACK_ID].active;
  assert.equal(active.resources.packVersion, resourceRequest.resourceVersion);
  assert.ok(active.resources.sources[0].indexSize > 0);
  const installedWithResource = (await env.manager.list()).dictionaries[0];
  assert.equal(
    installedWithResource.installedBytes,
    active.sourceSize + active.indexSize + active.resources.sources[0].sourceSize + active.resources.sources[0].indexSize
  );
  assert.equal(installedWithResource.resourceBytes, active.resources.sources[0].sourceSize);
  assert.deepEqual(
    (await env.store.listVersions(CURATED_PACK_ID)).sort(),
    [next.packVersion, resourceRequest.resourceVersion].sort()
  );
  const resourceAfter = await resourceManager.lookupResource({
    dictionaryId: CURATED_PACK_ID,
    path: "ecdict/probe.css"
  });
  assert.equal(resourceAfter.found, true);
  assert.equal(Buffer.from(resourceAfter.base64, "base64").toString("utf8"), ".probe{color:#123;}");

  await env.manager.uninstall(CURATED_PACK_ID);
  assert.deepEqual(await env.store.listVersions(CURATED_PACK_ID), []);
  assert.deepEqual(await env.manager.list(), { dictionaries: [] });
});

test("successful curated reinstall atomically activates the new version and delete removes its data", async () => {
  const env = createEnvironment();
  const old = curatedIdentity("import-old-523e4567", "curated-old-success");
  const oldMetadata = await stageCurated(env, old, CURATED_PROVENANCE);
  await env.manager.commit({ ...old, metadata: oldMetadata });

  const replacement = {
    recipeId: CURATED_RECIPE_ID,
    expectedActiveVersion: old.packVersion
  };
  const next = curatedIdentity("import-new-623e4567", "curated-successful-reinstall", replacement);
  const nextMetadata = await stageCurated(env, next, CURATED_PROVENANCE);
  const installed = await env.manager.commit({
    ...next,
    metadata: nextMetadata,
    catalogReplacement: replacement
  });

  assert.equal(installed.status, "replaced");
  assert.equal(installed.dictionary.packVersion, next.packVersion);
  assert.deepEqual(await env.store.listVersions(CURATED_PACK_ID), [next.packVersion]);
  assert.equal((await env.manager.lookup("run")).found, true);
  assert.deepEqual(await env.manager.uninstall(CURATED_PACK_ID), { uninstalled: true });
  assert.deepEqual(await env.manager.list(), { dictionaries: [] });
  assert.deepEqual(await env.store.listVersions(CURATED_PACK_ID), []);
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

function curatedIdentity(packVersion, requestId, catalogReplacement = null) {
  return {
    requestId,
    packId: CURATED_PACK_ID,
    packVersion,
    ...(catalogReplacement ? { catalogReplacement } : {})
  };
}

async function stageCurated(env, identity, curated, index = createIndex(SOURCE_BYTES.length)) {
  await env.manager.preflightQuota(SOURCE_BYTES.length, identity);
  await env.store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_SOURCE_PATH, SOURCE_BYTES);
  const indexBytes = encoder.encode(JSON.stringify(index));
  await env.store.writeFile(identity.packId, identity.packVersion, RICH_MDICT_INDEX_PATH, indexBytes);
  return {
    sourceSize: SOURCE_BYTES.length,
    indexSize: indexBytes.length,
    indexSha256: await sha256(indexBytes),
    entryCount: index.entryCount,
    title: "ECDICT 简明英汉增强版",
    fileName: "简明英汉字典增强版.mdx",
    format: index.header.format,
    header: index.header,
    curated
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
