import {
  LEXICAL_DECISION_OUTCOME,
  LEXICAL_RESULT_STATUS,
  normalizeLexicalKey
} from "../../shared/lexical.js";

const MATCH_SCORES = Object.freeze({
  "user-glossary": 1000,
  exact: 72,
  alias: 64,
  lemma: 56,
  morphology: 50,
  "token-evidence": 20
});

const TECH_CONTEXT_MARKERS = new Set([
  "api", "application", "browser", "cache", "cli", "cluster", "code", "command",
  "component", "container", "database", "dependency", "deploy", "docker", "framework",
  "git", "github", "javascript", "kubernetes", "library", "package", "process",
  "protocol", "redis", "render", "renders", "repository", "request", "response",
  "runtime", "server", "session", "terminal", "tmux"
]);

export const LEXICAL_RANKING_POLICY_V1 = Object.freeze({
  version: 1,
  scores: Object.freeze({
    exactCase: 5,
    targetTranslation: 3,
    technicalContext: 14,
    contextEvidencePerToken: 5,
    maxContextEvidence: 15
  }),
  thresholds: Object.freeze({
    singleCandidate: 55,
    multiCandidateTop: 80,
    decisiveGap: 18
  })
});

export function assessLexicalLookup(lookupResult, { contextText = "" } = {}) {
  if (!lookupResult || typeof lookupResult !== "object") {
    throw new Error("lookupResult must be an object");
  }

  if (lookupResult.status === LEXICAL_RESULT_STATUS.UNSUPPORTED) {
    return passthrough(LEXICAL_DECISION_OUTCOME.UNSUPPORTED, lookupResult);
  }
  if (lookupResult.status === LEXICAL_RESULT_STATUS.ERROR) {
    return passthrough(LEXICAL_DECISION_OUTCOME.ERROR, lookupResult);
  }
  if (lookupResult.status === LEXICAL_RESULT_STATUS.NO_HIT) {
    return {
      outcome: LEXICAL_DECISION_OUTCOME.NO_HIT,
      reason: "no-local-candidates",
      query: lookupResult.query || null,
      candidates: [],
      evidence: Array.isArray(lookupResult.evidence) ? lookupResult.evidence : []
    };
  }
  if (lookupResult.status !== LEXICAL_RESULT_STATUS.CANDIDATES) {
    throw new Error("unsupported lexical lookup status: " + String(lookupResult.status));
  }

  const candidates = Array.isArray(lookupResult.candidates) ? lookupResult.candidates : [];
  if (!candidates.length) {
    return {
      outcome: LEXICAL_DECISION_OUTCOME.NO_HIT,
      reason: "empty-candidate-set",
      query: lookupResult.query || null,
      candidates: []
    };
  }

  const queryText = lookupResult.query?.text || lookupResult.query?.normalized || "";
  const ranked = rankLexicalCandidates(candidates, { queryText, contextText });

  if (lookupResult.override === true || ranked[0]?.matchedBy === "user-glossary") {
    return decision(LEXICAL_DECISION_OUTCOME.SUFFICIENT, "user-glossary-override", lookupResult, ranked);
  }

  const top = ranked[0];
  const second = ranked[1] || null;
  if (!second) {
    const highEnough =
      top.ranking.score >= LEXICAL_RANKING_POLICY_V1.thresholds.singleCandidate &&
      top.matchedBy !== "token-evidence";
    return decision(
      highEnough ? LEXICAL_DECISION_OUTCOME.SUFFICIENT : LEXICAL_DECISION_OUTCOME.AMBIGUOUS,
      highEnough ? "single-high-confidence" : "single-low-confidence",
      lookupResult,
      ranked
    );
  }

  const gap = top.ranking.score - second.ranking.score;
  const decisive =
    top.ranking.score >= LEXICAL_RANKING_POLICY_V1.thresholds.multiCandidateTop &&
    gap >= LEXICAL_RANKING_POLICY_V1.thresholds.decisiveGap;

  return decision(
    decisive ? LEXICAL_DECISION_OUTCOME.SUFFICIENT : LEXICAL_DECISION_OUTCOME.AMBIGUOUS,
    decisive ? "decisive-top-candidate" : "candidate-gap-too-small",
    lookupResult,
    ranked,
    gap
  );
}

export function rankLexicalCandidates(candidates, { queryText = "", contextText = "" } = {}) {
  if (!Array.isArray(candidates)) throw new Error("candidates must be an array");
  const queryTokens = new Set(tokenize(queryText));
  const contextTokens = tokenize(contextText).filter((token) => !queryTokens.has(token));
  const contextTokenSet = new Set(contextTokens);
  const technicalContext = contextTokens.some((token) => TECH_CONTEXT_MARKERS.has(token));

  return candidates
    .map((candidate, index) => {
      const ranking = scoreCandidate(candidate, {
        technicalContext,
        contextTokenSet
      });
      return {
        ...candidate,
        ranking: {
          ...ranking,
          policyVersion: LEXICAL_RANKING_POLICY_V1.version
        },
        _stableIndex: index
      };
    })
    .sort((a, b) =>
      b.ranking.score - a.ranking.score ||
      compareText(a.id || "", b.id || "") ||
      a._stableIndex - b._stableIndex
    )
    .map(({ _stableIndex: _ignored, ...candidate }) => candidate);
}

function scoreCandidate(candidate, { technicalContext, contextTokenSet }) {
  const matchedBy = candidate?.matchedBy || "exact";
  let score = MATCH_SCORES[matchedBy] ?? 0;
  const signals = [];

  signals.push(signal("match:" + matchedBy, MATCH_SCORES[matchedBy] ?? 0));

  if (candidate?.exactCaseMatch) {
    score += LEXICAL_RANKING_POLICY_V1.scores.exactCase;
    signals.push(signal("exact-case", LEXICAL_RANKING_POLICY_V1.scores.exactCase));
  }

  if (Array.isArray(candidate?.translations) && candidate.translations.length) {
    score += LEXICAL_RANKING_POLICY_V1.scores.targetTranslation;
    signals.push(signal("target-translation", LEXICAL_RANKING_POLICY_V1.scores.targetTranslation));
  }

  const isTechnical = candidate?.kind === "technical-concept" || candidate?.kind === "technical-entity";
  if (isTechnical && technicalContext) {
    score += LEXICAL_RANKING_POLICY_V1.scores.technicalContext;
    signals.push(signal("technical-context", LEXICAL_RANKING_POLICY_V1.scores.technicalContext));
  }

  const evidenceTokens = candidateEvidenceTokens(candidate);
  let overlap = 0;
  for (const token of evidenceTokens) {
    if (contextTokenSet.has(token)) overlap += 1;
  }
  if (overlap) {
    const points = Math.min(
      overlap * LEXICAL_RANKING_POLICY_V1.scores.contextEvidencePerToken,
      LEXICAL_RANKING_POLICY_V1.scores.maxContextEvidence
    );
    score += points;
    signals.push(signal("context-evidence:" + overlap, points));
  }

  return { score, signals };
}

function candidateEvidenceTokens(candidate) {
  const values = [
    ...(Array.isArray(candidate?.domains) ? candidate.domains : []),
    ...(Array.isArray(candidate?.typeLabels) ? candidate.typeLabels : []),
    ...(Array.isArray(candidate?.aliases) ? candidate.aliases : [])
  ];
  return new Set(values.flatMap(tokenize));
}

function tokenize(value) {
  return normalizeLexicalKey(value)
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function signal(name, points) {
  return { name, points };
}

function decision(outcome, reason, lookupResult, candidates, scoreGap = null) {
  return {
    outcome,
    reason,
    query: lookupResult.query || null,
    matchedBy: lookupResult.matchedBy || null,
    override: lookupResult.override === true,
    topCandidateId: candidates[0]?.id || null,
    scoreGap,
    candidates
  };
}

function passthrough(outcome, lookupResult) {
  return {
    outcome,
    reason: outcome,
    query: lookupResult.query || null,
    candidates: [],
    error: lookupResult.error || null,
    supported: lookupResult.supported || null
  };
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
