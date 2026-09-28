#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { assessLexicalLookup } from "../src/background/lexical/ranking.js";

const MAX_RELEASE_LEXICON_BYTES = 40 * 1024 * 1024;
const MAX_COMBINED_CACHE_BYTES = 4 * 1024 * 1024;

export async function certifyLexicalRelease({
  root = resolve("assets/lexicon")
} = {}) {
  const tracker = createReadTracker(root);
  const gateway = createReleaseGateway(tracker.readBytes);
  const heapStart = process.memoryUsage().heapUsed;
  let heapPeak = heapStart;

  const cold = await timedLookup(gateway, "persistent", "The application keeps a persistent connection.");
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  const readsAfterCold = tracker.snapshot();

  const warm = await timedLookup(gateway, "persistent", "The application keeps a persistent connection.");
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  const readsAfterWarm = tracker.snapshot();

  const tmux = await timedLookup(gateway, "tmux", "Open tmux in the terminal and attach to the session.");
  const session = await timedLookup(gateway, "session", "A tmux session remains after the terminal closes.");
  const container = await timedLookup(gateway, "container", "Docker runs the application inside a container.");
  const phrase = await gateway.lookup({ text: "runtime system" });
  const phraseMiss = await gateway.lookup({ text: "persistent session" });
  const inflection = await gateway.lookup({ text: "sessions" });
  const unsupported = await gateway.lookup({ text: "セッション", sourceLanguage: "ja", targetLanguage: "zh-CN" });
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);

  const beforeRestartReads = tracker.snapshot();
  const restartedGateway = createReleaseGateway(tracker.readBytes);
  const restart = await timedLookup(restartedGateway, "persistent", "The application keeps a persistent connection.");
  const afterRestartReads = tracker.snapshot();
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);

  const assets = await inspectDirectory(root);
  const cache = cacheSummary(gateway.stats());
  const failures = [];

  requireCondition(cold.lookup.status === "candidates", "persistent must resolve from the real release packs", failures);
  requireCondition(warm.lookup.status === "candidates", "warm persistent lookup must remain a local candidate hit", failures);
  requireCondition(readsAfterWarm.reads === readsAfterCold.reads, "warm repeated lookup must not reread package files", failures);
  requireCondition(restart.lookup.status === "candidates", "reader restart must reopen the release pack", failures);
  requireCondition(afterRestartReads.reads > beforeRestartReads.reads, "reader restart must reload immutable metadata/data", failures);
  requireCondition(
    tmux.lookup.candidates?.some((candidate) => candidate.provenance?.packId === "technical-wikidata-en-zh"),
    "tmux must come from the production Technical pack",
    failures
  );
  requireCondition(
    session.lookup.candidates?.some((candidate) => candidate.kind === "technical-concept"),
    "session must expose the production Technical candidate alongside general lexical evidence",
    failures
  );
  requireCondition(
    !(container.decision.outcome === "sufficient" &&
      !container.decision.candidates.some((candidate) => candidate.kind === "technical-concept" || candidate.kind === "technical-entity")),
    "technical-context container must not be declared sufficient from generic-only local evidence",
    failures
  );
  requireCondition(phrase.status === "candidates", "phrase-first release lookup must resolve runtime system", failures);
  requireCondition(phraseMiss.status === "no-hit" && Array.isArray(phraseMiss.evidence), "unknown phrase must stay no-hit with evidence, never token concatenation", failures);
  requireCondition(inflection.status === "candidates", "inflection/lemma release lookup must resolve sessions", failures);
  requireCondition(unsupported.status === "unsupported", "unsupported source language must bypass local lexicon", failures);
  requireCondition(cache.bytes <= MAX_COMBINED_CACHE_BYTES, "combined decoded-cache payload exceeds release budget", failures);
  requireCondition(assets.bytes <= MAX_RELEASE_LEXICON_BYTES, "bundled lexical assets exceed release package-impact budget", failures);

  return {
    schemaVersion: 1,
    budgets: {
      releaseLexiconBytes: MAX_RELEASE_LEXICON_BYTES,
      combinedDecodedCacheBytes: MAX_COMBINED_CACHE_BYTES,
      timingThresholdEnforced: false,
      heapThresholdEnforced: false
    },
    assets,
    cache,
    reads: {
      cold: readsAfterCold,
      warm: readsAfterWarm,
      restartDelta: {
        reads: afterRestartReads.reads - beforeRestartReads.reads,
        bytes: afterRestartReads.bytes - beforeRestartReads.bytes
      }
    },
    timingMs: {
      coldPersistent: cold.ms,
      warmPersistent: warm.ms,
      restartPersistent: restart.ms,
      tmux: tmux.ms,
      session: session.ms,
      container: container.ms
    },
    heapObservation: {
      baselineBytes: heapStart,
      peakObservedBytes: heapPeak,
      deltaBytes: Math.max(0, heapPeak - heapStart),
      note: "Node heap is informational only; deterministic release enforcement uses byte-accounted reader cache budgets."
    },
    fixtures: {
      persistent: summarize(cold),
      tmux: summarize(tmux),
      session: summarize(session),
      container: summarize(container),
      phraseStatus: phrase.status,
      phraseMissStatus: phraseMiss.status,
      inflectionStatus: inflection.status,
      unsupportedStatus: unsupported.status
    },
    failures
  };
}

function createReleaseGateway(readBytes) {
  return createLexicalGateway({
    packReaders: [
      createTflexReader({
        packBasePath: "core",
        readBytes,
        cryptoProvider: webcrypto,
        cacheMaxEntries: 4,
        cacheMaxBytes: 2 * 1024 * 1024
      }),
      createTflexReader({
        packBasePath: "technical",
        readBytes,
        cryptoProvider: webcrypto,
        cacheMaxEntries: 4,
        cacheMaxBytes: 2 * 1024 * 1024
      })
    ]
  });
}

function createReadTracker(root) {
  let reads = 0;
  let bytes = 0;
  return {
    async readBytes(relativePath) {
      const data = new Uint8Array(await readFile(join(root, relativePath)));
      reads += 1;
      bytes += data.byteLength;
      return data;
    },
    snapshot() {
      return { reads, bytes };
    }
  };
}

async function timedLookup(gateway, text, contextText) {
  const started = performance.now();
  const lookup = await gateway.lookup({ text });
  const decision = assessLexicalLookup(lookup, { contextText });
  return { lookup, decision, ms: round(performance.now() - started) };
}

function summarize(result) {
  return {
    lookupStatus: result.lookup.status,
    decision: result.decision.outcome,
    reason: result.decision.reason,
    topCandidateId: result.decision.topCandidateId,
    candidateKinds: result.decision.candidates.map((candidate) => candidate.kind),
    packIds: [...new Set(result.decision.candidates.map((candidate) => candidate.provenance?.packId).filter(Boolean))]
  };
}

function cacheSummary(stats) {
  const readers = stats.map((entry) => ({
    index: entry.index,
    metadataLoaded: entry.metadataLoaded === true,
    entries: Number(entry.cache?.entries || 0),
    bytes: Number(entry.cache?.bytes || 0),
    maxEntries: Number(entry.cache?.maxEntries || 0),
    maxBytes: Number(entry.cache?.maxBytes || 0)
  }));
  return {
    readers,
    entries: readers.reduce((sum, item) => sum + item.entries, 0),
    bytes: readers.reduce((sum, item) => sum + item.bytes, 0),
    maxBytes: readers.reduce((sum, item) => sum + item.maxBytes, 0)
  };
}

async function inspectDirectory(root) {
  const files = [];
  async function visit(dir, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isDirectory()) await visit(path, relative);
      else files.push({ path: relative, bytes: (await stat(path)).size });
    }
  }
  await visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return {
    bytes: files.reduce((sum, item) => sum + item.bytes, 0),
    files: files.length,
    largestFileBytes: Math.max(0, ...files.map((item) => item.bytes)),
    byPack: Object.fromEntries(["core", "technical"].map((pack) => [
      pack,
      files.filter((item) => item.path.startsWith(pack + "/")).reduce((sum, item) => sum + item.bytes, 0)
    ]))
  };
}

function requireCondition(condition, message, failures) {
  if (!condition) failures.push(message);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function main() {
  const report = await certifyLexicalRelease();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
