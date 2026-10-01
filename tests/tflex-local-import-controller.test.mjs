import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_MESSAGES } from "../src/shared/constants.js";
import { createTflexLocalImportController } from "../src/options/tflex-local-import-controller.js";

const ID = "123e4567-e89b-42d3-a456-426614174000";

test("TFLex local UI controller stages bounded files then asks the existing commit path to fully validate", async () => {
  const quarantine = memoryQuarantine();
  const messages = [];
  const controller = createTflexLocalImportController({
    cryptoProvider: { randomUUID: () => ID },
    quarantine,
    runtime: { async sendMessage(message) { messages.push(message); return { ok: true, dictionary: { id: "fixture" } }; } }
  });
  const result = await controller.importDictionary({ files: files(), displayMetadata: { name: "Fixture", format: "tflex" } });

  assert.equal(result.commit.ok, true);
  assert.deepEqual(quarantine.writes.map(({ path }) => path), ["entries.dat", "index.dat", "manifest.json"]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT);
  assert.equal(messages[0].requestId, `local-tflex-${ID}`);
  assert.deepEqual(messages[0].displayMetadata, { name: "Fixture", format: "tflex" });
  assert.equal(quarantine.removed.length, 1);
  assert.equal(controller.phase, "");
});

test("TFLex local UI controller removes all quarantine data when the existing commit validator rejects files", async () => {
  const quarantine = memoryQuarantine();
  const controller = createTflexLocalImportController({
    cryptoProvider: { randomUUID: () => ID },
    quarantine,
    runtime: { async sendMessage() { return { ok: false, errorCode: "TFLEX_HASH_MISMATCH", error: "Hash mismatch" }; } }
  });

  await assert.rejects(controller.importDictionary({ files: files() }), /Hash mismatch/u);
  assert.equal(quarantine.removed.length, 1);
  assert.equal(quarantine.contents.size, 0);
  assert.equal(controller.phase, "");
});

test("TFLex local UI controller aborts bounded staging and cleans its quarantine token", async () => {
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const quarantine = memoryQuarantine({ blockWrite: signalStarted });
  const controller = createTflexLocalImportController({
    cryptoProvider: { randomUUID: () => ID }, quarantine,
    runtime: { async sendMessage() { throw new Error("commit must not run after staging cancellation"); } }
  });
  const pending = controller.importDictionary({ files: files() });
  await started;
  assert.deepEqual(await controller.cancel(), { cancelled: true, phase: "stage" });
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(quarantine.removed.length, 1);
  assert.equal(quarantine.contents.size, 0);
});

function files() {
  return ["manifest.json", "index.dat", "entries.dat"].map((name) => {
    const blob = new Blob([`fixture-${name}`]);
    return Object.assign(blob, { name });
  });
}

function memoryQuarantine({ blockWrite } = {}) {
  const contents = new Map();
  const writes = [];
  const removed = [];
  let blocked = false;
  return {
    contents, writes, removed,
    async writeBlob(token, path, blob, { signal } = {}) {
      writes.push({ token, path, size: blob.size });
      if (blockWrite && !blocked) {
        blocked = true;
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          blockWrite();
        });
      }
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const values = contents.get(token) || new Map();
      values.set(path, blob.size);
      contents.set(token, values);
    },
    async listFiles(token) {
      return [...(contents.get(token) || new Map())].map(([path, size]) => ({ path, size }));
    },
    async remove(token) { removed.push(token); contents.delete(token); }
  };
}
