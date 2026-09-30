import test from "node:test";
import assert from "node:assert/strict";
import {
  createRichMdictPreferencesStore,
  RICH_MDICT_PREFERENCES_KEY
} from "../src/background/packs/rich-mdict-preferences.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import { createRichMdictViewerDictionaryLister } from "../src/background/packs/api.js";
import { RICH_MDICT_SOURCE_ID } from "../src/background/packs/rich-mdict-contract.js";

const FIRST_ID = "rich-mdict-123e4567-e89b-42d3-a456-426614174000";
const SECOND_ID = "rich-mdict-123e4567-e89b-42d3-a456-426614174001";
const THIRD_ID = "rich-mdict-123e4567-e89b-42d3-a456-426614174002";

test("new installed dictionaries get stable persisted defaults and append in install order", async () => {
  const storageArea = createStorageArea();
  const preferences = createRichMdictPreferencesStore({ storageArea });
  const installed = [
    { id: SECOND_ID, title: "Beta", installedAt: 200 },
    { id: FIRST_ID, title: "Alpha", installedAt: 100 }
  ];

  const initial = await preferences.reconcile(installed);
  assert.deepEqual(initial[FIRST_ID], {
    enabled: true,
    order: 0,
    expandedByDefault: false
  });
  assert.deepEqual(initial[SECOND_ID], {
    enabled: true,
    order: 1024,
    expandedByDefault: false
  });
  assert.equal(storageArea.value[RICH_MDICT_PREFERENCES_KEY].version, 1);

  const restarted = createRichMdictPreferencesStore({ storageArea });
  const reloaded = await restarted.reconcile(installed);
  assert.deepEqual(reloaded, initial);
});

test("concurrent field updates serialize without losing other dictionary preferences", async () => {
  const storageArea = createStorageArea();
  const preferences = createRichMdictPreferencesStore({ storageArea });
  await preferences.reconcile([
    { id: FIRST_ID, title: "Alpha", installedAt: 100 },
    { id: SECOND_ID, title: "Beta", installedAt: 200 }
  ]);

  await Promise.all([
    preferences.update(FIRST_ID, { enabled: false }),
    preferences.update(FIRST_ID, { expandedByDefault: true }),
    preferences.update(SECOND_ID, { order: 7 })
  ]);

  const stored = await preferences.readAll();
  assert.deepEqual(stored.dictionaries[FIRST_ID], {
    enabled: false,
    order: 0,
    expandedByDefault: true
  });
  assert.deepEqual(stored.dictionaries[SECOND_ID], {
    enabled: true,
    order: 7,
    expandedByDefault: false
  });
});

test("uninstall removal and installed reconciliation prune orphan preference state", async () => {
  const storageArea = createStorageArea();
  const preferences = createRichMdictPreferencesStore({ storageArea });
  await preferences.reconcile([
    { id: FIRST_ID, title: "Alpha", installedAt: 100 },
    { id: SECOND_ID, title: "Beta", installedAt: 200 }
  ]);
  await preferences.update(SECOND_ID, { enabled: false });

  assert.equal(await preferences.remove(SECOND_ID), true);
  assert.equal(await preferences.remove(SECOND_ID), false);
  assert.deepEqual(Object.keys((await preferences.readAll()).dictionaries), [FIRST_ID]);

  await preferences.reconcile([{ id: SECOND_ID, title: "Beta", installedAt: 200 }]);
  const afterReinstall = await preferences.readAll();
  assert.equal(afterReinstall.dictionaries[SECOND_ID].enabled, true);
  assert.equal(afterReinstall.dictionaries[SECOND_ID].order, 0);
});

test("viewer metadata listing returns while OPFS reads would hang", async () => {
  const ioCalls = { getFileSize: 0, readFile: 0, readFileRange: 0 };
  const neverRead = (method) => {
    ioCalls[method] += 1;
    return new Promise(() => {});
  };
  const store = {
    async writeFile() {},
    readFile: () => neverRead("readFile"),
    readFileRange: () => neverRead("readFileRange"),
    getFileSize: () => neverRead("getFileSize")
  };
  const manager = createRichMdictManager({
    store,
    stateStore: { async read() { return { packs: makeReadyPacks() }; }, async update() {} }
  });
  const storageArea = createStorageArea();
  const listViewer = createRichMdictViewerDictionaryLister({
    manager,
    preferencesStore: createRichMdictPreferencesStore({ storageArea })
  });

  const response = await Promise.race([
    listViewer(),
    new Promise((resolve) => setTimeout(() => resolve(null), 250))
  ]);
  assert.ok(response, "metadata list should not wait for OPFS file reads");
  assert.deepEqual(response.dictionaries.map(({ id, status }) => [id, status]), [
    [FIRST_ID, "ready"],
    [SECOND_ID, "ready"],
    [THIRD_ID, "corrupt"]
  ]);
  assert.equal(response.dictionaries[2].errorCode, "RICH_MDICT_CORRUPT");
  assert.deepEqual(ioCalls, { getFileSize: 0, readFile: 0, readFileRange: 0 });
});

test("reorder validates the installed ID set and writes the full order once", async () => {
  const storageArea = createStorageArea();
  const preferences = createRichMdictPreferencesStore({ storageArea });
  const installedIds = [FIRST_ID, SECOND_ID];
  await preferences.reconcile(installedIds.map((id, index) => ({ id, title: id, installedAt: index + 1 })));
  await preferences.update(SECOND_ID, { enabled: false, expandedByDefault: true });
  const writesBeforeReorder = storageArea.writes;

  const result = await preferences.reorder([SECOND_ID, FIRST_ID], installedIds);
  assert.equal(storageArea.writes - writesBeforeReorder, 1);
  assert.deepEqual(result.dictionaryIds, [SECOND_ID, FIRST_ID]);
  const stored = (await preferences.readAll()).dictionaries;
  assert.deepEqual(stored[SECOND_ID], { enabled: false, order: 0, expandedByDefault: true });
  assert.equal(stored[FIRST_ID].order, 1024);

  const writesBeforeInvalidOrder = storageArea.writes;
  assert.throws(
    () => preferences.reorder([FIRST_ID, FIRST_ID], installedIds),
    (error) => error?.code === "RICH_MDICT_PREFERENCES_ORDER"
  );
  assert.throws(
    () => preferences.reorder([FIRST_ID], installedIds),
    (error) => error?.code === "RICH_MDICT_PREFERENCES_ORDER"
  );
  assert.equal(storageArea.writes, writesBeforeInvalidOrder);
});

function makeReadyPacks() {
  const readyPacks = Object.fromEntries([[SECOND_ID, 200], [FIRST_ID, 100]].map(([id, installedAt]) => [id, {
    sourceId: RICH_MDICT_SOURCE_ID,
    status: "healthy",
    active: {
      packId: id,
      packVersion: "import-meta-12345678",
      sourceSize: 16,
      indexSize: 16,
      indexSha256: "a".repeat(64),
      title: id === FIRST_ID ? "Alpha" : "Beta",
      fileName: `${id}.mdx`,
      format: "Html",
      entryCount: 1,
      installedAt
    }
  }]));
  readyPacks[THIRD_ID] = {
    sourceId: RICH_MDICT_SOURCE_ID,
    status: "healthy",
    active: { packId: THIRD_ID, packVersion: "broken-version", title: "Broken metadata", installedAt: 300 }
  };
  return readyPacks;
}

function createStorageArea() {
  const value = {};
  return {
    value,
    writes: 0,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, structuredClone(value[key])]));
    },
    async set(items) {
      this.writes += 1;
      for (const [key, storedValue] of Object.entries(items)) value[key] = structuredClone(storedValue);
    }
  };
}
