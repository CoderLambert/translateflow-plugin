#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEXICAL_RESULT_STATUS,
  normalizeLexicalKey
} from "../src/shared/lexical.js";
import { assessLexicalLookup } from "../src/background/lexical/ranking.js";

export async function evaluateLexicalRanking({
  fixturePath = fileURLToPath(new URL("../tests/fixtures/lexical-ranking-v1.json", import.meta.url))
} = {}) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), "utf8"));
  validateFixture(fixture);

  const results = [];
  let outcomeCorrect = 0;
  let topCandidateCorrect = 0;
  let topCandidateExpected = 0;
  let expectedHitCases = 0;
  let coveredHitCases = 0;
  let falsePositiveTopCount = 0;
  let falsePositiveMeasuredCases = 0;

  for (const testCase of fixture.cases) {
    const lookup = materializeLookup(testCase, fixture.candidates);
    const decision = assessLexicalLookup(lookup, { contextText: testCase.context || "" });
    const outcomeMatch = decision.outcome === testCase.expected.outcome;
    if (outcomeMatch) outcomeCorrect += 1;

    const expectedTop = testCase.expected.topCandidateId ?? null;
    const topMatch = decision.topCandidateId === expectedTop;
    if (expectedTop !== null) {
      topCandidateExpected += 1;
      if (topMatch) topCandidateCorrect += 1;
    }

    const expectsHit = ["sufficient", "ambiguous"].includes(testCase.expected.outcome);
    if (expectsHit) {
      expectedHitCases += 1;
      if (decision.candidates.length > 0 && !["no-hit", "unsupported", "error"].includes(decision.outcome)) {
        coveredHitCases += 1;
      }
    }

    const falsePositiveIds = Array.isArray(testCase.falsePositiveCandidateIds)
      ? testCase.falsePositiveCandidateIds
      : [];
    if (falsePositiveIds.length) {
      falsePositiveMeasuredCases += 1;
      if (falsePositiveIds.includes(decision.topCandidateId)) falsePositiveTopCount += 1;
    }

    results.push({
      id: testCase.id,
      outcome: decision.outcome,
      expectedOutcome: testCase.expected.outcome,
      outcomeMatch,
      topCandidateId: decision.topCandidateId,
      expectedTopCandidateId: expectedTop,
      topMatch,
      scoreGap: decision.scoreGap,
      candidateCount: decision.candidates.length
    });
  }

  const failures = results.filter((result) =>
    !result.outcomeMatch ||
    (result.expectedTopCandidateId !== null && !result.topMatch)
  );

  return {
    corpusVersion: fixture.version,
    policyVersion: fixture.policyVersion,
    totalCases: fixture.cases.length,
    outcomeAccuracy: ratio(outcomeCorrect, fixture.cases.length),
    topCandidateAccuracy: ratio(topCandidateCorrect, topCandidateExpected),
    coverage: ratio(coveredHitCases, expectedHitCases),
    falsePositiveTopRate: ratio(falsePositiveTopCount, falsePositiveMeasuredCases),
    failures,
    results
  };
}

export function materializeLookup(testCase, catalog) {
  const status = testCase.lookup?.status;
  if (!Object.values(LEXICAL_RESULT_STATUS).includes(status)) {
    throw new Error("unknown lookup status for case " + testCase.id);
  }
  const candidateIds = Array.isArray(testCase.lookup.candidateIds) ? testCase.lookup.candidateIds : [];
  const candidates = candidateIds.map((id) => {
    const candidate = catalog[id];
    if (!candidate) throw new Error("unknown candidate fixture: " + id);
    return structuredClone(candidate);
  });

  const result = {
    status,
    query: {
      text: testCase.query,
      normalized: normalizeLexicalKey(testCase.query),
      sourceLanguage: status === "unsupported" ? "ja" : "en",
      targetLanguage: "zh-CN"
    }
  };

  if (status === LEXICAL_RESULT_STATUS.CANDIDATES) {
    result.override = testCase.lookup.override === true;
    result.matchedBy = testCase.lookup.matchedBy || null;
    result.candidates = candidates;
  }
  if (status === LEXICAL_RESULT_STATUS.UNSUPPORTED) {
    result.supported = { sourceLanguages: ["en"], targetLanguages: ["zh-CN"] };
  }
  return result;
}

function validateFixture(fixture) {
  if (!fixture || fixture.version !== 1 || fixture.policyVersion !== 1) {
    throw new Error("unsupported lexical ranking fixture version");
  }
  if (!fixture.candidates || typeof fixture.candidates !== "object" || Array.isArray(fixture.candidates)) {
    throw new Error("lexical ranking candidate catalog is required");
  }
  if (!Array.isArray(fixture.cases) || !fixture.cases.length) {
    throw new Error("lexical ranking cases are required");
  }

  const ids = new Set();
  for (const testCase of fixture.cases) {
    if (!testCase?.id || ids.has(testCase.id)) throw new Error("duplicate/missing lexical ranking case id");
    ids.add(testCase.id);
    if (!testCase.expected || typeof testCase.expected.outcome !== "string") {
      throw new Error("expected outcome missing for case " + testCase.id);
    }
  }
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}

async function main() {
  const report = await evaluateLexicalRanking({
    fixturePath: process.argv[2] || undefined
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
