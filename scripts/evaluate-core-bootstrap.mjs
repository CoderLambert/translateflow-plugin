#!/usr/bin/env node
import { createHash, webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { assessLexicalLookup } from "../src/background/lexical/ranking.js";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";
import {
  LEXICAL_RESULT_STATUS,
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../src/shared/lexical.js";
import { stableStringify } from "./build-tflex-core.mjs";
import {
  matchesTopExpectation,
  phraseRecovered,
  validateLexicalQualityFixture
} from "./benchmark-lexical-quality.mjs";

const DEFAULT_FIXTURE = fileURLToPath(
  new URL("../tests/fixtures/lexical-quality-v1.json", import.meta.url)
);
const DEFAULT_RELEASE_ROOT = resolve("assets/lexicon");

export const BOOTSTRAP_TAG_COUNT_THRESHOLDS = Object.freeze([1, 2, 5, 10]);

export async function evaluateCoreBootstrap({
  fixturePath = DEFAULT_FIXTURE,
  releaseRoot = DEFAULT_RELEASE_ROOT,
  thresholds = BOOTSTRAP_TAG_COUNT_THRESHOLDS
} = {}) {
  validateThresholds(thresholds);
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  validateLexicalQualityFixture(fixture);

  const pack = await loadCorePack(releaseRoot);
  const originalBytes = pack.manifestBytes + pack.manifest.files
    .reduce((sum, file) => sum + Number(file.size || 0), 0);
  const sourcePrior = summarizeSourcePrior(pack.records, thresholds);
  const profiles = [];

  const definitions = [
    { id: "full", minimumTagCount: null, records: pack.records },
    ...thresholds.map((minimumTagCount) => ({
      id: "tag-count-gte-" + minimumTagCount,
      minimumTagCount,
      records: filterCoreRecordsByMinTagCount(pack.records, minimumTagCount)
    }))
  ];

  for (const definition of definitions) {
    const projection = projectCorePack({
      manifest: pack.manifest,
      records: definition.records
    });
    const technicalReader = createReleaseTechnicalReader(releaseRoot);
    const coreReader = createMemoryCoreReader({
      manifest: projection.manifest,
      records: definition.records
    });
    const gateway = createLexicalGateway({ packReaders: [coreReader, technicalReader] });
    const cases = [];

    for (const testCase of fixture.cases) {
      const result = await resolveSelectionRequest({
        text: testCase.query,
        pageUrl: "https://bootstrap-eval.translateflow.invalid/",
        context: {
          text: testCase.context || "",
          source: "visible-local",
          sensitive: false,
          truncated: false
        },
        depth: "auto",
        explainRequested: false
      }, resolverDeps(gateway));
      cases.push(evaluateCase(testCase, result));
    }

    const metrics = summarizeMetrics(cases);
    profiles.push({
      id: definition.id,
      policy: definition.minimumTagCount === null ? {
        kind: "current-full-core",
        sourceDriven: true
      } : {
        kind: "wordnet-sense-tag-count",
        sourceId: "pwn-3.0-sense-index",
        rule: "retain headword when any mapped Core sense has tagCount >= threshold; retain all mapped senses for retained headwords",
        minimumTagCount: definition.minimumTagCount,
        sourceDriven: true,
        handAuthoredHeadwords: 0
      },
      records: {
        retained: definition.records.length,
        total: pack.records.length,
        rate: ratio(definition.records.length, pack.records.length)
      },
      size: {
        projectedCoreBytes: projection.totalBytes,
        currentCoreBytes: originalBytes,
        reductionBytes: originalBytes - projection.totalBytes,
        reductionRate: ratio(originalBytes - projection.totalBytes, originalBytes),
        lexicalDataBytes: projection.lexicalDataBytes,
        shardCount: projection.shards.length
      },
      metrics,
      projection: {
        fingerprint: projection.manifest.fingerprint
      },
      cases
    });
  }

  const full = profiles[0];
  const structuralFailures = [];
  if (full.size.projectedCoreBytes !== originalBytes) {
    structuralFailures.push(
      "full Core byte projection drift: expected " + originalBytes +
      ", projected " + full.size.projectedCoreBytes
    );
  }
  if (full.projection.fingerprint !== pack.manifest.fingerprint) {
    structuralFailures.push(
      "full Core fingerprint projection drift: expected " + pack.manifest.fingerprint +
      ", projected " + full.projection.fingerprint
    );
  }

  for (const profile of profiles.slice(1)) {
    const fullMetrics = full.metrics;
    profile.deltaFromFull = {
      combinedHitRate: round(profile.metrics.combinedHit.rate - fullMetrics.combinedHit.rate),
      exactHitRate: round(profile.metrics.exactHitRate - fullMetrics.exactHitRate),
      normalizedHitRate: round(profile.metrics.normalizedHitRate - fullMetrics.normalizedHitRate),
      inflectionHitRate: round(profile.metrics.inflectionHitRate - fullMetrics.inflectionHitRate),
      phraseContextRecoveryRate: round(
        profile.metrics.phraseContextRecoveryRate - fullMetrics.phraseContextRecoveryRate
      ),
      top1CorrectRate: round(profile.metrics.top1CorrectRate - fullMetrics.top1CorrectRate),
      trueNoHitRate: round(profile.metrics.trueNoHitRate - fullMetrics.trueNoHitRate)
    };
  }

  return {
    schemaVersion: 1,
    evaluation: "core-bootstrap-source-derived",
    productionBehaviorChanged: false,
    sourcePolicy: {
      signal: "WordNet 3.0 index.sense tagCount",
      sourceId: "pwn-3.0-sense-index",
      rationale: "Use source-provided corpus attestation only; benchmark words never determine membership.",
      retainedSensePolicy: "All mapped senses are preserved once a headword passes the source-derived record gate."
    },
    currentCore: {
      packId: pack.manifest.packId,
      packVersion: pack.manifest.packVersion,
      fingerprint: pack.manifest.fingerprint,
      records: pack.records.length,
      bytes: originalBytes
    },
    sourcePrior,
    profiles,
    structuralFailures
  };
}

export function recordMaxTagCount(record) {
  let max = -1;
  for (const sense of Array.isArray(record?.senses) ? record.senses : []) {
    if (Number.isSafeInteger(sense?.tagCount) && sense.tagCount >= 0) {
      max = Math.max(max, sense.tagCount);
    }
  }
  return max;
}

export function filterCoreRecordsByMinTagCount(records, minimumTagCount) {
  if (!Number.isSafeInteger(minimumTagCount) || minimumTagCount <= 0) {
    throw new Error("minimumTagCount must be a positive integer");
  }
  return (Array.isArray(records) ? records : []).filter(
    (record) => recordMaxTagCount(record) >= minimumTagCount
  );
}

export function projectCorePack({ manifest, records }) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Core manifest is required");
  }
  if (!Array.isArray(records) || !records.length) {
    throw new Error("projected Core records must be non-empty");
  }
  const maxShardBytes = manifest.profileOptions?.maxShardBytes;
  if (!Number.isSafeInteger(maxShardBytes) || maxShardBytes <= 0) {
    throw new Error("Core maxShardBytes is invalid");
  }

  const shards = projectShards(records, maxShardBytes);
  const directory = {
    format: "tflex-directory",
    formatVersion: manifest.formatVersion,
    normalizationVersion: manifest.normalizationVersion,
    shards: shards.map(({ path, firstKey, lastKey, count, size, sha256 }) => ({
      path, firstKey, lastKey, count, size, sha256
    }))
  };
  const directoryText = stableStringify(directory) + "\n";
  const projectedFiles = [
    descriptor("lookup-index", "directory.json", directoryText),
    ...shards.map((shard) => descriptor("lexical-data", shard.path, shard.text)),
    ...manifest.files
      .filter((file) => !["lookup-index", "lexical-data"].includes(file.role))
      .map((file) => ({ ...file }))
  ].sort(compareFile);

  const fingerprintPayload = makeFingerprintPayload({
    manifest,
    files: projectedFiles
  });
  const projectedManifest = {
    ...manifest,
    fingerprint: "sha256:" + sha256Text(stableStringify(fingerprintPayload)),
    recordCount: records.length,
    files: projectedFiles.map(({ text: _text, ...file }) => file)
  };
  const manifestText = stableStringify(projectedManifest) + "\n";
  const lexicalDataBytes = shards.reduce((sum, shard) => sum + shard.size, 0);
  const listedFileBytes = projectedFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    manifest: projectedManifest,
    manifestText,
    directory,
    directoryText,
    shards,
    lexicalDataBytes,
    totalBytes: Buffer.byteLength(manifestText) + listedFileBytes
  };
}

function projectShards(records, maxShardBytes) {
  const shards = [];
  let lines = [];
  let bytes = 0;
  let firstKey = "";
  let lastKey = "";

  function flush() {
    if (!lines.length) return;
    const path = "shards/" + String(shards.length).padStart(4, "0") + ".jsonl";
    const text = lines.join("");
    shards.push({
      path,
      text,
      firstKey,
      lastKey,
      count: lines.length,
      size: Buffer.byteLength(text),
      sha256: sha256Text(text)
    });
    lines = [];
    bytes = 0;
    firstKey = "";
    lastKey = "";
  }

  for (const record of records) {
    const line = stableStringify(record) + "\n";
    const size = Buffer.byteLength(line);
    if (size > maxShardBytes) {
      throw new Error("projected record exceeds Core shard budget: " + record.lookupKey);
    }
    if (lines.length && bytes + size > maxShardBytes) flush();
    if (!lines.length) firstKey = record.lookupKey;
    lastKey = record.lookupKey;
    lines.push(line);
    bytes += size;
  }
  flush();
  return shards;
}

async function loadCorePack(releaseRoot) {
  const root = resolve(releaseRoot);
  const manifestText = await readFile(join(root, "core", "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const directoryText = await readFile(join(root, "core", "directory.json"), "utf8");
  const directory = JSON.parse(directoryText);
  if (Array.isArray(directory.aliases) && directory.aliases.length) {
    throw new Error("Core bootstrap evaluator does not support an alias-indexed Core pack");
  }
  const records = [];
  for (const shard of directory.shards || []) {
    const text = await readFile(join(root, "core", shard.path), "utf8");
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      records.push(JSON.parse(line));
    }
  }
  if (records.length !== manifest.recordCount) {
    throw new Error(
      "Core record count mismatch: manifest " + manifest.recordCount + ", loaded " + records.length
    );
  }
  return {
    manifest,
    directory,
    records,
    manifestBytes: Buffer.byteLength(manifestText)
  };
}

function createMemoryCoreReader({ manifest, records }) {
  const byKey = new Map(records.map((record) => [record.lookupKey, record]));

  async function lookupAll(text) {
    const key = normalizeLexicalKey(text);
    if (!key) return [];
    const record = byKey.get(key);
    if (!record) return [];
    const exactKey = normalizeLexicalExactKey(text);
    return [{
      record,
      exactCaseMatch: Array.isArray(record.exactLookupKeys) &&
        record.exactLookupKeys.includes(exactKey),
      matchedAlias: false,
      aliasKey: "",
      pack: {
        packId: manifest.packId,
        packVersion: manifest.packVersion,
        fingerprint: manifest.fingerprint,
        sourceLanguage: manifest.sourceLanguage,
        targetLanguage: manifest.targetLanguage
      }
    }];
  }

  return {
    lookup: async (text) => (await lookupAll(text))[0] || null,
    lookupAll,
    inspect: async () => ({
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      fingerprint: manifest.fingerprint,
      sourceLanguage: manifest.sourceLanguage,
      targetLanguage: manifest.targetLanguage,
      recordCount: records.length,
      sources: manifest.sources.map((source) => ({
        id: source.id,
        version: source.version,
        licenseId: source.license?.id || ""
      }))
    }),
    stats: () => ({
      metadataLoaded: true,
      cache: { entries: 0, bytes: 0, maxEntries: 0, maxBytes: 0 }
    })
  };
}

function createReleaseTechnicalReader(releaseRoot) {
  const root = resolve(releaseRoot);
  return createTflexReader({
    packBasePath: "technical",
    readBytes: async (relativePath) => new Uint8Array(await readFile(join(root, relativePath))),
    cryptoProvider: webcrypto,
    cacheMaxEntries: 4,
    cacheMaxBytes: 2 * 1024 * 1024
  });
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

function evaluateCase(testCase, result) {
  const lookup = result.lookup || null;
  const decision = result.decision || null;
  const candidates = Array.isArray(decision?.candidates) ? decision.candidates : [];
  const top = candidates.find((candidate) => candidate.id === decision?.topCandidateId) ||
    candidates[0] || null;
  const hit = lookup?.status === LEXICAL_RESULT_STATUS.CANDIDATES && candidates.length > 0;
  const expectedHit = testCase.expected.hit === true;

  return {
    id: testCase.id,
    group: testCase.group,
    mode: testCase.expected.mode,
    query: testCase.query,
    expectedHit,
    hit,
    hitCorrect: expectedHit ? hit : !hit,
    matchedBy: lookup?.matchedBy || null,
    outcome: decision?.outcome || null,
    candidateCount: candidates.length,
    topCorrect: testCase.expected.top
      ? matchesTopExpectation(top, testCase.expected.top)
      : null,
    phraseRecovered: testCase.expected.mode === "phrase-context"
      ? phraseRecovered(result, testCase.expected.phrase)
      : null,
    noHitCorrect: testCase.expected.mode === "no-hit"
      ? lookup?.status === LEXICAL_RESULT_STATUS.NO_HIT && decision?.outcome === "no-hit"
      : null
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
  const topMeasured = cases.filter((item) => item.topCorrect !== null && item.hit);

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
    trueNoHitRate: ratio(
      noHit.filter((item) => item.noHitCorrect === true).length,
      noHit.length
    ),
    contrastiveSafeTopRate: ratio(
      contrastive.filter((item) => item.hit && item.topCorrect === true).length,
      contrastive.length
    ),
    top1CorrectRate: ratio(
      topMeasured.filter((item) => item.topCorrect === true).length,
      topMeasured.length
    ),
    wrongSenseTop1Count: topMeasured.filter((item) => item.topCorrect === false).length,
    combinedHit: metricCount(expectedHits, (item) => item.hit)
  };
}

function summarizeSourcePrior(records, thresholds) {
  const tagged = records.filter((record) => recordMaxTagCount(record) > 0);
  const withPrior = records.filter((record) => recordMaxTagCount(record) >= 0);
  return {
    records: records.length,
    recordsWithSensePrior: withPrior.length,
    recordsWithPositiveTagCount: tagged.length,
    positiveTagCountRate: ratio(tagged.length, records.length),
    retainedByThreshold: Object.fromEntries(thresholds.map((threshold) => {
      const count = filterCoreRecordsByMinTagCount(records, threshold).length;
      return [String(threshold), {
        records: count,
        rate: ratio(count, records.length)
      }];
    }))
  };
}

function makeFingerprintPayload({ manifest, files }) {
  return {
    formatVersion: manifest.formatVersion,
    normalizationVersion: manifest.normalizationVersion,
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    profile: manifest.profile,
    profileOptions: { maxShardBytes: manifest.profileOptions?.maxShardBytes },
    sources: [...manifest.sources]
      .sort((a, b) => compareText(a.id, b.id))
      .map((source) => ({
        id: source.id,
        version: source.version,
        provenance: source.provenance,
        dataSha256: source.dataSha256,
        ...(Array.isArray(source.providesFields) ? {
          providesFields: [...source.providesFields]
        } : {}),
        licenseId: source.license.id
      })),
    files: [...files]
      .sort(compareFile)
      .map(({ role, path, size, sha256 }) => ({ role, path, size, sha256 }))
  };
}

function descriptor(role, path, text) {
  return {
    role,
    path,
    size: Buffer.byteLength(text),
    sha256: sha256Text(text),
    text
  };
}

function metricCount(cases, predicate) {
  const count = cases.filter(predicate).length;
  return { count, total: cases.length, rate: ratio(count, cases.length) };
}

function validateThresholds(thresholds) {
  if (!Array.isArray(thresholds) || !thresholds.length) {
    throw new Error("bootstrap thresholds are required");
  }
  let previous = 0;
  for (const threshold of thresholds) {
    if (!Number.isSafeInteger(threshold) || threshold <= previous) {
      throw new Error("bootstrap thresholds must be positive, sorted and unique");
    }
    previous = threshold;
  }
}

function compareFile(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Text(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
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
  const report = await evaluateCoreBootstrap({
    fixturePath: args.fixture || undefined,
    releaseRoot: args.root || undefined
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
