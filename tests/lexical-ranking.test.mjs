import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  LEXICAL_DECISION_OUTCOME
} from "../src/shared/lexical.js";
import {
  LEXICAL_RANKING_POLICY_V1,
  assessLexicalLookup
} from "../src/background/lexical/ranking.js";
import {
  evaluateLexicalRanking,
  materializeLookup
} from "../scripts/evaluate-lexical-ranking.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/lexical-ranking-v1.json", import.meta.url));

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("Phase B corpus matches the frozen ranking/sufficiency baseline", async () => {
  const report = await evaluateLexicalRanking({ fixturePath });
  assert.equal(report.totalCases, 18);
  assert.equal(report.outcomeAccuracy, 1);
  assert.equal(report.topCandidateAccuracy, 1);
  assert.equal(report.coverage, 1);
  assert.equal(report.falsePositiveTopRate, 0);
  assert.deepEqual(report.failures, []);
});

test("technical context can outrank a generic sense without suppressing it", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "session-tech-ambiguous");
  const lookup = materializeLookup(testCase, data.candidates);
  const result = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.equal(result.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(result.topCandidateId, "technical:Q932410");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.id),
    ["technical:Q932410", "core:session:general"]
  );
  assert.ok(result.candidates.every((candidate) => candidate.provenance.packId));
});

test("strong structured context can make the same technical candidate sufficient", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "session-technical-decisive");
  const lookup = materializeLookup(testCase, data.candidates);
  const result = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.equal(result.outcome, LEXICAL_DECISION_OUTCOME.SUFFICIENT);
  assert.equal(result.topCandidateId, "technical:Q932410");
  assert.ok(result.scoreGap >= LEXICAL_RANKING_POLICY_V1.thresholds.decisiveGap);
  assert.equal(result.candidates.length, 2);
});

test("same Chinese string from different sources is never silently merged", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "cross-source-same-translation");
  const lookup = materializeLookup(testCase, data.candidates);
  const result = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.equal(result.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.provenance.packId),
    ["core-semantic", "optional-dictionary"]
  );
  assert.ok(result.candidates.every((candidate) => candidate.translations.includes("持久的")));
});

test("User Glossary remains the only explicit override path", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "glossary-override");
  const lookup = materializeLookup(testCase, data.candidates);
  const result = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.equal(result.outcome, LEXICAL_DECISION_OUTCOME.SUFFICIENT);
  assert.equal(result.reason, "user-glossary-override");
  assert.equal(result.override, true);
  assert.equal(result.topCandidateId, "user-glossary:persistent");
});

test("ranking is deterministic and does not mutate Gateway candidates", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "ambiguous-alias");
  const lookup = materializeLookup(testCase, data.candidates);
  const before = structuredClone(lookup);
  const first = assessLexicalLookup(lookup, { contextText: testCase.context });
  const second = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.deepEqual(lookup, before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidates.map((candidate) => candidate.id), ["technical:alpha", "technical:beta"]);
});

test("ranking/evaluation has no Provider or network dependency", async () => {
  const rankingSource = await readFile(new URL("../src/background/lexical/ranking.js", import.meta.url), "utf8");
  const evaluatorSource = await readFile(new URL("../scripts/evaluate-lexical-ranking.mjs", import.meta.url), "utf8");
  for (const source of [rankingSource, evaluatorSource]) {
    assert.doesNotMatch(source, /providers\/|runTranslationRequest|\bfetch\s*\(|https?:\/\//i);
  }
});
