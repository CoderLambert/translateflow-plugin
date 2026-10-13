import { createHash } from "node:crypto";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich.js";
import { buildMddIndex } from "../src/background/packs/importers/mdd.js";
import { makeResourceSnapshot } from "../src/background/packs/rich-mdd-contract.js";

const affectedId = "rich-mdict-123e4567-e89b-42d3-a456-426614174270";
const unaffectedId = "rich-mdict-123e4567-e89b-42d3-a456-426614174271";
const packVersion = "import-fixture-12345678";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = (bytes) => ({ size: bytes.byteLength, async read(offset, length) { return bytes.slice(offset, offset + length); } });

test("legacy Stripkey index migrates in real OPFS, preserves MDD/preferences and survives browser restart without rebuilding unaffected legacy", async ({ harness }) => {
  test.setTimeout(120_000);
  await harness.reset();
  const fixtures = await Promise.all([makeInstalledFixture(affectedId, true), makeInstalledFixture(unaffectedId, false)]);
  await seedLegacyFixtures(harness, fixtures);
  const before = await readInstalledEvidence(harness, fixtures);
  const page = await harness.open("/selection");
  await harness.inject(page);
  const affected = await lookupFromContent(harness, page, affectedId);
  expect(affected.ok).toBe(true);
  expect(affected.found).toBe(true);
  expect(affected.dictionaries[0].text).toContain("Synthetic migration entry");
  const unaffected = await lookupFromContent(harness, page, unaffectedId);
  expect(unaffected.ok).toBe(true);
  expect(unaffected.found).toBe(true);
  const after = await readInstalledEvidence(harness, fixtures);
  expect(after.preferences).toEqual(before.preferences);
  expect(after.files).toEqual(before.files);
  const active = after.state.packs[affectedId].active;
  expect(active.indexPath).toBe("index-normalized-v2.json");
  expect(active.indexSchemaVersion).toBe(2);
  expect(active.header.stripKey).toBe(true);
  expect(active.indexSha256).not.toBe(before.state.packs[affectedId].active.indexSha256);
  expect(active.resources).toEqual(before.state.packs[affectedId].active.resources);
  expect(active.packVersion).toBe(packVersion);
  expect(active.installedAt).toBe(before.state.packs[affectedId].active.installedAt);
  expect(after.normalizedIndexes[affectedId]).toEqual({ schemaVersion: 2, sha256: active.indexSha256, size: active.indexSize });
  expect(after.state.packs[unaffectedId]).toEqual(before.state.packs[unaffectedId]);
  expect(after.normalizedIndexes[unaffectedId]).toBeNull();
  const resource = await resourceFromContent(harness, page, affectedId);
  expect(resource.ok).toBe(true);
  expect(resource.found).toBe(true);
  expect(hash(Buffer.from(resource.base64, "base64"))).toBe(hash(fixtures[0].asset));

  const restart = await harness.restartBrowser();
  expect(restart.restartedPersistentProfile).toBe(true);
  const revisited = await harness.open("/selection");
  await harness.inject(revisited);
  expect((await lookupFromContent(harness, revisited, affectedId)).found).toBe(true);
  expect((await lookupFromContent(harness, revisited, unaffectedId)).found).toBe(true);
  const persisted = await readInstalledEvidence(harness, fixtures);
  expect(persisted).toEqual(after);
  const persistedResource = await resourceFromContent(harness, revisited, affectedId);
  expect(persistedResource.found).toBe(true);
  expect(hash(Buffer.from(persistedResource.base64, "base64"))).toBe(hash(fixtures[0].asset));
  expect(harness.server.calls).toHaveLength(0);
});

async function makeInstalledFixture(packId, affected) {
  const bytes = makeRichMdx([["Alpha-Beta", "<p>Synthetic migration entry.</p>"]], {
    keyOptions: { KeyCaseSensitive: "No", [affected ? "Stripkey" : "StripKey"]: "Yes" },
    keyBlockDescriptorOverrides: [{ firstKey: "Alpha-Beta", lastKey: "Alpha-Beta" }]
  });
  const legacy = await buildRichMdictIndex({ source: source(bytes) });
  legacy.schemaVersion = 1;
  if (affected) {
    legacy.header.stripKey = false;
    legacy.keyBlocks[0].lookupMinKey = "alpha-beta";
    legacy.keyBlocks[0].lookupMaxKey = "alpha-beta";
  }
  const indexBytes = Buffer.from(JSON.stringify(legacy));
  const asset = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
  const mdd = makeMdd([["sample.png", asset]]);
  const mddIndex = await buildMddIndex({ source: source(mdd) });
  const mddIndexBytes = Buffer.from(JSON.stringify(mddIndex));
  const resources = makeResourceSnapshot({ packId, packVersion, mdxFileName: "fixture.mdx", resources: [{
    fileName: "fixture.mdd", sourceSize: mdd.byteLength, indexSize: mddIndexBytes.byteLength,
    indexSha256: hash(mddIndexBytes), keyCount: mddIndex.keyCount
  }] });
  return { packId, asset, snapshot: { packId, packVersion, sourceSize: bytes.byteLength, entryCount: legacy.entryCount,
    indexSize: indexBytes.byteLength, indexSha256: hash(indexBytes), header: legacy.header, title: "Synthetic migration fixture",
    fileName: "fixture.mdx", installedAt: 123, resources },
  files: { "source.mdx": [...bytes], "index.json": [...indexBytes],
    "resources/000.mdd": [...mdd], "resources/000.index.json": [...mddIndexBytes] } };
}

async function seedLegacyFixtures(harness, fixtures) {
  await harness.driver.evaluate(async ({ fixtures, packVersion }) => {
    const root = await navigator.storage.getDirectory();
    const dictionaries = await root.getDirectoryHandle("rich-mdict-dictionaries", { create: true });
    const packs = {}, preferences = {};
    for (const [order, fixture] of fixtures.entries()) {
      const pack = await dictionaries.getDirectoryHandle(fixture.packId, { create: true });
      const version = await pack.getDirectoryHandle(packVersion, { create: true });
      for (const [path, bytes] of Object.entries(fixture.files)) {
        let directory = version;
        const parts = path.split("/");
        for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name, { create: true });
        const handle = await directory.getFileHandle(parts.at(-1), { create: true });
        const writable = await handle.createWritable();
        await writable.write(new Uint8Array(bytes));
        await writable.close();
      }
      packs[fixture.packId] = { sourceId: "local-rich-mdict", status: "healthy", active: fixture.snapshot };
      preferences[fixture.packId] = { enabled: true, order, expandedByDefault: false };
    }
    await chrome.storage.local.set({ tfRichMdictStateV1: { version: 1, packs },
      tfRichMdictPreferencesV1: { version: 1, dictionaries: preferences } });
  }, { fixtures: fixtures.map(({ packId, snapshot, files }) => ({ packId, snapshot, files })), packVersion });
}

async function readInstalledEvidence(harness, fixtures) {
  return harness.driver.evaluate(async ({ fixtures, packVersion }) => {
    const hash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const stored = await chrome.storage.local.get(["tfRichMdictStateV1", "tfRichMdictPreferencesV1"]);
    const root = await navigator.storage.getDirectory();
    const dictionaries = await root.getDirectoryHandle("rich-mdict-dictionaries");
    const files = {}, normalizedIndexes = {};
    for (const fixture of fixtures) {
      const pack = await dictionaries.getDirectoryHandle(fixture.packId);
      const version = await pack.getDirectoryHandle(packVersion);
      for (const path of Object.keys(fixture.files)) {
        let directory = version;
        const parts = path.split("/");
        for (const name of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(name);
        const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
        files[`${fixture.packId}/${path}`] = await hash(await file.arrayBuffer());
      }
      try {
        const file = await (await version.getFileHandle("index-normalized-v2.json")).getFile();
        const bytes = await file.arrayBuffer();
        normalizedIndexes[fixture.packId] = { schemaVersion: JSON.parse(new TextDecoder().decode(bytes)).schemaVersion, sha256: await hash(bytes), size: file.size };
      } catch (error) { if (error.name !== "NotFoundError") throw error; normalizedIndexes[fixture.packId] = null; }
    }
    return { state: stored.tfRichMdictStateV1, preferences: stored.tfRichMdictPreferencesV1, files, normalizedIndexes };
  }, { fixtures: fixtures.map(({ packId, files }) => ({ packId, files: Object.fromEntries(Object.keys(files).map((path) => [path, true])) })), packVersion });
}

async function lookupFromContent(harness, page, dictionaryId) {
  return contentMessage(harness, page, { type: "RICH_MDICT_LOOKUP", dictionaryId, text: "alpha beta" });
}
async function resourceFromContent(harness, page, dictionaryId) {
  return contentMessage(harness, page, { type: "RICH_MDD_RESOURCE", dictionaryId, path: "sample.png", packageVersion: packVersion });
}
async function contentMessage(harness, page, input) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, input }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId },
      func: (input) => chrome.runtime.sendMessage({ ...input,
        requestId: `${input.type === "RICH_MDICT_LOOKUP" ? "selection-rich-lookup" : "selection-mdd-resource"}-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerToken: crypto.randomUUID().replaceAll("-", "") }), args: [input] });
    return result.result;
  }, { tabId, input });
}
