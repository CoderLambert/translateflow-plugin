import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeEntries,
  zipDeflateProxy
} from "../scripts/measure-extension-footprint.mjs";

test("footprint categorization keeps runtime and lexical packs separate", () => {
  const entries = [
    { path: "manifest.json", bytes: 100, compressedBytes: 60 },
    { path: "src/background.js", bytes: 200, compressedBytes: 100 },
    { path: "assets/lexicon/core/manifest.json", bytes: 300, compressedBytes: 120 },
    { path: "assets/lexicon/core/shards/0000.jsonl", bytes: 900, compressedBytes: 240 },
    { path: "assets/lexicon/technical/manifest.json", bytes: 80, compressedBytes: 50 },
    { path: "assets/lexicon/other/readme.txt", bytes: 20, compressedBytes: 18 }
  ];

  const groups = categorizeEntries(entries);
  assert.deepEqual(groups.runtime.map((entry) => entry.path), [
    "manifest.json",
    "src/background.js"
  ]);
  assert.deepEqual(groups.core.map((entry) => entry.path), [
    "assets/lexicon/core/manifest.json",
    "assets/lexicon/core/shards/0000.jsonl"
  ]);
  assert.deepEqual(groups.technical.map((entry) => entry.path), [
    "assets/lexicon/technical/manifest.json"
  ]);
  assert.deepEqual(groups.otherLexical.map((entry) => entry.path), [
    "assets/lexicon/other/readme.txt"
  ]);
  assert.equal(groups.lexical.length, 4);
});

test("ZIP/deflate proxy includes deterministic per-file envelope overhead", () => {
  const entries = [
    { path: "a.txt", bytes: 10, compressedBytes: 4 },
    { path: "nested/b.txt", bytes: 20, compressedBytes: 8 }
  ];
  const report = zipDeflateProxy(entries);

  const expectedEnvelope =
    22 +
    (30 + Buffer.byteLength("a.txt") + 46 + Buffer.byteLength("a.txt")) +
    (30 + Buffer.byteLength("nested/b.txt") + 46 + Buffer.byteLength("nested/b.txt"));

  assert.equal(report.files, 2);
  assert.equal(report.payloadBytes, 12);
  assert.equal(report.envelopeBytes, expectedEnvelope);
  assert.equal(report.totalBytes, 12 + expectedEnvelope);
});

test("ZIP/deflate proxy rejects malformed entries instead of guessing", () => {
  assert.throws(
    () => zipDeflateProxy([{ path: "", compressedBytes: 1 }]),
    /path is required/
  );
  assert.throws(
    () => zipDeflateProxy([{ path: "a.txt", compressedBytes: -1 }]),
    /non-negative integer/
  );
  assert.throws(
    () => zipDeflateProxy([{ path: "a.txt", compressedBytes: 1.5 }]),
    /non-negative integer/
  );
});
