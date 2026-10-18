import test from "node:test";
import assert from "node:assert/strict";
import {
  assessPackageInventory,
  zipDeflateProxy
} from "../scripts/measure-extension-footprint.mjs";

test("production inventory rejects dictionary and private build inputs", () => {
  assert.deepEqual(assessPackageInventory([{ path: "manifest.json" }, { path: "src/options/workers/mdict-import-worker.js" }]), []);
  const failures = assessPackageInventory([
    { path: "assets/lexicon/any-user-pack/manifest.json" },
    { path: "lexicon/source-locks/source.json" },
    { path: "tests/fixture.json" }
  ]);
  assert.equal(failures.length, 3);
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
