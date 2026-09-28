import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  LEXICAL_DECISION_OUTCOME
} from "../src/shared/lexical.js";
import {
  LEXICAL_RANKING_POLICY_V2,
  assessLexicalLookup,
  rankLexicalCandidates
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
  assert.equal(report.totalCases, 19);
  assert.equal(report.outcomeAccuracy, 1);
  assert.equal(report.topCandidateAccuracy, 1);
  assert.equal(report.coverage, 1);
  assert.equal(report.falsePositiveTopRate, 0);
  assert.deepEqual(report.failures, []);
});

test("generic lexical senses in technical context require structured sense evidence", async () => {
  const data = await fixture();
  const testCase = data.cases.find((item) => item.id === "container-known-technical-gap");
  const lookup = materializeLookup(testCase, data.candidates);
  const result = assessLexicalLookup(lookup, { contextText: testCase.context });

  assert.equal(result.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(result.reason, "technical-context-missing-structured-sense");
  assert.equal(result.topCandidateId, "core:container:general");
  assert.deepEqual(result.sourceGap, {
    kind: "technical-context-missing-structured-sense",
    candidateId: "core:container:general"
  });

  const ordinary = assessLexicalLookup(lookup, {
    contextText: "Store the food in a sealed container."
  });
  assert.equal(ordinary.outcome, LEXICAL_DECISION_OUTCOME.SUFFICIENT);
  assert.equal(ordinary.reason, "single-high-confidence");

  const syntheticLookup = structuredClone(lookup);
  syntheticLookup.query = { ...syntheticLookup.query, text: "widget", normalized: "widget" };
  syntheticLookup.candidates[0] = {
    ...syntheticLookup.candidates[0],
    id: "core:widget:general",
    headword: "widget",
    queryForm: "widget"
  };
  const synthetic = assessLexicalLookup(syntheticLookup, {
    contextText: "The server runtime loads the widget."
  });
  assert.equal(synthetic.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(synthetic.reason, "technical-context-missing-structured-sense");

  const adjectiveLookup = structuredClone(lookup);
  adjectiveLookup.query = { ...adjectiveLookup.query, text: "descendant", normalized: "descendant" };
  adjectiveLookup.candidates[0] = {
    ...adjectiveLookup.candidates[0],
    id: "core:descendant:general",
    headword: "descendant",
    queryForm: "descendant",
    partOfSpeech: "adjective"
  };
  const adjective = assessLexicalLookup(adjectiveLookup, {
    contextText: "Use a descendant combinator in the stylesheet."
  });
  assert.equal(adjective.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(adjective.reason, "technical-context-missing-structured-sense");

  const derivedMarker = assessLexicalLookup(lookup, {
    contextText: "Build the container image before deployment."
  });
  assert.equal(derivedMarker.outcome, LEXICAL_DECISION_OUTCOME.AMBIGUOUS);
  assert.equal(derivedMarker.reason, "technical-context-missing-structured-sense");
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
  assert.ok(result.scoreGap >= LEXICAL_RANKING_POLICY_V2.thresholds.decisiveGap);
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

test("WordNet sense metadata stays a weak prior below match and structured context evidence", () => {
  const common = {
    kind: "lexical",
    headword: "issue",
    aliases: [],
    exactCaseMatch: true,
    translations: ["议题"],
    domains: [],
    provenance: { packId: "core", packVersion: "1", fingerprint: "sha256:core" }
  };
  const exact = { ...common, id: "core:exact", matchedBy: "exact" };
  const normalizedWithPrior = {
    ...common,
    id: "core:normalized-prior",
    matchedBy: "normalized",
    senseNumber: 1,
    tagCount: 999
  };
  const matchRanked = rankLexicalCandidates([normalizedWithPrior, exact], {
    queryText: "issue"
  });
  assert.equal(matchRanked[0].id, exact.id);

  const coreWithPrior = {
    ...common,
    id: "core:prior",
    matchedBy: "exact",
    senseNumber: 1,
    tagCount: 999
  };
  const technical = {
    ...common,
    id: "technical:issue",
    kind: "technical-concept",
    matchedBy: "exact",
    domains: ["repository"],
    typeLabels: ["issue tracker concept"]
  };
  const contextRanked = rankLexicalCandidates([coreWithPrior, technical], {
    queryText: "issue",
    contextText: "Open an issue in the repository."
  });
  assert.equal(contextRanked[0].id, technical.id);
  assert.ok(contextRanked[0].ranking.signals.some((item) => item.name === "technical-context"));
  const priorPoints = coreWithPrior.senseNumber
    ? contextRanked[1].ranking.signals
      .filter((item) => item.name.startsWith("pwn-"))
      .reduce((sum, item) => sum + item.points, 0)
    : 0;
  assert.ok(priorPoints <= 3);
});

test("technical ranking requires candidate-specific evidence and preserves ordinary controls", () => {
  const core = {
    id: "core:process",
    kind: "lexical",
    headword: "process",
    matchedBy: "exact",
    exactCaseMatch: true,
    partOfSpeech: "noun",
    senseNumber: 1,
    tagCount: 63,
    translations: ["过程"],
    domains: [],
    aliases: []
  };
  const technical = {
    id: "technical:process",
    kind: "technical-concept",
    headword: "process",
    matchedBy: "exact",
    exactCaseMatch: true,
    translations: ["进程"],
    domains: ["linux", "runtime"],
    typeLabels: ["operating system process"],
    aliases: []
  };

  const ordinary = rankLexicalCandidates([technical, core], {
    queryText: "process",
    contextText: "The application process takes several weeks."
  });
  assert.equal(ordinary[0].id, core.id);
  assert.equal(ordinary[1].ranking.signals.some((item) => item.name === "technical-context"), false);

  const technicalContext = rankLexicalCandidates([core, technical], {
    queryText: "process",
    contextText: "The Linux process is still running."
  });
  assert.equal(technicalContext[0].id, technical.id);
  assert.ok(technicalContext[0].ranking.signals.some((item) => item.name === "technical-context"));
});

test("ranking/evaluation has no Provider or network dependency", async () => {
  const rankingSource = await readFile(new URL("../src/background/lexical/ranking.js", import.meta.url), "utf8");
  const evaluatorSource = await readFile(new URL("../scripts/evaluate-lexical-ranking.mjs", import.meta.url), "utf8");
  for (const source of [rankingSource, evaluatorSource]) {
    assert.doesNotMatch(source, /providers\/|runTranslationRequest|\bfetch\s*\(|https?:\/\//i);
  }
});
