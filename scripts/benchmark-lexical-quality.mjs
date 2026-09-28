#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { assessLexicalLookup } from "../src/background/lexical/ranking.js";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";
import { LEXICAL_RESULT_STATUS, normalizeLexicalKey } from "../src/shared/lexical.js";
import {
  normalizeEnglishDisplay,
  normalizeLookupKey,
  parseOmwRows
} from "./build-tflex-core.mjs";

const DEFAULT_FIXTURE = fileURLToPath(
  new URL("../tests/fixtures/lexical-quality-v1.json", import.meta.url)
);
const DEFAULT_RELEASE_ROOT = resolve("assets/lexicon");
const DEFAULT_SOURCE_ROOT = resolve(".release-sources/omw-data");

export async function benchmarkLexicalQuality({
  fixturePath = DEFAULT_FIXTURE,
  releaseRoot = DEFAULT_RELEASE_ROOT,
  sourceRoot = DEFAULT_SOURCE_ROOT
} = {}) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  validateLexicalQualityFixture(fixture);

  const sourceCoverage = await auditLockedSourceCoverage({
    sourceRoot,
    expected: fixture.expectedSourceBaseline
  });

  const tracker = createReadTracker(releaseRoot);
  const runtime = createReleaseRuntime(tracker.readBytes);
  const deps = resolverDeps(runtime.gateway);
  const heapStart = process.memoryUsage().heapUsed;
  let heapPeak = heapStart;
  const cases = [];

  for (const testCase of fixture.cases) {
    const started = performance.now();
    const result = await resolveSelectionRequest({
      text: testCase.query,
      pageUrl: "https://benchmark.translateflow.invalid/",
      context: {
        text: testCase.context || "",
        source: "visible-local",
        sensitive: false,
        truncated: false
      },
      depth: "auto",
      explainRequested: false
    }, deps);
    const elapsedMs = performance.now() - started;
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    cases.push(evaluateCase(testCase, result, elapsedMs));
  }

  const packs = await Promise.all(runtime.readers.map((reader) => reader.inspect()));
  const performanceReport = await measurePerformance(releaseRoot);
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);

  const metrics = summarizeMetrics(cases);
  const cache = summarizeCache(runtime.gateway.stats());
  const structuralFailures = [
    ...sourceCoverage.mismatches,
    ...validateReleasePackSummary(packs),
    ...validateIssue115QualityGates(cases)
  ];

  return {
    schemaVersion: 1,
    benchmarkVersion: fixture.benchmarkVersion,
    sourceRevision: fixture.sourceRevision,
    sourceCoverage,
    releasePacks: packs,
    corpus: {
      totalCases: cases.length,
      groups: countBy(cases, (item) => item.group),
      modes: countBy(cases, (item) => item.mode)
    },
    metrics,
    performance: performanceReport,
    io: tracker.snapshot(),
    cache,
    heapObservation: {
      baselineBytes: heapStart,
      peakObservedBytes: heapPeak,
      deltaBytes: Math.max(0, heapPeak - heapStart),
      note: "Heap is observational only; deterministic memory enforcement remains the byte-bounded TFLex reader cache."
    },
    structuralFailures,
    cases
  };
}

export function validateLexicalQualityFixture(fixture) {
  if (!fixture || fixture.schemaVersion !== 1 || fixture.benchmarkVersion !== 1) {
    throw new Error("unsupported lexical quality fixture version");
  }
  if (!fixture.sourceRevision || !fixture.expectedSourceBaseline) {
    throw new Error("lexical quality source baseline is required");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length < 40) {
    throw new Error("lexical quality corpus must contain at least 40 cases");
  }

  const allowedModes = new Set(["exact", "normalized", "inflection", "phrase-context", "no-hit"]);
  const requiredGroups = new Set([
    "general", "polysemy", "technical", "entity", "contrastive",
    "normalization", "inflection", "phrase-context", "negative-control", "no-hit"
  ]);
  const allowedErrorClasses = new Set([
    "bad-source-mapping", "core-bilingual-gap", "technical-sense-absent",
    "valid-wrong-context", "sense-prior-error", "pos-mismatch",
    "phrase-data-absent", "phrase-should-beat-word", "technical-ranking-lost",
    "locale-quality"
  ]);
  const seenGroups = new Set();
  const ids = new Set();
  for (const testCase of fixture.cases) {
    if (!testCase?.id || ids.has(testCase.id)) {
      throw new Error("duplicate or missing lexical quality case id");
    }
    ids.add(testCase.id);
    if (!testCase.group || !requiredGroups.has(testCase.group)) {
      throw new Error("unknown lexical quality group: " + String(testCase.group));
    }
    seenGroups.add(testCase.group);
    if (!testCase.query || typeof testCase.query !== "string") {
      throw new Error("query is required for case " + testCase.id);
    }
    if (!testCase.expected || !allowedModes.has(testCase.expected.mode)) {
      throw new Error("expected mode is missing for case " + testCase.id);
    }
    if (testCase.expected.mode === "phrase-context" && !testCase.expected.phrase) {
      throw new Error("expected phrase is required for case " + testCase.id);
    }
    if (testCase.audit !== undefined) {
      if (!allowedErrorClasses.has(testCase.audit?.baselineErrorClass)) {
        throw new Error("unknown baseline error class for case " + testCase.id);
      }
      if (typeof testCase.audit?.fixLayer !== "string" || !testCase.audit.fixLayer.trim()) {
        throw new Error("audit fixLayer is required for case " + testCase.id);
      }
    }
  }
  const missingGroups = [...requiredGroups].filter((group) => !seenGroups.has(group));
  if (missingGroups.length) {
    throw new Error("lexical quality corpus is missing groups: " + missingGroups.join(", "));
  }
  return true;
}

export function matchesTopExpectation(candidate, expectation) {
  if (!expectation) return null;
  if (!candidate) return false;

  const checks = [];
  if (Array.isArray(expectation.translationAny)) {
    checks.push(intersects(candidate.translations, expectation.translationAny));
  }
  if (Array.isArray(expectation.kindAny)) {
    checks.push(expectation.kindAny.includes(candidate.kind));
  }
  if (Array.isArray(expectation.kindNot)) {
    checks.push(!expectation.kindNot.includes(candidate.kind));
  }
  if (Array.isArray(expectation.headwordAny)) {
    checks.push(includesNormalized(expectation.headwordAny, candidate.headword));
  }
  if (Array.isArray(expectation.partOfSpeechAny)) {
    checks.push(expectation.partOfSpeechAny.includes(candidate.partOfSpeech));
  }
  if (Array.isArray(expectation.typeLabelAny)) {
    checks.push(intersects(candidate.typeLabels, expectation.typeLabelAny));
  }
  return checks.length > 0 && checks.every(Boolean);
}

export function phraseRecovered(result, expectedPhrase) {
  if (!expectedPhrase) return false;
  const expected = normalizeLexicalKey(expectedPhrase);
  const lookup = result?.lookup || {};
  const decision = result?.decision || {};
  const values = [
    lookup.resolvedForm,
    lookup.matchedPhrase,
    lookup.contextPhrase?.text,
    lookup.phrase?.text,
    lookup.query?.text
  ];

  for (const candidate of Array.isArray(decision.candidates) ? decision.candidates : []) {
    values.push(candidate.headword, candidate.queryForm);
    if (Array.isArray(candidate.aliases)) values.push(...candidate.aliases);
  }
  return values.some((value) => value && normalizeLexicalKey(value) === expected);
}

function evaluateCase(testCase, result, elapsedMs) {
  const lookup = result.lookup || null;
  const decision = result.decision || null;
  const candidates = Array.isArray(decision?.candidates) ? decision.candidates : [];
  const top = candidates.find((candidate) => candidate.id === decision?.topCandidateId) || candidates[0] || null;
  const hit = lookup?.status === LEXICAL_RESULT_STATUS.CANDIDATES && candidates.length > 0;
  const expectedHit = testCase.expected.hit === true;
  const noHitCorrect = testCase.expected.mode === "no-hit"
    ? lookup?.status === LEXICAL_RESULT_STATUS.NO_HIT && decision?.outcome === "no-hit"
    : null;
  const topCorrect = testCase.expected.top
    ? matchesTopExpectation(top, testCase.expected.top)
    : null;
  const phraseCorrect = testCase.expected.mode === "phrase-context"
    ? phraseRecovered(result, testCase.expected.phrase)
    : null;

  return {
    id: testCase.id,
    group: testCase.group,
    mode: testCase.expected.mode,
    query: testCase.query,
    expectedHit,
    hit,
    hitCorrect: expectedHit ? hit : !hit,
    matchedBy: lookup?.matchedBy || null,
    resolvedForm: lookup?.resolvedForm || null,
    outcome: decision?.outcome || null,
    decisionReason: decision?.reason || null,
    candidateCount: candidates.length,
    topCandidateId: decision?.topCandidateId || null,
    topCandidate: summarizeCandidate(top),
    topCorrect,
    expectedPhrase: testCase.expected.phrase || null,
    phraseRecovered: phraseCorrect,
    noHitCorrect,
    coreHit: candidates.some(isCoreCandidate),
    technicalHit: candidates.some(isTechnicalCandidate),
    baselineErrorClass: testCase.audit?.baselineErrorClass || null,
    fixLayer: testCase.audit?.fixLayer || null,
    elapsedMs: round(elapsedMs)
  };
}

function summarizeMetrics(cases) {
  const exact = cases.filter((item) => item.mode === "exact");
  const normalized = cases.filter((item) => item.mode === "normalized");
  const inflection = cases.filter((item) => item.mode === "inflection");
  const phrase = cases.filter((item) => item.mode === "phrase-context");
  const noHit = cases.filter((item) => item.mode === "no-hit");
  const contrastive = cases.filter((item) => item.group === "contrastive");
  const expectedHits = cases.filter((item) => item.expectedHit);
  const topExpected = cases.filter((item) => item.topCorrect !== null);
  const topMeasured = topExpected.filter((item) => item.hit);
  const wrongTop = topMeasured.filter((item) => item.topCorrect === false);
  const topCoverageMisses = topExpected.filter((item) => !item.hit);
  const ambiguous = cases.filter((item) =>
    item.outcome === "ambiguous" && item.candidateCount > 0
  );

  return {
    exactHitRate: ratio(
      exact.filter((item) => item.hit && ["exact", "alias"].includes(item.matchedBy)).length,
      exact.length
    ),
    normalizedHitRate: ratio(normalized.filter((item) => item.hit).length, normalized.length),
    lemmaMorphologyRecoveryRate: ratio(
      inflection.filter((item) => item.hit && ["lemma", "morphology"].includes(item.matchedBy)).length,
      inflection.length
    ),
    inflectionHitRate: ratio(inflection.filter((item) => item.hit).length, inflection.length),
    phraseContextRecoveryRate: ratio(
      phrase.filter((item) => item.phraseRecovered === true).length,
      phrase.length
    ),
    trueNoHitRate: ratio(noHit.filter((item) => item.noHitCorrect === true).length, noHit.length),
    contrastiveSafeTopRate: ratio(
      contrastive.filter((item) => item.hit && item.topCorrect === true).length,
      contrastive.length
    ),
    contrastiveFailureCaseIds: contrastive
      .filter((item) => !item.hit || item.topCorrect !== true)
      .map((item) => item.id),
    top1CorrectRate: ratio(topMeasured.filter((item) => item.topCorrect === true).length, topMeasured.length),
    top1MeasuredCaseCount: topMeasured.length,
    wrongSenseTop1Count: wrongTop.length,
    wrongSenseTop1CaseIds: wrongTop.map((item) => item.id),
    topExpectationCoverageMissCount: topCoverageMisses.length,
    topExpectationCoverageMissCaseIds: topCoverageMisses.map((item) => item.id),
    ambiguousButCandidatesPresentCount: ambiguous.length,
    ambiguousButCandidatesPresentCaseIds: ambiguous.map((item) => item.id),
    baselineErrorClasses: countBy(
      cases.filter((item) => item.baselineErrorClass),
      (item) => item.baselineErrorClass
    ),
    fixLayers: countBy(cases.filter((item) => item.fixLayer), (item) => item.fixLayer),
    byGroup: summarizeGroupMetrics(cases),
    coreHit: metricCount(expectedHits, (item) => item.coreHit),
    technicalHit: metricCount(expectedHits, (item) => item.technicalHit),
    combinedHit: metricCount(expectedHits, (item) => item.hit)
  };
}

function summarizeGroupMetrics(cases) {
  const result = {};
  for (const group of [...new Set(cases.map((item) => item.group))].sort()) {
    const selected = cases.filter((item) => item.group === group);
    const topMeasured = selected.filter((item) => item.topCorrect !== null && item.hit);
    const phraseMeasured = selected.filter((item) => item.phraseRecovered !== null);
    const noHitMeasured = selected.filter((item) => item.noHitCorrect !== null);
    result[group] = {
      cases: selected.length,
      hitExpectationRate: ratio(selected.filter((item) => item.hitCorrect).length, selected.length),
      top1CorrectRate: ratio(topMeasured.filter((item) => item.topCorrect === true).length, topMeasured.length),
      wrongSenseTop1Count: topMeasured.filter((item) => item.topCorrect === false).length,
      phraseContextRecoveryRate: ratio(
        phraseMeasured.filter((item) => item.phraseRecovered === true).length,
        phraseMeasured.length
      ),
      trueNoHitRate: ratio(
        noHitMeasured.filter((item) => item.noHitCorrect === true).length,
        noHitMeasured.length
      )
    };
  }
  return result;
}

async function auditLockedSourceCoverage({ sourceRoot, expected }) {
  const englishPath = join(sourceRoot, "wns/eng/wn-data-eng.tab");
  const chinesePath = join(sourceRoot, "wns/cow/wn-data-cmn.tab");
  const [englishText, chineseText] = await Promise.all([
    readFile(englishPath, "utf8"),
    readFile(chinesePath, "utf8")
  ]);
  const english = parseOmwRows(englishText, "lemma");
  const chinese = parseOmwRows(chineseText, "cmn:lemma");
  const allHeadwords = new Set();
  const bilingualHeadwords = new Set();
  let bilingualSynsets = 0;

  for (const [synset, forms] of english) {
    const mapped = Array.isArray(chinese.get(synset)) && chinese.get(synset).length > 0;
    if (mapped) bilingualSynsets += 1;
    for (const rawForm of forms) {
      const key = normalizeLookupKey(normalizeEnglishDisplay(rawForm));
      if (!key) continue;
      allHeadwords.add(key);
      if (mapped) bilingualHeadwords.add(key);
    }
  }

  const actual = {
    pwnSynsets: english.size,
    pwnNormalizedHeadwords: allHeadwords.size,
    cowSynsets: chinese.size,
    bilingualSynsets,
    bilingualNormalizedHeadwords: bilingualHeadwords.size,
    unmappedPwnHeadwords: allHeadwords.size - bilingualHeadwords.size
  };
  const mismatches = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      mismatches.push(`source baseline mismatch for ${key}: expected ${expectedValue}, got ${actual[key]}`);
    }
  }

  return {
    ...actual,
    mappedHeadwordRate: ratio(actual.bilingualNormalizedHeadwords, actual.pwnNormalizedHeadwords),
    unmappedHeadwordRate: ratio(actual.unmappedPwnHeadwords, actual.pwnNormalizedHeadwords),
    baselineMatch: mismatches.length === 0,
    mismatches
  };
}

function createReleaseRuntime(readBytes) {
  const readers = ["core", "technical"].map((packBasePath) => createTflexReader({
    packBasePath,
    readBytes,
    cryptoProvider: webcrypto,
    cacheMaxEntries: 4,
    cacheMaxBytes: 2 * 1024 * 1024
  }));
  return {
    readers,
    gateway: createLexicalGateway({ packReaders: readers })
  };
}

function resolverDeps(gateway) {
  return {
    getConfig: async () => ({
      selectionExplanationDepth: "auto",
      targetLanguage: "Simplified Chinese"
    }),
    getEffectiveConfig: async () => ({
      targetLanguage: "Simplified Chinese"
    }),
    runLexicalLookup: (input) => gateway.lookup(input),
    assessLexicalLookup
  };
}

async function measurePerformance(releaseRoot) {
  const tracker = createReadTracker(releaseRoot);
  const runtime = createReleaseRuntime(tracker.readBytes);
  const cold = await timedLookup(runtime.gateway, "persistent");
  const afterCold = tracker.snapshot();
  const warm = await timedLookup(runtime.gateway, "persistent");
  const afterWarm = tracker.snapshot();
  const phrase = await timedLookup(runtime.gateway, "runtime environment");
  const morphology = await timedLookup(runtime.gateway, "sessions");

  const contextStarted = performance.now();
  const contextResult = await resolveSelectionRequest({
    text: "descendant",
    pageUrl: "https://benchmark.translateflow.invalid/css",
    context: {
      text: "The nested rule is related to the outer rule as a descendant combinator.",
      source: "visible-local",
      sensitive: false,
      truncated: false
    },
    depth: "auto",
    explainRequested: false
  }, resolverDeps(runtime.gateway));

  return {
    coldLookupMs: cold.ms,
    warmLookupMs: warm.ms,
    phraseLookupMs: phrase.ms,
    morphologyFallbackMs: morphology.ms,
    contextPhraseSelectionMs: round(performance.now() - contextStarted),
    coldReads: afterCold,
    warmReads: afterWarm,
    warmReadDelta: {
      reads: afterWarm.reads - afterCold.reads,
      bytes: afterWarm.bytes - afterCold.bytes
    },
    probes: {
      cold: summarizeLookup(cold.lookup),
      warm: summarizeLookup(warm.lookup),
      phrase: summarizeLookup(phrase.lookup),
      morphology: summarizeLookup(morphology.lookup),
      contextPhrase: {
        lookup: summarizeLookup(contextResult.lookup),
        outcome: contextResult.decision?.outcome || null,
        recovered: phraseRecovered(contextResult, "descendant combinator")
      }
    }
  };
}

async function timedLookup(gateway, text) {
  const started = performance.now();
  const lookup = await gateway.lookup({ text });
  return { lookup, ms: round(performance.now() - started) };
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

function summarizeCache(stats) {
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

function validateReleasePackSummary(packs) {
  const failures = [];
  const core = packs.find((pack) => pack.packId === "core-semantic-en-zh");
  const technical = packs.find((pack) => pack.packId === "technical-wikidata-en-zh");
  if (!core) failures.push("release Core pack is missing");
  if (!technical) failures.push("release Technical pack is missing");
  if (core && core.recordCount <= 0) failures.push("release Core pack is empty");
  if (technical && technical.recordCount <= 0) failures.push("release Technical pack is empty");
  return failures;
}

function validateIssue115QualityGates(cases) {
  const failures = [];
  for (const item of cases.filter((entry) => entry.group === "contrastive")) {
    if (!item.hit || item.topCorrect !== true) {
      failures.push(`contrastive ordinary-context regression: ${item.id}`);
    }
  }

  const css = cases.find((item) => item.id === "phrase-descendant-combinator");
  if (!css?.hit || css.phraseRecovered !== true || css.topCorrect !== true) {
    failures.push("CSS descendant combinator release gate failed");
  }
  return failures;
}

function summarizeLookup(lookup) {
  return {
    status: lookup?.status || null,
    matchedBy: lookup?.matchedBy || null,
    resolvedForm: lookup?.resolvedForm || null,
    candidateCount: Array.isArray(lookup?.candidates) ? lookup.candidates.length : 0
  };
}

function summarizeCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id || null,
    kind: candidate.kind || null,
    headword: candidate.headword || null,
    partOfSpeech: candidate.partOfSpeech || null,
    translations: Array.isArray(candidate.translations) ? candidate.translations : [],
    domains: Array.isArray(candidate.domains) ? candidate.domains : [],
    typeLabels: Array.isArray(candidate.typeLabels) ? candidate.typeLabels : [],
    packId: candidate.provenance?.packId || null,
    score: candidate.ranking?.score ?? null
  };
}

function isCoreCandidate(candidate) {
  return String(candidate?.provenance?.packId || "").startsWith("core");
}

function isTechnicalCandidate(candidate) {
  return String(candidate?.provenance?.packId || "").startsWith("technical");
}

function intersects(actual, expected) {
  const actualSet = new Set((Array.isArray(actual) ? actual : []).map(normalizeComparable));
  return (Array.isArray(expected) ? expected : []).some((value) => actualSet.has(normalizeComparable(value)));
}

function includesNormalized(values, value) {
  const target = normalizeComparable(value);
  return values.some((item) => normalizeComparable(item) === target);
}

function normalizeComparable(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

function metricCount(cases, predicate) {
  const count = cases.filter(predicate).length;
  return { count, total: cases.length, rate: ratio(count, cases.length) };
}

function countBy(values, keyFn) {
  const result = {};
  for (const value of values) {
    const key = keyFn(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await benchmarkLexicalQuality({
    fixturePath: args.fixture || undefined,
    releaseRoot: args.root || undefined,
    sourceRoot: args["source-root"] || undefined
  });
  const output = JSON.stringify(report, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), output);
  process.stdout.write(output);
  if (report.structuralFailures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
