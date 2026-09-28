import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureLockedSource,
  resolveLockedSources,
  verifySourceBytes
} from "../scripts/setup-lexicon.mjs";

test("lexicon bootstrap derives all exact HTTPS sources from the reviewed source lock", async () => {
  const lock = JSON.parse(await readFile(
    new URL("../lexicon/source-locks/core-semantic-pwn3-cow.json", import.meta.url),
    "utf8"
  ));
  const sources = resolveLockedSources(lock);
  assert.deepEqual(sources.map((source) => source.id), [
    "pwn-3.0",
    "chinese-open-wordnet",
    "pwn-3.0-sense-index"
  ]);
  assert.ok(sources.every((source) => source.url.startsWith("https://")));
  assert.ok(sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
  assert.match(sources[0].url, /406bf83b3c507a3d1f26e88252d5d66893fd36bf/);
  assert.match(sources[1].url, /406bf83b3c507a3d1f26e88252d5d66893fd36bf/);
  assert.match(sources[2].url, /ce91915ae38a341ae845be4d825ef6003cddf395/);
  assert.equal(sources[2].size, 7294043);
});

test("lexicon bootstrap fails closed on source checksum drift", () => {
  assert.throws(
    () => verifySourceBytes(new TextEncoder().encode("tampered"), {
      id: "fixture",
      sha256: "0".repeat(64)
    }),
    /checksum mismatch/
  );
});

test("lexicon bootstrap fails closed on locked source byte-size drift", () => {
  const bytes = new TextEncoder().encode("locked");
  assert.throws(
    () => verifySourceBytes(bytes, {
      id: "pwn-3.0-sense-index",
      size: bytes.byteLength + 1,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }),
    /size mismatch/
  );
});

test("lexicon bootstrap verifies downloaded bytes before replacing a bad local source", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-setup-lexicon-"));
  const targetPath = join(root, "wn-data-eng.tab");
  await writeFile(targetPath, "stale");
  const expected = new TextEncoder().encode("locked source bytes");
  const source = {
    id: "fixture",
    url: "https://example.test/locked.tab",
    sha256: createHash("sha256").update(expected).digest("hex")
  };
  let calls = 0;
  await ensureLockedSource({
    source,
    targetPath,
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, source.url);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => expected.buffer
      };
    }
  });
  assert.equal(calls, 1);
  assert.equal(await readFile(targetPath, "utf8"), "locked source bytes");
});
