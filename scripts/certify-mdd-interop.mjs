#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { open, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(repoRoot, "tests/fixtures/mdd-interop");
const lockPath = resolve(fixtureRoot, "corpus-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const evidenceDirectory = resolve(
  process.env.MDD_INTEROP_EVIDENCE_DIR || "/tmp/translateflow-mdd-184/evidence"
);
const writerCheckout = readArgument("--writer-checkout") || process.env.WRITEMDICT_CHECKOUT;
const outputPath = readArgument("--out") ||
  resolve(evidenceDirectory, "mdd-interop-certification.json");
const regenerate = process.argv.includes("--regenerate");
const largeRangeEvidence = process.argv.includes("--large-range-evidence");

assert.equal(lock.schemaVersion, 1);
assert.equal(lock.purpose, "synthetic-interoperability-fixture-not-dictionary-corpus");
assert.equal(lock.independentWriter.commit, "f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5");
assert.equal(lock.independentWriter.license, "MIT");

const generatorBytes = await readFile(resolve(repoRoot, lock.generation.script));
assert.equal(sha256(generatorBytes), lock.generation.scriptSha256, "generator changed without corpus-lock update");
const fixtureReports = [];
for (const artifact of [lock.generation.mdx, lock.generation.mdd]) {
  const bytes = await readFile(resolve(fixtureRoot, artifact.file));
  assert.equal(bytes.byteLength, artifact.bytes, `${artifact.file} byte length drifted`);
  assert.equal(sha256(bytes), artifact.sha256, `${artifact.file} SHA-256 drifted`);
  fixtureReports.push({ file: artifact.file, bytes: bytes.byteLength, sha256: sha256(bytes) });
}

let independentRegeneration = { performed: false };
if (regenerate || writerCheckout) {
  if (!writerCheckout) throw new Error("--regenerate requires --writer-checkout or WRITEMDICT_CHECKOUT");
  const checkout = resolve(writerCheckout);
  const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(commit, lock.independentWriter.commit, "writer checkout is not the locked commit");
  const writerBytes = await readFile(resolve(checkout, lock.independentWriter.writerFile));
  const licenseBytes = await readFile(resolve(checkout, "LICENSE"));
  assert.equal(sha256(writerBytes), lock.independentWriter.writerFileSha256, "writemdict.py checksum mismatch");
  assert.equal(sha256(licenseBytes), lock.independentWriter.licenseSha256, "writer LICENSE checksum mismatch");

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "mdd-interop-verify-"));
  try {
    execFileSync("python3", [
      resolve(repoRoot, lock.generation.script),
      "--writer-checkout", checkout,
      "--out-dir", temporaryDirectory
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    const regenerated = [];
    for (const artifact of [lock.generation.mdx, lock.generation.mdd]) {
      const bytes = await readFile(resolve(temporaryDirectory, artifact.file));
      assert.equal(bytes.byteLength, artifact.bytes, `regenerated ${artifact.file} size mismatch`);
      assert.equal(sha256(bytes), artifact.sha256, `regenerated ${artifact.file} hash mismatch`);
      regenerated.push({ file: artifact.file, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    independentRegeneration = {
      performed: true,
      repository: lock.independentWriter.repository,
      commit,
      license: lock.independentWriter.license,
      sourceSha256: lock.independentWriter.writerFileSha256,
      licenseSha256: lock.independentWriter.licenseSha256,
      pythonVersion: execFileSync("python3", ["--version"], { encoding: "utf8" }).trim(),
      fixedHeaderDate: lock.generation.headerDate,
      artifacts: regenerated
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const parserEvidence = await certifySmallInterop();
let rangeIoEvidence = {
  status: "not-run",
  instruction: "Use --large-range-evidence to generate and measure a synthetic 100 MiB-class MDD range source."
};
if (largeRangeEvidence) {
  if (!writerCheckout) throw new Error("--large-range-evidence requires the locked external writer checkout");
  rangeIoEvidence = await certifyLargeRangeIo(resolve(writerCheckout));
}

const evidence = {
  status: "PASS",
  purpose: lock.purpose,
  interop: {
    independentWriter: independentRegeneration,
    artifacts: fixtureReports,
    parser: parserEvidence,
    resources: lock.generation.resources.map(({ path, bytes, sha256, mime }) => ({ path, bytes, sha256, mime })),
    hasFullValidPngAndWavBytes: true,
    rawBytesAreHashedBeforeLookup: true
  },
  rangeIo: rangeIoEvidence,
  generatedAt: new Date().toISOString()
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidencePath: outputPath }, null, 2));

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

async function certifySmallInterop() {
  const { buildMddIndex, lookupMddResource } = await import("../src/background/packs/importers/mdd.js");
  const mdd = await readFile(resolve(fixtureRoot, lock.generation.mdd.file));
  const source = trackedBufferSource(mdd);
  const indexReadsStart = source.ranges.length;
  const index = await buildMddIndex({ source });
  const indexRanges = source.ranges.slice(indexReadsStart);
  assert.equal(index.keyCount, lock.generation.resources.length);
  assert.equal(Object.hasOwn(index, "entries"), false, "MDD index must not materialize resources");
  assert.equal(Object.hasOwn(index, "resources"), false, "MDD index must not retain payload objects");
  assert.ok(JSON.stringify(index).length < 16 * 1024, "compact MDD index grew unexpectedly");
  const recordPayloadRanges = indexRanges.filter((range) => index.recordBlocks.some((block) =>
    overlaps(range, block.dataOffset, block.dataOffset + block.compressedBytes)
  ));
  assert.deepEqual(recordPayloadRanges, [], "index construction read resource record bodies");

  const lookups = [];
  for (const expected of lock.generation.resources) {
    let metrics;
    const result = await lookupMddResource({
      source,
      index,
      path: expected.path,
      onMetrics(value) { metrics = value; }
    });
    assert.equal(result.found, true, expected.path);
    assert.equal(result.mime, expected.mime, expected.path);
    assert.equal(result.bytes.byteLength, expected.bytes, expected.path);
    assert.equal(sha256(result.bytes), expected.sha256, expected.path);
    if (expected.path === "interop/sample.png") {
      assert.deepEqual(result.dimensions, { width: 2, height: 2 });
    }
    assert.ok(metrics?.sourceBytesRead > 0, `${expected.path} should report measured range reads`);
    lookups.push({
      path: expected.path,
      bytes: result.bytes.byteLength,
      mime: result.mime,
      kind: result.kind,
      sourceRangeReads: metrics.sourceRangeReads,
      sourceBytesRead: metrics.sourceBytesRead,
      recordBlockDecodes: metrics.recordBlockDecodes
    });
  }
  return {
    status: "PASS",
    sourceBytes: mdd.byteLength,
    compactIndexBytes: Buffer.byteLength(JSON.stringify(index)),
    indexRangeReads: indexRanges.length,
    indexSourceBytesRead: indexRanges.reduce((sum, range) => sum + range.length, 0),
    indexReadResourceRecordBodies: false,
    resourceObjectsMaterializedAtIndexTime: false,
    resources: lookups
  };
}

async function certifyLargeRangeIo(checkout) {
  const evidenceRoot = resolve(evidenceDirectory);
  await mkdir(evidenceRoot, { recursive: true });
  const scratchDirectory = await mkdtemp(resolve(evidenceRoot, ".synthetic-mdd-100mb-"));
  const bulkBytes = Number(readArgument("--bulk-bytes") || 100 * 1024 * 1024);
  if (!Number.isSafeInteger(bulkBytes) || bulkBytes < 96 * 1024 * 1024) {
    throw new Error("--bulk-bytes must describe at least a 96 MiB corpus");
  }
  let handle;
  try {
    const generatorOutput = execFileSync("python3", [
      resolve(repoRoot, lock.generation.script),
      "--writer-checkout", checkout,
      "--out-dir", scratchDirectory,
      "--bulk-bytes", String(bulkBytes)
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    const generated = JSON.parse(generatorOutput.trim());
    const filePath = resolve(generated.file);
    const fileStat = await stat(filePath);
    assert.equal(fileStat.size, generated.bytes);
    assert.equal(generated.uncompressedPayloadBytes, bulkBytes + generated.probeBytes);
    const { buildMddIndex, lookupMddResource } = await import("../src/background/packs/importers/mdd.js");
    handle = await open(filePath, "r");
    const source = trackedFileSource(handle, fileStat.size);
    const processStart = process.memoryUsage();
    const index = await buildMddIndex({ source });
    const indexRanges = [...source.ranges];
    const indexSourceBytesRead = sumRanges(indexRanges);
    assert.ok(index.keyCount >= 96, "expected at least 96 independent filler resources");
    assert.ok(index.recordBlocks.length >= 96, "filler should occupy separate MDD record blocks");
    assert.equal(Object.hasOwn(index, "entries"), false);
    assert.equal(Object.hasOwn(index, "resources"), false);
    assert.ok(JSON.stringify(index).length < 256 * 1024, "compact index must stay far below corpus size");
    assert.ok(indexSourceBytesRead < fileStat.size / 100, "index construction must not read record payloads");
    assert.equal(indexRanges.filter((range) => index.recordBlocks.some((block) =>
      overlaps(range, block.dataOffset, block.dataOffset + block.compressedBytes)
    )).length, 0, "index construction read record bodies");

    const queryReadStart = source.ranges.length;
    let queryMetrics;
    const result = await lookupMddResource({
      source,
      index,
      path: generated.probePath,
      onMetrics(value) { queryMetrics = value; }
    });
    const queryRanges = source.ranges.slice(queryReadStart);
    assert.equal(result.found, true);
    assert.equal(result.mime, "image/png");
    assert.equal(result.kind, "image");
    assert.equal(result.bytes.byteLength, generated.probeBytes);
    assert.equal(sha256(result.bytes), generated.probeSha256);
    assert.equal(queryMetrics?.recordBlockDecodes, 1, "small image lookup should decode one required record block");
    assert.ok(queryMetrics.sourceBytesRead < fileStat.size / 100, "small resource lookup must not scan the whole MDD");
    assert.ok(queryRanges.length <= 4, "small asset lookup used too many source ranges");
    const recordDataRanges = queryRanges.filter((range) => index.recordBlocks.some((block) =>
      overlaps(range, block.dataOffset, block.dataOffset + block.compressedBytes)
    ));
    const distinctRecordBlocks = new Set(recordDataRanges.flatMap((range) => index.recordBlocks
      .filter((block) => overlaps(range, block.dataOffset, block.dataOffset + block.compressedBytes))
      .map((block) => block.dataOffset)));
    assert.equal(distinctRecordBlocks.size, 1, "small asset lookup read unrelated MDD record blocks");
    const processEnd = process.memoryUsage();
    return {
      status: "PASS",
      corpusKind: generated.purpose,
      uncompressedPayloadBytes: generated.uncompressedPayloadBytes,
      physicalMddBytes: fileStat.size,
      sha256: generated.sha256,
      resourceCount: index.keyCount,
      keyBlockCount: index.keyBlocks.length,
      recordBlockCount: index.recordBlocks.length,
      compactIndexBytes: Buffer.byteLength(JSON.stringify(index)),
      indexSourceRangeReads: indexRanges.length,
      indexSourceBytesRead,
      indexReadRecordBodies: false,
      lookup: {
        path: generated.probePath,
        mime: result.mime,
        kind: result.kind,
        responseBytes: result.bytes.byteLength,
        sourceRangeReads: queryMetrics.sourceRangeReads,
        sourceBytesRead: queryMetrics.sourceBytesRead,
        recordBlockDecodes: queryMetrics.recordBlockDecodes,
        distinctRecordBlocksRead: distinctRecordBlocks.size,
        readBytesFraction: Number((queryMetrics.sourceBytesRead / fileStat.size).toFixed(8))
      },
      nodeMemory: {
        rssStartBytes: processStart.rss,
        rssAfterIndexBytes: processEnd.rss,
        rssDeltaBytes: processEnd.rss - processStart.rss,
        heapUsedAfterIndexBytes: processEnd.heapUsed,
        arrayBuffersAfterIndexBytes: processEnd.arrayBuffers,
        processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
        pythonGeneratorMemoryIncluded: false
      },
      temporaryCorpusRemovedAfterMeasurement: true
    };
  } finally {
    await handle?.close();
    await rm(scratchDirectory, { recursive: true, force: true });
  }
}

function trackedBufferSource(bytes) {
  return {
    size: bytes.byteLength,
    ranges: [],
    async read(offset, length) {
      this.ranges.push({ offset, length });
      return new Uint8Array(bytes.subarray(offset, offset + length));
    }
  };
}

function trackedFileSource(handle, size) {
  return {
    size,
    ranges: [],
    async read(offset, length) {
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      this.ranges.push({ offset, length: bytesRead });
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    }
  };
}

function overlaps(range, start, end) {
  return range.offset < end && range.offset + range.length > start;
}

function sumRanges(ranges) {
  return ranges.reduce((sum, range) => sum + range.length, 0);
}
