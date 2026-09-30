#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeLookupKey,
  stableStringify
} from "./build-tflex-core.mjs";
import {
  createProjectionStats,
  KAIKKI_PROJECTION_VERSION,
  projectKaikkiEntry
} from "./project-kaikki-rich.mjs";
import { validateWikimediaSourceLock } from "./wikimedia-enwiktionary-contract.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOCK = resolve(
  REPOSITORY_ROOT,
  "lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json"
);
const EXPECTED_SOURCE_ID = "wikimedia-enwiktionary-20260901";
const EXPECTED_SOURCE_SHA256 = "06acca8138eacb3e8ae9c1d6232f836e37c3bf9b6d582a86693731fe0d336c20";
const EXPECTED_SOURCE_BYTES = 1632298458;
const EXPECTED_WIKTEXTRACT_COMMIT = "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a";
const EXPECTED_WIKITEXTPROCESSOR_COMMIT = "e3d6d4edb77618f4d6680edc66e3f774bea59820";
const MAX_AUDIT_REPORT_BYTES = 8192;
const TARGET_TRANSLATION_CODES = new Set(["cmn", "zh"]);
const REQUIRED_HEADWORDS = [
  "state",
  "session",
  "issue",
  "commit",
  "branch",
  "process",
  "run",
  "set",
  "container",
  "cache",
  "repository",
  "descendant",
  "descendant combinator",
  "dependency injection",
  "event loop",
  "garbage collection",
  "container image",
  "state management"
];

/**
 * Audit a full Wiktextract JSONL export against the exact locked Wikimedia
 * source and pinned extractor evidence. This is a compatibility dry run only;
 * it never writes dictionary rows or a projected JSONL file.
 */
export async function auditWiktextractProjectionCompatibility({
  inputPath,
  evidencePath,
  sourceLockPath = DEFAULT_LOCK
} = {}) {
  const input = requiredPath(inputPath, "inputPath");
  const evidenceFile = requiredPath(evidencePath, "evidencePath");
  const lockFile = requiredPath(sourceLockPath, "sourceLockPath");

  // Validate identity and both hashes before any JSONL row is parsed.
  const lock = validateWikimediaSourceLock(
    JSON.parse(await readFile(lockFile, "utf8"))
  );
  validateExpectedLockIdentity(lock);
  const extractionEvidence = JSON.parse(await readFile(evidenceFile, "utf8"));
  validateExtractionEvidence(extractionEvidence, lock);
  const inputDigest = await digestFile(input);
  const extraction = extractionEvidence.extraction;
  if (inputDigest.sizeBytes !== extraction.outputBytes) {
    throw new Error(
      "Wiktextract JSONL byte size does not match extraction evidence"
    );
  }
  if (inputDigest.sha256 !== extraction.outputSha256) {
    throw new Error(
      "Wiktextract JSONL SHA-256 does not match extraction evidence"
    );
  }

  const sourceShape = createSourceShapeStats();
  const projectorStats = createProjectionStats();
  const failures = {
    malformedJsonRows: 0,
    malformedProjectionFailures: 0,
    hostileProjectionFailures: 0,
    safetyLimitProjectionFailures: 0,
    otherProjectionFailures: 0
  };
  const requiredWords = new Map(
    REQUIRED_HEADWORDS.map((word) => [normalizeLookupKey(word), createRequiredWordStats(word)])
  );
  const outputHash = createHash("sha256");
  let outputBytes = 0;
  let physicalLine = 0;
  let nonEmptyRows = 0;
  let projectedSenseCount = 0;
  let projectedTranslationCount = 0;

  const lines = createInterface({
    input: createReadStream(input),
    crlfDelay: Infinity
  });
  for await (const line of lines) {
    physicalLine += 1;
    if (!line.trim()) continue;
    nonEmptyRows += 1;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      failures.malformedJsonRows += 1;
      continue;
    }
    if (!plainObject(entry)) {
      failures.malformedProjectionFailures += 1;
      continue;
    }

    const english = entry.lang_code === "en";
    if (english) recordSourceShape(entry, sourceShape, requiredWords);

    const perEntryStats = createProjectionStats();
    let projected;
    try {
      projected = projectKaikkiEntry(entry, {
        lineNumber: physicalLine,
        stats: perEntryStats
      });
    } catch (error) {
      countProjectionFailure(failures, error);
      continue;
    }
    mergeProjectionStats(projectorStats, perEntryStats);
    if (!projected) continue;

    const serialized = stableStringify(projected) + "\n";
    const bytes = Buffer.from(serialized, "utf8");
    outputHash.update(bytes);
    outputBytes += bytes.byteLength;
    projectedSenseCount += projected.senses.length;
    projectedTranslationCount += projected.senses.reduce(
      (count, sense) => count + sense.translations.length,
      0
    );

    const required = requiredWords.get(normalizeLookupKey(projected.headword));
    if (required) {
      required.currentV1ProjectedEntries += 1;
      required.currentV1ProjectedSenses += projected.senses.length;
      required.currentV1ProjectedTranslations += projectedTranslationCountFor(projected);
    }
  }

  if (nonEmptyRows !== extraction.recordCount) {
    throw new Error(
      "Wiktextract JSONL record count does not match extraction evidence"
    );
  }

  const report = {
    schemaVersion: 1,
    kind: "wiktextract-rich-projection-compatibility-dry-run",
    projectionVersion: KAIKKI_PROJECTION_VERSION,
    productQualityClaim: false,
    source: {
      sourceId: lock.sourceId,
      dumpDate: lock.dumpDate,
      sha256: lock.artifact.sha256,
      sizeBytes: lock.artifact.sizeBytes
    },
    extractor: {
      wiktextractCommit: EXPECTED_WIKTEXTRACT_COMMIT,
      wikitextprocessorCommit: EXPECTED_WIKITEXTPROCESSOR_COMMIT
    },
    input: {
      format: "wiktextract-jsonl",
      languageCode: extraction.languageCode,
      sha256: inputDigest.sha256,
      sizeBytes: inputDigest.sizeBytes,
      recordCount: nonEmptyRows,
      englishRecords: extraction.langCodeRecordCounts.en,
      missingLanguageCodeRecords: extraction.langCodeRecordCounts.missing || 0
    },
    extractionEvidenceStatus: {
      status: extractionEvidence.extractionStatus,
      pageHandlerExceptionRecords:
        extractionEvidence.diagnostics.pageHandlerExceptionRecords,
      pageHandlerExceptionLogMarkers:
        extractionEvidence.diagnostics.pageHandlerExceptionLogMarkers,
      pageHandlerExceptionEventsLowerBound:
        extractionEvidence.diagnostics.pageHandlerExceptionEventsLowerBound,
      diagnosticArrays: diagnosticArraySummary(extractionEvidence.diagnostics)
    },
    sourceShape,
    currentV1ProjectionDryRun: {
      projectedEntries: projectorStats.projectedEntries,
      projectedSenses: projectedSenseCount,
      projectedTranslations: projectedTranslationCount,
      ignoredEntryLevelChineseTranslations:
        projectorStats.ignoredEntryLevelChineseTranslations,
      skippedNonEnglishEntries: projectorStats.skippedNonEnglishEntries,
      skippedInvalidHeadwordEntries: projectorStats.skippedInvalidHeadwordEntries,
      skippedWithoutSenseLevelChinese:
        projectorStats.skippedWithoutSenseLevelChinese,
      outputSha256: outputHash.digest("hex"),
      outputBytes,
      failures
    },
    requiredHeadwordValidationOnly: {
      purpose: "validation counts only; entries are never inserted by this audit",
      words: [...requiredWords.values()]
    }
  };
  if (
    Buffer.byteLength(JSON.stringify(report, null, 2) + "\n", "utf8") >
    MAX_AUDIT_REPORT_BYTES
  ) {
    throw new Error("Wiktextract compatibility report exceeds its size limit");
  }
  return report;
}

function createSourceShapeStats() {
  return {
    inputEnglish: 0,
    englishEntriesWithEntryTranslations: 0,
    entryTranslationRows: 0,
    entryZhCmnRows: 0,
    entryZhCmnRowsWithSenseLabel: 0,
    entryZhCmnRowsWithoutSenseLabel: 0,
    nestedSenseTranslationRows: 0,
    englishEntriesWithNestedTranslations: 0,
    definitionSenseCount: 0,
    definitionSensesWithZhCmnTranslations: 0
  };
}

function createRequiredWordStats(word) {
  return {
    word,
    sourceEnglishEntries: 0,
    entryZhCmnRows: 0,
    nestedZhCmnRows: 0,
    currentV1ProjectedEntries: 0,
    currentV1ProjectedSenses: 0,
    currentV1ProjectedTranslations: 0
  };
}

function recordSourceShape(entry, stats, requiredWords) {
  stats.inputEnglish += 1;
  const topLevel = Array.isArray(entry.translations) ? entry.translations : [];
  if (topLevel.length) stats.englishEntriesWithEntryTranslations += 1;
  stats.entryTranslationRows += topLevel.length;

  const entryChinese = topLevel.filter(isZhCmnTranslation);
  for (const translation of entryChinese) {
    stats.entryZhCmnRows += 1;
    if (hasSenseLabel(translation)) stats.entryZhCmnRowsWithSenseLabel += 1;
    else stats.entryZhCmnRowsWithoutSenseLabel += 1;
  }

  const sourceSenses = Array.isArray(entry.senses) ? entry.senses : [];
  stats.definitionSenseCount += sourceSenses.length;
  let entryHasNestedChinese = false;
  for (const sense of sourceSenses) {
    if (!plainObject(sense) || !Array.isArray(sense.translations)) continue;
    const nestedChinese = sense.translations.filter(isZhCmnTranslation);
    stats.nestedSenseTranslationRows += nestedChinese.length;
    if (nestedChinese.length) {
      stats.definitionSensesWithZhCmnTranslations += 1;
      entryHasNestedChinese = true;
    }
  }
  if (entryHasNestedChinese) stats.englishEntriesWithNestedTranslations += 1;

  const required = requiredWords.get(normalizeLookupKey(entry.word));
  if (required) {
    required.sourceEnglishEntries += 1;
    required.entryZhCmnRows += entryChinese.length;
    required.nestedZhCmnRows += countNestedChineseRows(sourceSenses);
  }
}

function countNestedChineseRows(senses) {
  return senses.reduce((count, sense) => {
    if (!plainObject(sense) || !Array.isArray(sense.translations)) return count;
    return count + sense.translations.filter(isZhCmnTranslation).length;
  }, 0);
}

function isZhCmnTranslation(value) {
  if (!plainObject(value)) return false;
  const code = typeof value.lang_code === "string" && value.lang_code
    ? value.lang_code
    : value.code;
  return typeof code === "string" && TARGET_TRANSLATION_CODES.has(code);
}

function hasSenseLabel(translation) {
  return typeof translation.sense === "string" && translation.sense.trim().length > 0;
}

function mergeProjectionStats(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] += value;
  }
}

function countProjectionFailure(failures, error) {
  const message = String(error?.message || error);
  if (/HTML-like markup|executable\/renderable scheme/u.test(message)) {
    failures.hostileProjectionFailures += 1;
  } else if (/safety limit|exceeds projection/u.test(message)) {
    failures.safetyLimitProjectionFailures += 1;
  } else if (/must be|must not|is required|is invalid|incompatible/u.test(message)) {
    failures.malformedProjectionFailures += 1;
  } else {
    failures.otherProjectionFailures += 1;
  }
}

function projectedTranslationCountFor(projected) {
  return projected.senses.reduce(
    (count, sense) => count + sense.translations.length,
    0
  );
}

function validateExpectedLockIdentity(lock) {
  if (
    lock.sourceId !== EXPECTED_SOURCE_ID ||
    lock.artifact.sha256 !== EXPECTED_SOURCE_SHA256 ||
    lock.artifact.sizeBytes !== EXPECTED_SOURCE_BYTES ||
    lock.extractor.wiktextractCommit !== EXPECTED_WIKTEXTRACT_COMMIT ||
    lock.extractor.wikitextprocessorCommit !== EXPECTED_WIKITEXTPROCESSOR_COMMIT
  ) {
    throw new Error("Wikimedia source lock is not the reviewed issue-176 identity");
  }
}

function validateExtractionEvidence(evidence, lock) {
  if (!plainObject(evidence)) throw new Error("Wiktextract extraction evidence must be an object");
  if (evidence.schemaVersion !== 1) {
    throw new Error("Wiktextract extraction evidence schema is incompatible");
  }
  const source = evidence.source;
  const extractor = evidence.extractor;
  const parserDb = evidence.parserDb;
  const extraction = evidence.extraction;
  if (
    !plainObject(source) ||
    source.sourceId !== lock.sourceId ||
    source.sha256 !== lock.artifact.sha256 ||
    source.sizeBytes !== lock.artifact.sizeBytes
  ) {
    throw new Error("Wiktextract extraction evidence source does not match Wikimedia lock");
  }
  if (
    !plainObject(extractor) ||
    extractor.wiktextractCommit !== EXPECTED_WIKTEXTRACT_COMMIT ||
    extractor.wikitextprocessorCommit !== EXPECTED_WIKITEXTPROCESSOR_COMMIT
  ) {
    throw new Error("Wiktextract extraction evidence revisions are incompatible");
  }
  const namespaceCounts = parserDb?.namespacePageCounts;
  if (
    !plainObject(parserDb) ||
    !Number.isSafeInteger(parserDb.bytes) ||
    parserDb.bytes <= 0 ||
    !plainObject(namespaceCounts) ||
    !Number.isSafeInteger(namespaceCounts.main) || namespaceCounts.main <= 0 ||
    !Number.isSafeInteger(namespaceCounts.template) || namespaceCounts.template <= 0 ||
    !Number.isSafeInteger(namespaceCounts.module) || namespaceCounts.module <= 0
  ) {
    throw new Error("Wiktextract parser database evidence is incomplete");
  }
  if (
    !plainObject(extraction) ||
    extraction.languageCode !== "en" ||
    extraction.translations !== true ||
    extraction.pronunciations !== true ||
    !Number.isSafeInteger(extraction.outputBytes) ||
    extraction.outputBytes <= 0 ||
    !Number.isSafeInteger(extraction.recordCount) ||
    extraction.recordCount <= 0 ||
    typeof extraction.outputSha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(extraction.outputSha256)
  ) {
    throw new Error("Wiktextract extraction output evidence is invalid");
  }
  const languageCounts = extraction.langCodeRecordCounts;
  if (
    !plainObject(languageCounts) ||
    !Number.isSafeInteger(languageCounts.en) || languageCounts.en <= 0 ||
    !optionalNonNegativeInteger(languageCounts.missing) ||
    !optionalNonNegativeInteger(languageCounts.other) ||
    (languageCounts.other || 0) !== 0
  ) {
    throw new Error("Wiktextract extraction language counts are invalid");
  }
  const diagnostics = evidence.diagnostics;
  const pageFailures = diagnostics?.pageHandlerExceptionRecords;
  const pageFailureMarkers = diagnostics?.pageHandlerExceptionLogMarkers;
  const pageFailureLowerBound = diagnostics?.pageHandlerExceptionEventsLowerBound;
  const arrayCounts = diagnostics?.arrays;
  if (
    !plainObject(diagnostics) ||
    !Number.isSafeInteger(pageFailures) || pageFailures < 0 ||
    !Number.isSafeInteger(pageFailureMarkers) || pageFailureMarkers < 0 ||
    !Number.isSafeInteger(pageFailureLowerBound) ||
    pageFailureLowerBound !== Math.max(pageFailures, pageFailureMarkers) ||
    !plainObject(arrayCounts) ||
    !["errors", "warnings", "debugs", "notes", "wiki_notices"].every((name) =>
      plainObject(arrayCounts[name]) &&
      Number.isSafeInteger(arrayCounts[name].records) &&
      arrayCounts[name].records >= 0 &&
      typeof arrayCounts[name].mayBeTruncated === "boolean"
    ) ||
    pageFailures > arrayCounts.errors.records
  ) {
    throw new Error("Wiktextract extraction diagnostics are invalid");
  }
  const expectedStatus = pageFailures > 0
      || pageFailureMarkers > 0
    ? "completed-with-page-failures"
    : "completed-without-observed-page-handler-failures";
  if (evidence.extractionStatus !== expectedStatus) {
    throw new Error("Wiktextract extraction status does not match page failure diagnostics");
  }
}

function optionalNonNegativeInteger(value) {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function diagnosticArraySummary(diagnostics) {
  return Object.fromEntries(
    ["errors", "warnings", "debugs", "notes", "wiki_notices"].map((name) => [
      name,
      {
        records: diagnostics.arrays[name].records,
        mayBeTruncated: diagnostics.arrays[name].mayBeTruncated
      }
    ])
  );
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required");
  }
  return resolve(value);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "usage: audit-wiktextract-projection-compatibility.mjs " +
        "--input JSONL --evidence EVIDENCE [--lock SOURCE_LOCK] [--out REPORT]"
      );
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lockPath = resolve(args.lock || DEFAULT_LOCK);
  if (
    args.out &&
    [args.input, args.evidence, lockPath].some((path) =>
      typeof path === "string" && resolve(path) === resolve(args.out)
    )
  ) {
    throw new Error("audit report path must not overwrite its input or source lock");
  }
  const report = await auditWiktextractProjectionCompatibility({
    inputPath: args.input,
    evidencePath: args.evidence,
    sourceLockPath: lockPath
  });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), serialized, "utf8");
  process.stdout.write(serialized);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error("Wiktextract projection compatibility audit failed: " + (error?.message || error));
    process.exitCode = 1;
  });
}
