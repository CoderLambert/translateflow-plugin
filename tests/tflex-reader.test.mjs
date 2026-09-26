import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { LEXICAL_ERROR_CODES } from "../src/shared/lexical.js";
import { ByteBoundedLru } from "../src/background/lexical/lru.js";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/tflex-runtime-pack/", import.meta.url));

function fixtureReader(options = {}) {
  let reads = 0;
  const reader = createTflexReader({
    packBasePath: "fixture",
    cryptoProvider: webcrypto,
    cacheMaxEntries: options.cacheMaxEntries || 2,
    cacheMaxBytes: options.cacheMaxBytes || 4096,
    readBytes: async (path) => {
      reads += 1;
      const relative = path.replace(/^fixture\//, "");
      let bytes = new Uint8Array(await readFile(join(fixtureRoot, relative)));
      if (options.corruptShard && relative.startsWith("shards/")) {
        const corrupt = new Uint8Array(bytes.byteLength + 1);
        corrupt.set(bytes);
        corrupt[corrupt.length - 1] = 32;
        bytes = corrupt;
      }
      if (options.mutateManifest && relative === "manifest.json") {
        const manifest = JSON.parse(new TextDecoder().decode(bytes));
        options.mutateManifest(manifest);
        bytes = new TextEncoder().encode(JSON.stringify(manifest));
      }
      return bytes;
    }
  });
  return { reader, reads: () => reads };
}

test("TFLex reader loads exact words/phrases and preserves polysemy", async () => {
  const { reader } = fixtureReader();
  const persistent = await reader.lookup("persistent");
  assert.equal(persistent.pack.packId, "core-semantic-en-zh-runtime-fixture");
  assert.equal(persistent.exactCaseMatch, true);
  assert.equal(persistent.record.senses.length, 2);
  assert.deepEqual(persistent.record.senses.map((sense) => sense.translations), [
    ["持久的", "持续存在的"],
    ["顽强的"]
  ]);

  const phrase = await reader.lookup("terminal multiplexer");
  assert.equal(phrase.record.displayForm, "terminal multiplexer");
  assert.deepEqual(phrase.record.senses[0].translations, ["终端复用器"]);
  assert.equal(await reader.lookup("not-in-pack"), null);
});

test("TFLex reader resolves one-to-one and ambiguous aliases without full-pack scanning", async () => {
  const { reader, reads } = fixtureReader();

  const single = await reader.lookupAll("term mux");
  assert.equal(single.length, 1);
  assert.equal(single[0].matchedAlias, true);
  assert.equal(single[0].record.lookupKey, "terminal multiplexer");
  assert.equal(single[0].aliasKey, "term mux");

  const ambiguous = await reader.lookupAll("stateful");
  assert.deepEqual(ambiguous.map((hit) => hit.record.lookupKey), ["persistent", "session"]);
  assert.ok(ambiguous.every((hit) => hit.matchedAlias));
  assert.ok(reads() <= 3, "manifest + directory + one decoded shard should satisfy both alias queries");
});

test("TFLex shard cache is bounded and repeated lookup reuses the decoded shard", async () => {
  const { reader, reads } = fixtureReader({ cacheMaxEntries: 1, cacheMaxBytes: 4096 });
  await reader.lookup("persistent");
  const afterFirst = reads();
  await reader.lookup("session");
  assert.equal(reads(), afterFirst);
  const stats = reader.stats().cache;
  assert.ok(stats.entries <= 1);
  assert.ok(stats.bytes <= 4096);
});

test("TFLex reader fails closed on corrupted shard bytes", async () => {
  const { reader } = fixtureReader({ corruptShard: true });
  await assert.rejects(
    reader.lookup("persistent"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT && /size mismatch|hash mismatch/.test(error.message)
  );
});

test("TFLex reader detects manifest fingerprint drift", async () => {
  const { reader } = fixtureReader({
    mutateManifest(manifest) {
      manifest.packVersion = "tampered";
    }
  });
  await assert.rejects(
    reader.lookup("persistent"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT && /fingerprint mismatch/.test(error.message)
  );
});

test("TFLex reader returns typed storage and compatibility errors", async () => {
  const storageReader = createTflexReader({
    packBasePath: "fixture",
    cryptoProvider: webcrypto,
    readBytes: async () => { throw new Error("missing"); }
  });
  await assert.rejects(
    storageReader.lookup("persistent"),
    (error) => error?.code === LEXICAL_ERROR_CODES.STORAGE
  );

  const { reader } = fixtureReader({
    mutateManifest(manifest) {
      manifest.readerMinVersion = 2;
    }
  });
  await assert.rejects(
    reader.lookup("persistent"),
    (error) => error?.code === LEXICAL_ERROR_CODES.INCOMPATIBLE
  );
});

test("ByteBoundedLru enforces entry and byte budgets", () => {
  const lru = new ByteBoundedLru({ maxEntries: 2, maxBytes: 10 });
  lru.set("a", 1, 4);
  lru.set("b", 2, 4);
  assert.equal(lru.get("a"), 1);
  lru.set("c", 3, 4);
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.stats().entries, 2);
  assert.ok(lru.stats().bytes <= 10);
  assert.equal(lru.set("oversize", 4, 20), false);
});
