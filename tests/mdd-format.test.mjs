import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildMddIndex,
  createMddLookupBudget,
  lookupMddResource,
  MDD_IMPORT_LIMITS,
  verifyMddRecordBlocks,
  validateMddIndex
} from "../src/background/packs/importers/mdd.js";
import { MDICT_IMPORT_ERROR, MDictImportError } from "../src/background/packs/importers/mdict-contract.js";
import { parseMddKeyBlock } from "../src/background/packs/importers/mdd-key-codec.js";
import { makeMdd, readMddInteropFixture } from "./helpers/mdd-fixture.mjs";

test("pinned independent MDD builds a compact index and retrieves exact resource bytes", async () => {
  const { mdd } = await readMddInteropFixture();
  const lock = JSON.parse(await readFile(resolve("tests/fixtures/mdd-interop/corpus-lock.json"), "utf8"));
  const source = trackedSource(mdd);
  const index = await buildMddIndex({ source });

  assert.equal(index.format, "mdd-v2");
  assert.equal(index.keyCount, 3);
  assert.equal(index.totalRecordBytes, lock.generation.resources.reduce((sum, item) => sum + item.bytes, 0));
  assert.ok(index.keyBlocks.length > 0);
  assert.ok(index.recordBlocks.length > 0);
  assert.equal(Object.hasOwn(index, "resources"), false);
  assert.equal(Object.hasOwn(index, "entries"), false);
  assert.equal(validateMddIndex(JSON.parse(JSON.stringify(index)), { sourceSize: mdd.byteLength }).keyCount, 3);
  assert.ok(source.requests.every(({ offset, length }) => offset >= 0 && length > 0 && offset + length <= mdd.byteLength));
  assert.ok(source.requests.every(({ offset, length }) => offset !== 0 || length !== mdd.byteLength));

  const budget = createMddLookupBudget();
  const actual = [];
  for (const item of lock.generation.resources) {
    const result = await lookupMddResource({
      source,
      index,
      path: `/${item.path}`,
      budget
    });
    assert.equal(result.found, true);
    assert.equal(result.path, item.path);
    assert.equal(result.mime, item.mime);
    assert.equal(result.bytes.byteLength, item.bytes);
    assert.equal(sha256(result.bytes), item.sha256);
    if (item.dimensions) assert.deepEqual(result.dimensions, { width: item.dimensions[0], height: item.dimensions[1] });
    actual.push(result);
  }
  assert.deepEqual(actual.map(({ kind }) => kind), ["stylesheet", "image", "audio"]);
  assert.ok(budget.metrics.totalDecompressedBytes <= 32 * 1024 * 1024);
  assert.ok(budget.metrics.sourceBytesRead < mdd.byteLength * 3);
  assert.ok(budget.metrics.sourceRangeReads > 0);

  const caseMismatch = await lookupMddResource({ source, index, path: "/Interop/sample.png" });
  assert.deepEqual(caseMismatch, { found: false, path: "Interop/sample.png" });
});

test("legacy raw and new folded MDD orders preserve exact same-fold resources across blocks", async () => {
  const resources = [
    ["A.css", Buffer.from("A{color:red}")],
    ["B.css", Buffer.from("B{color:blue}")],
    ["a.css", Buffer.from("a{color:green}")]
  ];
  const legacySource = trackedSource(makeMdd(resources, {
    keyOrder: "case-sensitive",
    keyBlockEntryCounts: [2, 1]
  }));
  const legacySchema2 = await buildMddIndex({ source: legacySource });
  assert.equal(legacySchema2.keyOrder, "case-sensitive");

  const legacyIndex = structuredClone(legacySchema2);
  legacyIndex.schemaVersion = 1;
  delete legacyIndex.keyOrder;
  delete legacyIndex.header.keyCaseSensitive;
  assert.equal(validateMddIndex(legacyIndex, { sourceSize: legacySource.size }), legacyIndex);
  for (const [path, bytes] of resources) {
    const result = await lookupMddResource({ source: legacySource, index: legacyIndex, path });
    assert.equal(result.found, true);
    assert.deepEqual(Buffer.from(result.bytes), bytes);
  }
  assert.deepEqual(Buffer.from((await lookupMddResource({
    source: legacySource,
    index: legacyIndex,
    path: "B.css"
  })).bytes), Buffer.from("B{color:blue}"));
  assert.deepEqual(Buffer.from((await lookupMddResource({
    source: legacySource,
    index: legacyIndex,
    path: "a.css"
  })).bytes), Buffer.from("a{color:green}"));

  const foldedSource = trackedSource(makeMdd(resources, {
    keyOrder: "case-folded",
    keyBlockEntryCounts: [2, 1]
  }));
  const foldedIndex = await buildMddIndex({ source: foldedSource });
  assert.equal(foldedIndex.schemaVersion, 2);
  assert.equal(foldedIndex.keyOrder, "case-folded");
  for (const path of ["A.css", "a.css", "B.css"]) {
    const result = await lookupMddResource({ source: foldedSource, index: foldedIndex, path });
    assert.equal(result.found, true);
    assert.deepEqual(Buffer.from(result.bytes), resources.find(([key]) => key === path)[1]);
  }
  assert.deepEqual(Buffer.from((await lookupMddResource({
    source: foldedSource,
    index: foldedIndex,
    path: "a.css"
  })).bytes), Buffer.from("a{color:green}"));
  assert.deepEqual(Buffer.from((await lookupMddResource({
    source: foldedSource,
    index: foldedIndex,
    path: "B.css"
  })).bytes), Buffer.from("B{color:blue}"));
});

test("MDD endpoint pairs must be fully raw or fully lower(actual), and offsets stay monotonic", () => {
  const raw = mddKeyBlock([
    [0, "A.css"],
    [3, "B.css"]
  ]);
  const descriptor = {
    entryCount: 2,
    expectedFirstKey: "A.css",
    expectedLastKey: "B.css"
  };
  const rawPair = parseMddKeyBlock(raw, descriptor, 5);
  assert.equal(rawPair.entries[0].path, "A.css");
  assert.equal(rawPair.entries[1].path, "B.css");

  const lowerPair = parseMddKeyBlock(raw, {
    ...descriptor,
    expectedFirstKey: "a.css",
    expectedLastKey: "b.css"
  }, 5, { allowNormalizedDescriptorPair: true });
  assert.equal(lowerPair.entries[1].path, "B.css");

  assert.throws(
    () => parseMddKeyBlock(raw, {
      ...descriptor,
      expectedLastKey: "b.css"
    }, 5, { allowNormalizedDescriptorPair: true }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
  assert.throws(
    () => parseMddKeyBlock(raw, {
      ...descriptor,
      expectedFirstKey: "wrong.css"
    }, 5, { allowNormalizedDescriptorPair: true }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
  assert.throws(
    () => parseMddKeyBlock(mddKeyBlock([[3, "A.css"], [0, "B.css"]]), descriptor, 5),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("MDD reader supports none and zlib blocks without changing binary boundaries", async () => {
  const png = (await readMddInteropFixture()).mdd;
  const sourceIndex = await buildMddIndex({ source: trackedSource(png) });
  const original = await lookupMddResource({
    source: trackedSource(png),
    index: sourceIndex,
    path: "interop/sample.png"
  });

  for (const compression of ["none", "zlib"]) {
    const bytes = makeMdd([["\\interop\\sample.png", original.bytes]], {
      keyInfoCompression: compression,
      keyCompression: compression,
      recordCompression: compression
    });
    const source = trackedSource(bytes);
    const index = await buildMddIndex({ source });
    const result = await lookupMddResource({ source, index, path: "/interop/sample.png" });
    assert.equal(result.mime, "image/png");
    assert.deepEqual(result.bytes, original.bytes);
  }
});

test("one binary resource can cross record-block boundaries without losing bytes", async () => {
  const { mdd } = await readMddInteropFixture();
  const baselineIndex = await buildMddIndex({ source: trackedSource(mdd) });
  const expected = await lookupMddResource({
    source: trackedSource(mdd),
    index: baselineIndex,
    path: "interop/sample.png"
  });
  const bytes = makeMdd([["\\interop\\sample.png", expected.bytes]], {
    recordCompression: "none",
    recordBlockBytes: [13, 47]
  });
  const source = trackedSource(bytes);
  const index = await buildMddIndex({ source });
  assert.equal(index.recordBlocks.length, 3);
  const result = await lookupMddResource({ source, index, path: "interop/sample.png" });
  assert.deepEqual(result.bytes, expected.bytes);
  assert.equal(result.mime, "image/png");
});

test("staged MDD verification decodes every record block and rejects a damaged payload", async () => {
  const { mdd } = await readMddInteropFixture();
  const source = trackedSource(mdd);
  const index = await buildMddIndex({ source });
  const start = source.requests.length;
  const result = await verifyMddRecordBlocks({ source, index });
  const verificationReads = source.requests.slice(start);
  assert.equal(result.recordBlocksVerified, index.recordBlocks.length);
  assert.equal(result.sourceBytesRead, index.recordBlocks.reduce((sum, item) => sum + item.compressedBytes, 0));
  assert.deepEqual(
    verificationReads.map(({ offset, length }) => ({ offset, length })),
    index.recordBlocks.map(({ dataOffset, compressedBytes }) => ({ offset: dataOffset, length: compressedBytes }))
  );
  assert.ok(verificationReads.every(({ offset, length }) => offset > 0 && length < mdd.byteLength));

  const damaged = Buffer.from(mdd);
  damaged[firstRecordBlockOffset(damaged) + 8] ^= 0xff;
  const damagedSource = trackedSource(damaged);
  const damagedIndex = await buildMddIndex({ source: damagedSource });
  await assert.rejects(
    verifyMddRecordBlocks({ source: damagedSource, index: damagedIndex }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.CORRUPT
  );
});

test("one shared query budget caps decompression across companion MDD files", async () => {
  const { mdd } = await readMddInteropFixture();
  const sourceA = trackedSource(mdd);
  const indexA = await buildMddIndex({ source: sourceA });
  let singleLookupBytes = 0;
  await lookupMddResource({
    source: sourceA,
    index: indexA,
    path: "interop/sample.png",
    onMetrics(metrics) { singleLookupBytes = metrics.totalDecompressedBytes; }
  });
  const sourceB = trackedSource(mdd);
  const indexB = await buildMddIndex({ source: sourceB });
  const budget = createMddLookupBudget({
    limits: { totalDecompressedBytes: singleLookupBytes * 2 - 1 }
  });
  await lookupMddResource({ source: sourceA, index: indexA, path: "interop/sample.png", budget });
  await assert.rejects(
    lookupMddResource({ source: sourceB, index: indexB, path: "interop/sample.png", budget }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
  );
  assert.ok(budget.metrics.totalDecompressedBytes <= singleLookupBytes * 2 - 1);
});

test("MDD resource cap and block compression ratio reject expansion before payload delivery", async () => {
  const { mdd } = await readMddInteropFixture();
  const capSource = trackedSource(mdd);
  const capIndex = await buildMddIndex({ source: capSource });
  const tightLimits = { ...MDD_IMPORT_LIMITS, resourceBytes: 32 };
  await assert.rejects(
    lookupMddResource({ source: capSource, index: capIndex, path: "interop/sample.png", limits: tightLimits }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
  );

  const compressedBomb = makeMdd([["\\bomb.png", new Uint8Array(128 * 1024)]], {
    recordCompression: "zlib"
  });
  await assert.rejects(
    buildMddIndex({ source: trackedSource(compressedBomb) }),
    (error) => error instanceof MDictImportError && error.code === MDICT_IMPORT_ERROR.LIMIT
  );
});

function trackedSource(input) {
  const bytes = Buffer.from(input);
  const requests = [];
  return {
    size: bytes.byteLength,
    requests,
    async read(offset, length) {
      requests.push({ offset, length });
      return new Uint8Array(bytes.subarray(offset, offset + length));
    }
  };
}

function firstRecordBlockOffset(bytes) {
  const headerLength = bytes.readUInt32BE(0);
  const keyPreambleOffset = headerLength + 8;
  const keyInfoCompressedBytes = Number(bytes.readBigUInt64BE(keyPreambleOffset + 24));
  const keyBlocksBytes = Number(bytes.readBigUInt64BE(keyPreambleOffset + 32));
  const keyInfoOffset = keyPreambleOffset + 44;
  const keyBlocksOffset = keyInfoOffset + keyInfoCompressedBytes;
  const recordSectionOffset = keyBlocksOffset + keyBlocksBytes;
  const recordBlockCount = Number(bytes.readBigUInt64BE(recordSectionOffset));
  return recordSectionOffset + 32 + recordBlockCount * 16;
}

function mddKeyBlock(entries) {
  return Buffer.concat(entries.map(([offset, path]) => {
    const recordOffset = Buffer.alloc(8);
    recordOffset.writeBigUInt64BE(BigInt(offset));
    return Buffer.concat([recordOffset, Buffer.from(path, "utf16le"), Buffer.from([0, 0])]);
  }));
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}
