import {
  createHash
} from "node:crypto";
import {
  createWriteStream,
  createReadStream,
  existsSync,
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync
} from "node:fs";
import {
  tmpdir
} from "node:os";
import {
  join,
  resolve
} from "node:path";
import {
  spawnSync
} from "node:child_process";
import {
  pipeline
} from "node:stream/promises";
import {
  Readable,
  Transform
} from "node:stream";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich-index.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";

const LOCK_PATH = resolve(
  "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"
);
const LOCK = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
const MAX_ARCHIVE_BYTES = LOCK.source.assetApiSizeBytes;
const cacheDir = resolve(
  process.env.RICH_MDICT_CACHE_DIR ||
    join(tmpdir(), "translateflow-rich-mdict")
);
const archivePath = join(cacheDir, LOCK.source.assetName);
const mdxPath = join(cacheDir, LOCK.archive.entryName);

mkdirSync(cacheDir, { recursive: true });

if (!existsSync(archivePath)) {
  await downloadAsset(archivePath);
}

const archiveEvidence = await hashFile(archivePath);
assertEqual(
  archiveEvidence.bytes,
  LOCK.archive.bytes,
  "Downloaded release asset byte count"
);
assertEqual(
  archiveEvidence.sha256,
  LOCK.archive.sha256,
  "Downloaded release asset SHA-256"
);

extractPinnedMdx(archivePath, mdxPath);
const mdxEvidence = await hashFile(mdxPath);
assertEqual(
  mdxEvidence.bytes,
  LOCK.mdx.bytes,
  "Extracted MDX byte count"
);
assertEqual(
  mdxEvidence.sha256,
  LOCK.mdx.sha256,
  "Extracted MDX SHA-256"
);

const headerEvidence = readMdxHeader(mdxPath);
for (const [name, expected] of Object.entries({
  title: LOCK.mdx.title,
  generatedByEngineVersion: LOCK.mdx.generatedByEngineVersion,
  requiredEngineVersion: LOCK.mdx.requiredEngineVersion,
  format: LOCK.mdx.format,
  encoding: LOCK.mdx.encoding,
  encrypted: String(LOCK.mdx.encrypted),
  compact: LOCK.mdx.compact ? "Yes" : "No",
  compat: LOCK.mdx.compat ? "Yes" : "No"
})) {
  assertEqual(headerEvidence[name], expected, `MDX header ${name}`);
}
if (!headerEvidence.styleSheet) {
  throw new Error("Pinned ECDICT MDX no longer has its reviewed StyleSheet.");
}

const parserEvidence = await inspectRealCorpusWithRanges(mdxPath);
const report = {
  status: "PASS",
  source: LOCK.source.releaseUrl,
  archive: archiveEvidence,
  mdx: mdxEvidence,
  header: headerEvidence,
  parserEvidence,
  lockPath: LOCK_PATH
};

const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR;
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  const reportPath = join(evidenceDir, "ecdict-corpus-parser-report.json");
  const reportTemporaryPath = reportPath + ".part";
  rmSync(reportTemporaryPath, { force: true });
  writeFileSync(reportTemporaryPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  renameSync(reportTemporaryPath, reportPath);
}

console.log(JSON.stringify({ ...report, archivePath, mdxPath }, null, 2));

async function inspectRealCorpusWithRanges(path) {
  const descriptor = openSync(path, "r");
  const sourceSize = mdxEvidence.bytes;
  const source = createMeasuredRangeSource(descriptor, sourceSize);
  const baselineRssBytes = process.memoryUsage().rss;
  let peakRssBytes = baselineRssBytes;
  const memorySampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 10);
  memorySampler.unref?.();
  const started = performance.now();
  let index;
  let indexBuildMs;
  let indexIo;
  const lookups = [];
  try {
    index = await buildRichMdictIndex({ source });
    indexBuildMs = Math.round(performance.now() - started);
    indexIo = summarizeRangeMetrics(source.takeMetrics());
    if (index.entryCount !== LOCK.mdx.entryCount) {
      throw new Error(`Parser entry count mismatch: ${index.entryCount} != ${LOCK.mdx.entryCount}.`);
    }
    if (index.keyBlocks.length !== LOCK.mdx.keyBlockCount) {
      throw new Error(`Parser key-block count mismatch: ${index.keyBlocks.length} != ${LOCK.mdx.keyBlockCount}.`);
    }
    if (index.recordBlocks.length !== LOCK.mdx.recordBlockCount) {
      throw new Error(`Parser record-block count mismatch: ${index.recordBlocks.length} != ${LOCK.mdx.recordBlockCount}.`);
    }
    if (index.header.encrypted !== 2 || index.header.compact !== "Yes" || index.header.compat !== "Yes") {
      throw new Error("Parsed ECDICT v2 encryption or compatibility metadata changed.");
    }

    for (const expected of LOCK.independentDecode.recordExcerpts) {
      let apiMetrics = null;
      const lookupStarted = performance.now();
      const result = await lookupRichMdict({
        source,
        index,
        text: expected.query,
        onMetrics(metrics) { apiMetrics = metrics; }
      });
      const lookupMs = Math.round(performance.now() - lookupStarted);
      const lookupIo = source.takeMetrics();
      if (!result.found || result.displayForm !== expected.headword) {
        throw new Error(`Pinned corpus lookup failed for ${expected.query}.`);
      }
      if (!result.rawRecord.includes(expected.rawRecordIncludes)) {
        throw new Error(`Independent record expectation changed for ${expected.query}.`);
      }
      if (/`\d+`/u.test(result.safeTextFallback)) {
        throw new Error(`Compact presentation markers leaked into safe text for ${expected.query}.`);
      }
      lookups.push({
        query: expected.query,
        headword: result.displayForm,
        lookupMs,
        safeTextExcerpt: result.safeTextFallback.slice(0, 180),
        rangeIo: summarizeLookupRanges(lookupIo, index),
        lookupMetrics: apiMetrics
      });
    }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  } finally {
    clearInterval(memorySampler);
    closeSync(descriptor);
  }

  if (indexIo.largestRangeBytes >= sourceSize) {
    throw new Error("Index construction requested the entire MDX in one unbounded operation.");
  }
  for (const lookup of lookups) {
    if (lookup.rangeIo.largestRangeBytes >= sourceSize) {
      throw new Error(`Lookup for ${lookup.query} requested the full MDX source.`);
    }
  }
  return {
    sourceBytes: sourceSize,
    entryCount: index.entryCount,
    keyBlockCount: index.keyBlocks.length,
    recordBlockCount: index.recordBlocks.length,
    compactIndexJsonBytes: Buffer.byteLength(JSON.stringify(index)),
    maximumDecompressedKeyBlockBytes: Math.max(...index.keyBlocks.map((block) => block.decompressedBytes)),
    maximumDecompressedRecordBlockBytes: Math.max(...index.recordBlocks.map((block) => block.decompressedBytes)),
    indexBuildMs,
    indexRangeIo: indexIo,
    lookups,
    processRssBaselineBytes: baselineRssBytes,
    processRssPeakBytes: peakRssBytes,
    processRssPeakDeltaBytes: Math.max(0, peakRssBytes - baselineRssBytes)
  };
}

function createMeasuredRangeSource(descriptor, size) {
  const metrics = { readCalls: 0, totalRangeBytes: 0, largestRangeBytes: 0, ranges: [] };
  return {
    size,
    async read(offset, length) {
      if (
        !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset + length > size
      ) {
        throw new Error(`Parser requested an invalid corpus range: ${offset}+${length}.`);
      }
      const bytes = Buffer.alloc(length);
      let copied = 0;
      while (copied < length) {
        const count = readSync(descriptor, bytes, copied, length - copied, offset + copied);
        if (!count) throw new Error("Parser range read ended before its requested length.");
        copied += count;
      }
      metrics.readCalls += 1;
      metrics.totalRangeBytes += length;
      metrics.largestRangeBytes = Math.max(metrics.largestRangeBytes, length);
      metrics.ranges.push({ offset, length });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    takeMetrics() {
      const snapshot = { ...metrics };
      metrics.readCalls = 0;
      metrics.totalRangeBytes = 0;
      metrics.largestRangeBytes = 0;
      metrics.ranges = [];
      return snapshot;
    }
  };
}

function summarizeLookupRanges(metrics, index) {
  const keyRanges = metrics.ranges.filter((range) => index.keyBlocks.some((block) =>
    block.dataOffset === range.offset
  ));
  const recordRanges = metrics.ranges.filter((range) => index.recordBlocks.some((block) =>
    block.dataOffset === range.offset
  ));
  const recordBlocks = recordRanges.map((range) => index.recordBlocks.find((block) =>
    block.dataOffset === range.offset
  ));
  return {
    readCalls: metrics.readCalls,
    totalRangeBytes: metrics.totalRangeBytes,
    largestRangeBytes: metrics.largestRangeBytes,
    keyBlocksRead: keyRanges.length,
    keyCompressedBytes: keyRanges.reduce((sum, range) => sum + range.length, 0),
    recordBlocksRead: recordRanges.length,
    recordCompressedBytes: recordRanges.reduce((sum, range) => sum + range.length, 0),
    recordDecompressedBytes: recordBlocks.reduce((sum, block) => sum + block.decompressedBytes, 0),
    largestRecordBlockDecompressedBytes: Math.max(0, ...recordBlocks.map((block) => block.decompressedBytes))
  };
}

function summarizeRangeMetrics(metrics) {
  return {
    readCalls: metrics.readCalls,
    totalRangeBytes: metrics.totalRangeBytes,
    largestRangeBytes: metrics.largestRangeBytes
  };
}

async function downloadAsset(path) {
  const partialPath = path + ".part";
  rmSync(partialPath, { force: true });
  const response = await fetch(LOCK.source.assetUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "TranslateFlow-rich-mdict-corpus-gate"
    }
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `ECDICT release download failed with HTTP ${response.status}.`
    );
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isSafeInteger(contentLength) &&
    contentLength !== LOCK.source.assetApiSizeBytes
  ) {
    throw new Error(
      `ECDICT release asset Content-Length mismatch (${contentLength}).`
    );
  }
  let received = 0;
  const sizeGuard = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) {
        callback(new Error("ECDICT release asset exceeds its pinned size."));
        return;
      }
      callback(null, chunk);
    }
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      sizeGuard,
      createWriteStream(partialPath, { flags: "wx" })
    );
    assertEqual(
      received,
      LOCK.source.assetApiSizeBytes,
      "Downloaded release asset byte count"
    );
    renameSync(partialPath, path);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
}

function extractPinnedMdx(zipPath, outPath) {
  const partialPath = outPath + ".part";
  rmSync(partialPath, { force: true });
  const python = String.raw`
import hashlib
import sys
import zipfile

archive_path, output_path, expected_hex, expected_name, expected_size = sys.argv[1:]
expected_size = int(expected_size)
with zipfile.ZipFile(archive_path, "r") as archive:
    entries = archive.infolist()
    if len(entries) != 1:
        raise SystemExit("Pinned ECDICT ZIP must contain exactly one member.")
    entry = entries[0]
    raw_name = entry.filename.encode("cp437")
    if raw_name.hex() != expected_hex:
        raise SystemExit("ECDICT ZIP member filename bytes changed.")
    try:
        decoded_name = raw_name.decode("gbk")
    except UnicodeDecodeError as error:
        raise SystemExit("ECDICT ZIP member name is not valid GBK.") from error
    if decoded_name != expected_name:
        raise SystemExit("ECDICT ZIP member name changed.")
    if "/" in decoded_name or "\\" in decoded_name or decoded_name.startswith("."):
        raise SystemExit("ECDICT ZIP member must remain a root-level file.")
    if entry.is_dir() or entry.file_size != expected_size:
        raise SystemExit("ECDICT ZIP member size or kind changed.")
    if entry.file_size > 128 * 1024 * 1024:
        raise SystemExit("ECDICT ZIP member exceeds the reviewed extraction bound.")
    if entry.compress_size > 128 * 1024 * 1024:
        raise SystemExit("ECDICT compressed member exceeds the reviewed bound.")
    digest = hashlib.sha256()
    copied = 0
    with archive.open(entry, "r") as source, open(output_path, "xb") as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            copied += len(chunk)
            if copied > expected_size:
                raise SystemExit("ECDICT member expanded beyond the pinned size.")
            digest.update(chunk)
            target.write(chunk)
    if copied != expected_size:
        raise SystemExit("ECDICT member ended before its pinned size.")
`;
  const result = spawnSync("python3", [
    "-c",
    python,
    zipPath,
    partialPath,
    LOCK.archive.entryNameBytesHex,
    LOCK.archive.entryName,
    String(LOCK.archive.entryBytes)
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    rmSync(partialPath, { force: true });
    throw new Error(
      `Bounded ECDICT extraction failed: ${result.stderr || result.stdout}`
    );
  }
  renameSync(partialPath, outPath);
}

function readMdxHeader(path) {
  const descriptor = openSync(path, "r");
  let headerBytes;
  let headerBuffer;
  try {
    const prefix = Buffer.alloc(4);
    if (readSync(descriptor, prefix, 0, prefix.byteLength, 0) !== 4) {
      throw new Error("MDX file is truncated.");
    }
    headerBytes = prefix.readUInt32BE(0);
    if (headerBytes > 64 * 1024 || headerBytes % 2 !== 0) {
      throw new Error("MDX header byte count is invalid.");
    }
    headerBuffer = Buffer.alloc(headerBytes);
    if (
      readSync(descriptor, headerBuffer, 0, headerBuffer.byteLength, 4) !==
      headerBuffer.byteLength
    ) {
      throw new Error("MDX header is truncated.");
    }
  } finally {
    closeSync(descriptor);
  }
  if (headerBytes > 64 * 1024 || headerBytes % 2 !== 0) {
    throw new Error("MDX header byte count is invalid.");
  }
  const header = headerBuffer
    .toString("utf16le")
    .replace(/\u0000+$/gu, "");
  const values = Object.fromEntries(
    [...header.matchAll(/([A-Za-z][A-Za-z0-9]*)="([\s\S]*?)"/gu)]
      .map((match) => [match[1], match[2]])
  );
  return {
    title: unescapeHeader(values.Title || ""),
    generatedByEngineVersion: values.GeneratedByEngineVersion || "",
    requiredEngineVersion: values.RequiredEngineVersion || "",
    format: values.Format || "",
    encoding: values.Encoding || "",
    encrypted: values.Encrypted || "0",
    compact: values.Compact || "No",
    compat: values.Compat || "No",
    styleSheet: values.StyleSheet || ""
  };
}

function unescapeHeader(value) {
  return String(value)
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return {
    bytes,
    sha256: hash.digest("hex")
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}.`);
  }
}
