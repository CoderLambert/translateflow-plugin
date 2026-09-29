#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INTEGRATED_LEXICAL_BASELINE_V1 = Object.freeze({
  baselineCommit: "276376039ad53f76cc34956cc3d5934c399a9bf4",
  benchmarkVersion: 1,
  sourceRevision: "406bf83b3c507a3d1f26e88252d5d66893fd36bf",
  requiredCaseIds: Object.freeze([
    "ordinary-persistent", "ordinary-reliable", "ordinary-portable", "ordinary-descendant",
    "polysemy-state", "polysemy-session", "polysemy-issue", "polysemy-commit",
    "polysemy-branch", "polysemy-process", "polysemy-run",
    "technical-container", "technical-cache", "technical-repository", "technical-dependency",
    "entity-tmux", "entity-docker", "entity-kubernetes", "entity-redis",
    "entity-postgresql", "entity-react", "entity-oauth",
    "normalize-comma", "normalize-period", "normalize-colon", "normalize-close-paren",
    "normalize-smart-quotes", "normalize-smart-possessive", "normalize-straight-possessive",
    "normalize-soft-hyphen", "normalize-unicode-hyphen", "normalize-nbsp",
    "inflection-sessions", "inflection-dependencies", "inflection-repositories",
    "inflection-configured", "inflection-nested", "inflection-running", "inflection-written",
    "inflection-children", "inflection-better", "inflection-best", "inflection-worse",
    "inflection-went", "inflection-gone", "inflection-built",
    "phrase-descendant-combinator", "phrase-terminal-multiplexer",
    "phrase-dependency-injection", "phrase-event-loop", "phrase-garbage-collection",
    "phrase-runtime-environment", "phrase-container-image", "phrase-state-management",
    "negative-branch-ordinary", "negative-state-government", "negative-state-material",
    "negative-run-ordinary", "negative-process-ordinary", "negative-container-ordinary",
    "negative-issue-ordinary", "negative-commit-ordinary", "negative-descendant-ordinary",
    "nohit-project-token", "nohit-project-token-2", "nohit-code-call", "nohit-code-namespace",
    "contrastive-state-government", "contrastive-branch-tree", "contrastive-process-hiring",
    "contrastive-run-river", "contrastive-container-food", "contrastive-issue-social",
    "contrastive-commit-crime", "contrastive-repository-archive",
    "contrastive-dependency-territory", "contrastive-descendant-family"
  ]),
  floors: Object.freeze({
    exactHitRate: 39 / 40,
    normalizedHitRate: 8 / 10,
    lemmaMorphologyRecoveryRate: 4 / 14,
    inflectionHitRate: 7 / 14,
    phraseContextRecoveryRate: 2 / 9,
    combinedHitRate: 64 / 73,
    top1CorrectRate: 32 / 55,
    commonWordHitRate: 232 / 250,
    ordinaryBrowsingHitRate: 49 / 68
  }),
  ceilings: Object.freeze({
    wrongSenseTop1Count: 23,
    coldPackageReads: 8,
    coldPackageReadBytes: 1024 * 1024
  })
});

export function certifyIntegratedLexicalQuality({
  qualityReport,
  bootstrapReport,
  footprintReport
} = {}) {
  requireObject(qualityReport, "qualityReport");
  requireObject(bootstrapReport, "bootstrapReport");
  requireObject(footprintReport, "footprintReport");

  const failures = [];
  const baseline = INTEGRATED_LEXICAL_BASELINE_V1;

  if (qualityReport.schemaVersion !== 1 || qualityReport.benchmarkVersion !== baseline.benchmarkVersion) {
    failures.push("lexical quality report schema/benchmark version drift");
  }
  if (qualityReport.sourceRevision !== baseline.sourceRevision) {
    failures.push("lexical quality source revision drift");
  }
  appendNestedFailures(failures, "lexical benchmark", qualityReport.structuralFailures);
  appendNestedFailures(failures, "bootstrap evaluation", bootstrapReport.structuralFailures);
  appendNestedFailures(failures, "production footprint", footprintReport.structuralFailures);

  const caseIds = new Set((qualityReport.cases || []).map((item) => item?.id).filter(Boolean));
  const missingCaseIds = baseline.requiredCaseIds.filter((id) => !caseIds.has(id));
  if (missingCaseIds.length) {
    failures.push("required lexical certification scenarios missing: " + missingCaseIds.join(", "));
  }

  const metrics = qualityReport.metrics || {};
  requireEqual(metrics.trueNoHitRate, 1, "true no-hit rate", failures);
  requireEqual(metrics.contrastiveSafeTopRate, 1, "contrastive safe-top rate", failures);
  requireAtLeast(metrics.exactHitRate, baseline.floors.exactHitRate, "exact hit rate", failures);
  requireAtLeast(metrics.normalizedHitRate, baseline.floors.normalizedHitRate, "normalized hit rate", failures);
  requireAtLeast(
    metrics.lemmaMorphologyRecoveryRate,
    baseline.floors.lemmaMorphologyRecoveryRate,
    "lemma/morphology recovery rate",
    failures
  );
  requireAtLeast(metrics.inflectionHitRate, baseline.floors.inflectionHitRate, "inflection hit rate", failures);
  requireAtLeast(
    metrics.phraseContextRecoveryRate,
    baseline.floors.phraseContextRecoveryRate,
    "phrase/context recovery rate",
    failures
  );
  requireAtLeast(metrics.combinedHit?.rate, baseline.floors.combinedHitRate, "combined expected-hit rate", failures);
  requireAtLeast(metrics.top1CorrectRate, baseline.floors.top1CorrectRate, "measured top-1 correctness", failures);
  requireAtMost(
    metrics.wrongSenseTop1Count,
    baseline.ceilings.wrongSenseTop1Count,
    "wrong-sense top-1 count",
    failures
  );
  if (Array.isArray(metrics.contrastiveFailureCaseIds) && metrics.contrastiveFailureCaseIds.length) {
    failures.push("contrastive safety failures: " + metrics.contrastiveFailureCaseIds.join(", "));
  }

  certifyBundledSourceProvenance(qualityReport.releasePacks, failures);
  certifyLookupIo(qualityReport, baseline, failures);

  const fullProfile = (bootstrapReport.profiles || []).find((item) => item?.id === "full");
  if (!fullProfile) {
    failures.push("Core bootstrap evaluation is missing full production profile");
  } else {
    requireAtLeast(
      fullProfile.usageSamples?.commonWords?.hitRate,
      baseline.floors.commonWordHitRate,
      "source-derived common-word hit rate",
      failures
    );
    requireAtLeast(
      fullProfile.usageSamples?.ordinaryBrowsing?.hitRate,
      baseline.floors.ordinaryBrowsingHitRate,
      "ordinary-browsing hit rate",
      failures
    );
  }

  certifyPackageBoundary(footprintReport, failures);

  return {
    schemaVersion: 1,
    report: "integrated-selection-lexical-quality",
    baseline: {
      commit: baseline.baselineCommit,
      benchmarkVersion: baseline.benchmarkVersion,
      sourceRevision: baseline.sourceRevision,
      requiredScenarioCount: baseline.requiredCaseIds.length,
      floors: { ...baseline.floors },
      ceilings: { ...baseline.ceilings }
    },
    observed: {
      scenarioCount: caseIds.size,
      missingCaseIds,
      exactHitRate: metrics.exactHitRate ?? null,
      normalizedHitRate: metrics.normalizedHitRate ?? null,
      lemmaMorphologyRecoveryRate: metrics.lemmaMorphologyRecoveryRate ?? null,
      inflectionHitRate: metrics.inflectionHitRate ?? null,
      phraseContextRecoveryRate: metrics.phraseContextRecoveryRate ?? null,
      combinedHitRate: metrics.combinedHit?.rate ?? null,
      top1CorrectRate: metrics.top1CorrectRate ?? null,
      wrongSenseTop1Count: metrics.wrongSenseTop1Count ?? null,
      trueNoHitRate: metrics.trueNoHitRate ?? null,
      contrastiveSafeTopRate: metrics.contrastiveSafeTopRate ?? null,
      commonWordHitRate: fullProfile?.usageSamples?.commonWords?.hitRate ?? null,
      ordinaryBrowsingHitRate: fullProfile?.usageSamples?.ordinaryBrowsing?.hitRate ?? null,
      bundledLexicalRawBytes: footprintReport.rawBytes?.lexical ?? null,
      bundledLexicalZipProxyBytes: footprintReport.zipDeflateProxy?.lexicalBytes ?? null
    },
    policy: {
      dataOwnership:
        "bundled facts must remain attributable source data; validation/source/build inputs stay outside the extension",
      sourceGaps:
        "coverage floors are release regression guards, not permission to add project-authored runtime vocabulary",
      richDictionary:
        "high-coverage dictionaries remain downloadable/imported",
      ai:
        "local lexical certification does not add or authorize automatic Provider/AI fallback"
    },
    failures
  };
}

function certifyBundledSourceProvenance(packs, failures) {
  const list = Array.isArray(packs) ? packs : [];
  const core = list.find((pack) => pack?.packId === "core-semantic-en-zh");
  const technical = list.find((pack) => pack?.packId === "technical-wikidata-en-zh");
  if (!core || !technical) {
    failures.push("release packs must include bundled Core and Technical source packs");
    return;
  }

  const coreSourceIds = sortedIds(core.sources);
  const technicalSourceIds = sortedIds(technical.sources);
  const expectedCore = ["chinese-open-wordnet", "pwn-3.0", "pwn-3.0-sense-index"];
  if (JSON.stringify(coreSourceIds) !== JSON.stringify(expectedCore)) {
    failures.push("bundled Core source provenance drift: " + coreSourceIds.join(", "));
  }
  if (JSON.stringify(technicalSourceIds) !== JSON.stringify(["wikidata"])) {
    failures.push("bundled Technical source provenance drift: " + technicalSourceIds.join(", "));
  }
  if (list.some((pack) =>
    (pack?.sources || []).some((source) => String(source?.id || "").startsWith("translateflow-reviewed"))
  )) {
    failures.push("project-authored reviewed terminology re-entered bundled release provenance");
  }
}

function certifyLookupIo(qualityReport, baseline, failures) {
  const cold = qualityReport.performance?.coldReads || {};
  const warm = qualityReport.performance?.warmReadDelta || {};
  const cache = qualityReport.cache || {};

  requireAtMost(cold.reads, baseline.ceilings.coldPackageReads, "cold package reads", failures);
  requireAtMost(cold.bytes, baseline.ceilings.coldPackageReadBytes, "cold package read bytes", failures);
  requireEqual(warm.reads, 0, "warm package reread count", failures);
  requireEqual(warm.bytes, 0, "warm package reread bytes", failures);

  if (!Number.isSafeInteger(cache.bytes) || !Number.isSafeInteger(cache.maxBytes) || cache.bytes > cache.maxBytes) {
    failures.push("decoded lexical cache exceeds its byte-accounted budget");
  }
}

function certifyPackageBoundary(footprint, failures) {
  if (footprint.packageBoundary?.allowlistAudited !== true) {
    failures.push("production extension allowlist audit is not asserted");
  }
  if (footprint.packageBoundary?.validationAssetsIncluded !== false) {
    failures.push("validation/source/build assets may be entering the production extension");
  }
  if (Number(footprint.rawBytes?.otherLexical || 0) !== 0) {
    failures.push("unexpected bundled lexical pack category is present");
  }

  const rawBudget = footprint.bundledPolicy?.rawLexiconBudgetBytes;
  const zipBudget = footprint.bundledPolicy?.zipDeflateProxyBudgetBytes;
  requireAtMost(footprint.rawBytes?.lexical, rawBudget, "bundled lexical raw bytes", failures);
  requireAtMost(
    footprint.zipDeflateProxy?.lexicalBytes,
    zipBudget,
    "bundled lexical ZIP/deflate proxy bytes",
    failures
  );

  requireEqual(footprint.coldLookup?.warmReadDelta?.reads, 0, "footprint warm reread count", failures);
  requireEqual(footprint.coldLookup?.warmReadDelta?.bytes, 0, "footprint warm reread bytes", failures);
  if (
    !Number.isSafeInteger(footprint.coldLookup?.decodedCacheBytes) ||
    !Number.isSafeInteger(footprint.coldLookup?.decodedCacheBudgetBytes) ||
    footprint.coldLookup.decodedCacheBytes > footprint.coldLookup.decodedCacheBudgetBytes
  ) {
    failures.push("footprint decoded cache exceeds configured budget");
  }
  if (footprint.bundledPolicy?.richDictionaryPolicy !== "high-coverage dictionaries remain downloadable/imported") {
    failures.push("high-coverage dictionary packaging policy drift");
  }
}

function appendNestedFailures(target, label, values) {
  if (!Array.isArray(values)) {
    target.push(label + " did not report a structural failure list");
    return;
  }
  target.push(...values.map((value) => label + ": " + value));
}

function sortedIds(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item?.id || ""))
    .filter(Boolean)
    .sort();
}

function requireEqual(actual, expected, label, failures) {
  if (actual !== expected) {
    failures.push(label + " regression: expected " + expected + ", got " + String(actual));
  }
}

function requireAtLeast(actual, minimum, label, failures) {
  if (typeof actual !== "number" || !Number.isFinite(actual) || actual + Number.EPSILON < minimum) {
    failures.push(label + " regression: expected >= " + minimum + ", got " + String(actual));
  }
}

function requireAtMost(actual, maximum, label, failures) {
  if (
    typeof actual !== "number" ||
    !Number.isFinite(actual) ||
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    actual > maximum
  ) {
    failures.push(label + " regression: expected <= " + String(maximum) + ", got " + String(actual));
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object");
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "usage: certify-integrated-lexical-quality.mjs " +
        "--quality PATH --bootstrap PATH --footprint PATH [--out PATH]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["quality", "bootstrap", "footprint"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }

  const [qualityReport, bootstrapReport, footprintReport] = await Promise.all([
    readJson(args.quality),
    readJson(args.bootstrap),
    readJson(args.footprint)
  ]);
  const report = certifyIntegratedLexicalQuality({
    qualityReport,
    bootstrapReport,
    footprintReport
  });
  const output = JSON.stringify(report, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), output, "utf8");
  process.stdout.write(output);
  if (report.failures.length) process.exitCode = 1;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
