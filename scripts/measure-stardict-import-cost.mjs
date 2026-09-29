#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { projectStarDictPlainText } from "../src/background/packs/importers/stardict-core.js";
import { buildStarDictLocalTflexFromProjection } from "../src/background/packs/importers/stardict-local-adapter.js";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ENTRY_COUNTS = Object.freeze([1000, 5000, 10000]);
const encoder = new TextEncoder();

export async function measureStarDictImportCost({
  entryCount,
  cryptoProvider = globalThis.crypto
} = {}) {
  const count = requirePositiveInteger(entryCount, "entryCount");
  if (!cryptoProvider?.subtle) {
    throw new Error("WebCrypto is required for StarDict import cost measurement");
  }

  globalThis.gc?.();
  const fixture = makeFixture(count);
  const baseline = memorySnapshot();
  const totalStarted = performance.now();

  const parserStarted = performance.now();
  const projection = projectStarDictPlainText({
    ifoText: fixture.ifoText,
    idxBytes: fixture.idxBytes,
    dictBytes: fixture.dictBytes,
    sourceId: fixture.sourceId,
    sourceVersion: fixture.sourceVersion
  });
  const parserWallMs = performance.now() - parserStarted;
  const afterProjection = memorySnapshot();

  const converterStarted = performance.now();
  const built = await buildStarDictLocalTflexFromProjection({
    projection,
    recipe: fixture.recipe,
    cryptoProvider
  });
  const converterWallMs = performance.now() - converterStarted;
  const totalWallMs = performance.now() - totalStarted;
  const afterBuild = memorySnapshot();

  const manifestBytes = built.files["manifest.json"].byteLength;
  const indexBytes = built.files["index.dat"].byteLength;
  const entriesBytes = built.files["entries.dat"].byteLength;
  const outputBytes = manifestBytes + indexBytes + entriesBytes;
  const inputBytes = fixture.ifoBytes +
    fixture.idxBytes.byteLength +
    fixture.dictBytes.byteLength;

  return {
    schemaVersion: 1,
    entryCount: count,
    sourceBytes: {
      total: inputBytes,
      ifo: fixture.ifoBytes,
      idx: fixture.idxBytes.byteLength,
      dict: fixture.dictBytes.byteLength,
      syn: 0
    },
    outputBytes: {
      total: outputBytes,
      manifest: manifestBytes,
      index: indexBytes,
      entries: entriesBytes
    },
    expansionRatio: round(outputBytes / inputBytes, 4),
    timingsMs: {
      parserProjection: round(parserWallMs, 3),
      converterTflex: round(converterWallMs, 3),
      total: round(totalWallMs, 3)
    },
    memory: {
      baseline,
      afterProjection,
      afterBuild,
      approximatePeakRssBytes: maxRssBytes(),
      approximatePeakRssDeltaBytes:
        Math.max(0, maxRssBytes() - baseline.maxRssBytes)
    },
    outputRecordCount: built.manifest.recordCount,
    sourceEntryCount: built.manifest.sourceEntryCount,
    sourceAliasCount: built.manifest.sourceAliasCount || 0
  };
}

export function parseEntryCounts(value) {
  const raw = String(value || "").trim();
  if (!raw) return [...DEFAULT_ENTRY_COUNTS];
  const result = raw
    .split(",")
    .map((item) =>
      requirePositiveInteger(item.trim(), "entries")
    );
  if (!result.length) throw new Error("entries must not be empty");
  return [...new Set(result)].sort((a, b) => a - b);
}

async function runParent(args) {
  const entryCounts = parseEntryCounts(args.entries);
  const cases = [];
  for (const entryCount of entryCounts) {
    const child = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        THIS_FILE,
        "--child",
        "--entry-count",
        String(entryCount)
      ],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 4
      }
    );
    if (child.status !== 0) {
      throw new Error(
        "StarDict import cost child failed for " +
          entryCount +
          " entries:\n" +
          String(
            child.stderr ||
              child.stdout ||
              "unknown child failure"
          )
      );
    }
    const line = String(child.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .at(-1);
    cases.push(JSON.parse(line));
  }

  const report = {
    schemaVersion: 1,
    kind: "stardict-shared-browser-core-import-cost",
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    caveats: [
      "Synthetic plain StarDict fixtures exercise the exact shared browser-safe parser, semantic mapping and TFLex builder but are not a substitute for representative real user-owned dictionary certification.",
      "Peak RSS is process-level evidence from an isolated child process and includes the Node runtime baseline; use approximatePeakRssDeltaBytes for case-to-baseline comparison.",
      "Timing values are evidence, not release thresholds; CI hardware variance must not make correctness gates flaky."
    ],
    cases
  };

  const text = JSON.stringify(report, null, 2) + "\n";
  if (args.out) {
    await writeFile(resolve(args.out), text, "utf8");
  }
  process.stdout.write(text);
}

async function runChild(args) {
  const report = await measureStarDictImportCost({
    entryCount: requirePositiveInteger(
      args["entry-count"],
      "entry-count"
    )
  });
  process.stdout.write(JSON.stringify(report) + "\n");
}

function makeFixture(entryCount) {
  const idxChunks = [];
  const dictChunks = [];
  let offset = 0;

  for (let index = 0; index < entryCount; index += 1) {
    const word =
      "word" + String(index).padStart(7, "0");
    const wordBytes = Buffer.from(word, "utf8");
    const payload = Buffer.from(
      "释义 " +
        word +
        "：用于测量离线词典导入转换成本。",
      "utf8"
    );
    const numbers = Buffer.alloc(8);
    numbers.writeUInt32BE(offset, 0);
    numbers.writeUInt32BE(payload.byteLength, 4);
    idxChunks.push(
      wordBytes,
      Buffer.from([0]),
      numbers
    );
    dictChunks.push(payload);
    offset += payload.byteLength;
  }

  const idxBytes = Buffer.concat(idxChunks);
  const dictBytes = Buffer.concat(dictChunks);
  const ifoText = [
    "StarDict's dict ifo file",
    "version=2.4.2",
    "bookname=TranslateFlow Import Cost Fixture",
    "wordcount=" + entryCount,
    "idxfilesize=" + idxBytes.byteLength,
    "sametypesequence=m",
    ""
  ].join("\n");
  const sourceId = "benchmark-stardict";
  const sourceVersion = "synthetic-v1";

  return {
    ifoText,
    ifoBytes: encoder.encode(ifoText).byteLength,
    idxBytes,
    dictBytes,
    sourceId,
    sourceVersion,
    recipe: {
      schemaVersion: 1,
      semanticProfile:
        "en-zh-plain-text-translation-v1",
      packId:
        "local-stardict-import-cost-" +
        entryCount,
      packVersion: "synthetic-v1",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      dictionary: {
        bookname:
          "TranslateFlow Import Cost Fixture",
        sourceId,
        sourceVersion
      },
      assertions: {
        plainTextRepresentsTargetTranslation: true,
        localUseOnly: true
      }
    }
  };
}

function memorySnapshot() {
  const value = process.memoryUsage();
  return {
    rssBytes: value.rss,
    heapUsedBytes: value.heapUsed,
    heapTotalBytes: value.heapTotal,
    externalBytes: value.external,
    arrayBuffersBytes: value.arrayBuffers,
    maxRssBytes: maxRssBytes()
  };
}

function maxRssBytes() {
  return (
    Number(process.resourceUsage().maxRSS || 0) *
    1024
  );
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Error(
      label + " must be a positive safe integer"
    );
  }
  return number;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const result = Object.create(null);
  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const arg = argv[index];
    if (arg === "--child") {
      result.child = true;
      continue;
    }
    if (
      arg === "--entries" ||
      arg === "--entry-count" ||
      arg === "--out"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(
          "missing value for " + arg
        );
      }
      result[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error("unknown argument: " + arg);
  }
  return result;
}

async function main() {
  const args = parseArgs(
    process.argv.slice(2)
  );
  if (args.child) await runChild(args);
  else await runParent(args);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(THIS_FILE)
) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
