import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import {
  makeRichMdictSnapshot,
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_SOURCE_ID,
  RICH_MDICT_SOURCE_PATH,
  sha256
} from "../src/background/packs/rich-mdict-contract.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";

const encoder = new TextEncoder();

test("a slow dictionary lookup does not serialize an independent rich dictionary request", { timeout: 8_000 }, async () => {
  let releaseSlow;
  let signalSlowStarted;
  let slowFinished = false;
  const slowStarted = new Promise((resolve) => { signalSlowStarted = resolve; });
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const environment = await createManagerEnvironment({
    async lookup({ index, text }) {
      if (index.header.title === "Slow synthetic fixture") {
        signalSlowStarted();
        await slowGate;
        slowFinished = true;
      }
      return {
        found: true,
        displayForm: text,
        safeTextFallback: `${index.header.title}: synthetic definition`,
        rawRecord: `<p>${index.header.title}: synthetic definition</p>`,
        sourceRecordBytes: Buffer.byteLength(`<p>${index.header.title}: synthetic definition</p>`),
        decodedTextBytes: Buffer.byteLength(`<p>${index.header.title}: synthetic definition</p>`)
      };
    }
  });

  try {
    const slowRequest = environment.manager.lookupDictionary("persistent", environment.slowId);
    await slowStarted;

    let fastDeadline;
    const fastResult = await Promise.race([
      environment.manager.lookupDictionary("persistent", environment.fastId)
        .then((value) => ({ completed: true, value })),
      new Promise((resolve) => {
        fastDeadline = setTimeout(() => resolve({ completed: false }), 2_000);
      })
    ]);
    clearTimeout(fastDeadline);

    assert.equal(fastResult.completed, true, "the fast dictionary should finish while the other read is still pending");
    assert.equal(slowFinished, false);
    assert.equal(fastResult.value.found, true);
    assert.equal(fastResult.value.errors.length, 0);
    assert.equal(fastResult.value.dictionaries[0].id, environment.fastId);
    assert.match(fastResult.value.dictionaries[0].text, /Fast synthetic fixture/u);

    releaseSlow();
    const slowResult = await slowRequest;
    assert.equal(slowFinished, true);
    assert.equal(slowResult.found, true);
    assert.equal(slowResult.dictionaries[0].id, environment.slowId);
  } finally {
    releaseSlow();
  }
});

async function createManagerEnvironment({ lookup }) {
  const slowId = "rich-mdict-10000000-0000-4000-8000-000000000001";
  const fastId = "rich-mdict-20000000-0000-4000-8000-000000000002";
  const packVersion = "import-fixture-12345678";
  const files = new Map();
  const packs = {};

  for (const [packId, title] of [
    [slowId, "Slow synthetic fixture"],
    [fastId, "Fast synthetic fixture"]
  ]) {
    const sourceBytes = makeRichMdx([
      ["persistent", `<p>${title}: synthetic definition</p>`]
    ], { title, encrypted: 2 });
    const source = {
      size: sourceBytes.byteLength,
      async read(offset, length) {
        return new Uint8Array(sourceBytes.subarray(offset, offset + length));
      }
    };
    const index = await buildRichMdictIndex({ source });
    const indexBytes = encoder.encode(JSON.stringify(index));
    const snapshot = makeRichMdictSnapshot({
      packId,
      packVersion,
      sourceSize: sourceBytes.byteLength,
      indexSize: indexBytes.byteLength,
      indexSha256: await sha256(indexBytes, webcrypto),
      fileName: `${title}.mdx`
    }, index);

    files.set(fileKey(packId, packVersion, RICH_MDICT_SOURCE_PATH), new Uint8Array(sourceBytes));
    files.set(fileKey(packId, packVersion, RICH_MDICT_INDEX_PATH), new Uint8Array(indexBytes));
    packs[packId] = {
      sourceId: RICH_MDICT_SOURCE_ID,
      status: "healthy",
      active: snapshot
    };
  }

  const store = {
    async readFile(packId, version, path) {
      const value = files.get(fileKey(packId, version, path));
      if (!value) throw new Error("fixture file not found");
      return new Uint8Array(value);
    },
    async getFileSize(packId, version, path) {
      const value = files.get(fileKey(packId, version, path));
      if (!value) throw new Error("fixture file not found");
      return value.byteLength;
    },
    async readFileRange(packId, version, path, offset, length) {
      const value = files.get(fileKey(packId, version, path));
      if (!value) throw new Error("fixture file not found");
      if (offset < 0 || length <= 0 || offset + length > value.byteLength) {
        throw new Error("fixture source range is invalid");
      }
      return value.slice(offset, offset + length);
    },
    async writeFile(packId, version, path, value) {
      files.set(fileKey(packId, version, path), new Uint8Array(value));
    }
  };
  const stateStore = {
    async read() { return { version: 1, packs }; },
    async update(update) {
      const next = await update({ version: 1, packs });
      Object.assign(packs, next.packs || {});
      return { version: 1, packs };
    }
  };
  const manager = createRichMdictManager({
    store,
    stateStore,
    cryptoProvider: webcrypto,
    storageManager: null,
    lookup
  });

  return { manager, slowId, fastId };
}

function fileKey(packId, version, path) {
  return `${packId}/${version}/${path}`;
}
