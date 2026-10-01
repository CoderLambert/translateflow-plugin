import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BASELINE_MAIN_SHA = "acbfa12a079a73d6eab0a1c17e7a8f63d856295b";
const BASELINE_LOOKUP_PATH = "src/background/packs/importers/mdict-rich-lookup.js";
const BASELINE_FIXTURE_PATH = "tests/helpers/rich-mdict-fixture.mjs";
const SAMPLE_COUNT = 30;
const RANGE_GATE_DELAY_MS = 24;
const outputDirectory = process.env.DICTIONARY_ECOSYSTEM_V2_EVIDENCE_DIR
  || resolve("tests/fixtures");
const outputPath = join(outputDirectory, "rich-lookup-cancellation-baseline.json");
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");

await ensureBaselineCommit();
const baselineTree = await mkdtemp(join(tmpdir(), "tf224-baseline-"));
let worktreeAdded = false;
try {
  execFileSync("git", ["worktree", "add", "--detach", "--quiet", baselineTree, BASELINE_MAIN_SHA], {
    cwd: repositoryRoot,
    stdio: "ignore"
  });
  worktreeAdded = true;
  const baselineModule = await import(pathToFileURL(join(baselineTree, BASELINE_LOOKUP_PATH)).href);
  const baselineLookup = baselineModule.lookupRichMdict;
  const baselineIndexModule = await import(pathToFileURL(join(
    baselineTree,
    "src/background/packs/importers/mdict-rich-index.js"
  )).href);
  const baselineFixtureModule = await import(pathToFileURL(join(baselineTree, BASELINE_FIXTURE_PATH)).href);
  const makeRichMdx = baselineFixtureModule.makeRichMdx;
  const fixture = makeRichMdx([["baseline-latency-fixture", "<p>bounded baseline record</p>"]]);
  const index = await baselineIndexModule.buildRichMdictIndex({ source: byteSource(fixture) });
  const keyBlockOffset = index.keyBlocks[0].dataOffset;
  const rawSamplesMs = [];

  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    const rangeStarted = deferred();
    const controller = new AbortController();
    let lastRangeStopAt = 0;
    const source = {
      size: fixture.byteLength,
      async read(offset, length) {
        if (offset === keyBlockOffset) {
          rangeStarted.resolve();
          await delay(RANGE_GATE_DELAY_MS);
        }
        lastRangeStopAt = performance.now();
        return fixture.subarray(offset, offset + length);
      }
    };
    const lookup = baselineLookup({
      source,
      index,
      text: "baseline-latency-fixture",
      signal: controller.signal
    });
    await rangeStarted.promise;
    const cancelRequestedAt = performance.now();
    controller.abort();
    await lookup;
    rawSamplesMs.push(roundMs(Math.max(0, lastRangeStopAt - cancelRequestedAt)));
  }

  const baselineBlob = execFileSync("git", ["rev-parse", `${BASELINE_MAIN_SHA}:${BASELINE_LOOKUP_PATH}`], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim();
  const fixtureBlob = execFileSync("git", ["rev-parse", `${BASELINE_MAIN_SHA}:${BASELINE_FIXTURE_PATH}`], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim();
  const runnerSha256 = createHash("sha256").update(await readFile(scriptPath)).digest("hex");
  const evidence = {
    schemaVersion: 1,
    status: "PASS",
    baselineMainSha: BASELINE_MAIN_SHA,
    baselineLookupPath: BASELINE_LOOKUP_PATH,
    baselineLookupBlob: baselineBlob,
    baselineFixturePath: BASELINE_FIXTURE_PATH,
    baselineFixtureBlob: fixtureBlob,
    runnerPath: "scripts/measure-rich-lookup-cancellation-baseline.mjs",
    runnerSha256,
    workload: {
      kind: "synthetic bounded MDX exact lookup",
      gate: "one key-block range read waits for a 24ms timer; pinned baseline lookup ignores AbortSignal",
      rangeGateDelayMs: RANGE_GATE_DELAY_MS,
      sampleCount: SAMPLE_COUNT
    },
    metric: "milliseconds from cancellation request to the final bounded source range read completing",
    rawSamplesMs,
    summary: {
      p50Ms: percentile(rawSamplesMs, 0.5),
      p95Ms: percentile(rawSamplesMs, 0.95),
      maxMs: Math.max(...rawSamplesMs),
      derivedCeilingMs: Math.ceil(percentile(rawSamplesMs, 0.95) * 2)
    }
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, baselineMainSha: BASELINE_MAIN_SHA, summary: evidence.summary })}\n`);
} finally {
  if (worktreeAdded) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", baselineTree], {
        cwd: repositoryRoot,
        stdio: "ignore"
      });
    } catch {}
  }
}

async function ensureBaselineCommit() {
  try {
    execFileSync("git", ["cat-file", "-e", `${BASELINE_MAIN_SHA}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore"
    });
  } catch {
    execFileSync("git", ["fetch", "--no-tags", "origin", BASELINE_MAIN_SHA], {
      cwd: repositoryRoot,
      stdio: "inherit"
    });
  }
}

function byteSource(bytes) {
  return { size: bytes.byteLength, async read(offset, length) { return bytes.subarray(offset, offset + length); } };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => { resolvePromise = resolveValue; });
  return { promise, resolve: resolvePromise };
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
