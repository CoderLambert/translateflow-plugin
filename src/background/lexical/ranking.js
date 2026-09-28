import {
  LEXICAL_DECISION_OUTCOME,
  LEXICAL_RESULT_STATUS,
  normalizeLexicalKey
} from "../../shared/lexical.js";

const MATCH_SCORES = Object.freeze({
  "user-glossary": 1000,
  exact: 72,
  normalized: 68,
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
  "runtime", "server", "session", "terminal", "tmux",
  "css", "combinator", "selector", "selectors", "specificity", "nested", "stylesheet",
  "linux"
]);

const LEXICAL_TOKEN_RE = /[\p{L}\p{M}\p{N}+#]+(?:[.'’‘ʼʻ-][\p{L}\p{M}\p{N}+#]+)*/gu;

export const LEXICAL_RANKING_POLICY_V2 = Object.freeze({
  version: 2,
  scores: Object.freeze({
    exactCase: 5,
    targetTranslation: 3,
    technicalContext: 14,
    contextEvidencePerToken: 5,
    maxContextEvidence: 15,
    // WordNet ordering is a corpus prior, not context evidence. Keep the
    // combined sense-number/tag-count contribution below the four-point gap
    // between adjacent exact/normalized/alias match classes.
    senseRankMax: 2,
    senseRankStep: 1,
    senseTagMax: 1
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

  if (hasUnresolvedTechnicalSense(lookupResult, ranked, { queryText, contextText })) {
    return decision(
      LEXICAL_DECISION_OUTCOME.AMBIGUOUS,
      "technical-context-missing-structured-sense",
      lookupResult,
      ranked,
      second ? top.ranking.score - second.ranking.score : null,
      {
        sourceGap: {
          kind: "technical-context-missing-structured-sense",
          candidateId: top.id || null
        }
      }
    );
  }

  if (!second) {
    const highEnough =
      top.ranking.score >= LEXICAL_RANKING_POLICY_V2.thresholds.singleCandidate &&
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
    top.ranking.score >= LEXICAL_RANKING_POLICY_V2.thresholds.multiCandidateTop &&
    gap >= LEXICAL_RANKING_POLICY_V2.thresholds.decisiveGap;

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
  const technicalMarkerCount = contextTokens.filter(isTechnicalContextToken).length;

  return candidates
    .map((candidate, index) => {
      const ranking = scoreCandidate(candidate, {
        technicalMarkerCount,
        contextTokenSet
      });
      return {
        ...candidate,
        ranking: {
          ...ranking,
          policyVersion: LEXICAL_RANKING_POLICY_V2.version
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

function hasTechnicalContext(queryText, contextText) {
  const queryTokens = new Set(tokenize(queryText));
  return tokenize(contextText)
    .filter((token) => !queryTokens.has(token))
    .some(isTechnicalContextToken);
}

function isTechnicalContextToken(token) {
  if (TECH_CONTEXT_MARKERS.has(token)) return true;
  if (token.endsWith("ies") && TECH_CONTEXT_MARKERS.has(token.slice(0, -3) + "y")) return true;

  for (const suffix of ["s", "es", "ed", "ing", "ment", "ments"]) {
    if (!token.endsWith(suffix) || token.length <= suffix.length + 3) continue;
    if (TECH_CONTEXT_MARKERS.has(token.slice(0, -suffix.length))) return true;
  }
  return false;
}

function hasUnresolvedTechnicalSense(lookupResult, ranked, { queryText, contextText }) {
  if (ranked.length !== 1 || tokenize(queryText).length !== 1) return false;

  const candidate = ranked[0];
  const matchedBy = candidate?.matchedBy || lookupResult?.matchedBy;
  if (
    candidate?.kind !== "lexical" ||
    !["exact", "normalized", "lemma", "morphology"].includes(matchedBy)
  ) {
    return false;
  }
  if (!hasTechnicalContext(queryText, contextText)) return false;

  const hasStructuredSenseMetadata =
    (Array.isArray(candidate.domains) && candidate.domains.length > 0) ||
    (Array.isArray(candidate.typeLabels) && candidate.typeLabels.length > 0);
  return !hasStructuredSenseMetadata;
}

function isTechnicalCandidate(candidate) {
  return candidate?.kind === "technical-concept" || candidate?.kind === "technical-entity";
}

function scoreCandidate(candidate, { technicalMarkerCount, contextTokenSet }) {
  const matchedBy = candidate?.matchedBy || "exact";
  let score = MATCH_SCORES[matchedBy] ?? 0;
  const signals = [];

  signals.push(signal("match:" + matchedBy, MATCH_SCORES[matchedBy] ?? 0));

  if (candidate?.exactCaseMatch) {
    score += LEXICAL_RANKING_POLICY_V2.scores.exactCase;
    signals.push(signal("exact-case", LEXICAL_RANKING_POLICY_V2.scores.exactCase));
  }

  if (Array.isArray(candidate?.translations) && candidate.translations.length) {
    score += LEXICAL_RANKING_POLICY_V2.scores.targetTranslation;
    signals.push(signal("target-translation", LEXICAL_RANKING_POLICY_V2.scores.targetTranslation));
  }

  const sensePrior = scoreSensePrior(candidate);
  if (sensePrior.points) {
    score += sensePrior.points;
    signals.push(...sensePrior.signals);
  }

  const evidenceTokens = candidateEvidenceTokens(candidate);
  let overlap = 0;
  for (const token of evidenceTokens) {
    if (contextTokenSet.has(token)) overlap += 1;
  }
  // A generic page word such as "application" is not enough to promote every
  // Technical candidate. Require the candidate's own structured metadata to
  // corroborate the surrounding technical marker.
  if (isTechnicalCandidate(candidate) && technicalMarkerCount > 0 && overlap > 0) {
    score += LEXICAL_RANKING_POLICY_V2.scores.technicalContext;
    signals.push(signal("technical-context", LEXICAL_RANKING_POLICY_V2.scores.technicalContext));
  }
  if (overlap) {
    const points = Math.min(
      overlap * LEXICAL_RANKING_POLICY_V2.scores.contextEvidencePerToken,
      LEXICAL_RANKING_POLICY_V2.scores.maxContextEvidence
    );
    score += points;
    signals.push(signal("context-evidence:" + overlap, points));
  }

  return { score, signals };
}

function scoreSensePrior(candidate) {
  const signals = [];
  let points = 0;

  if (Number.isSafeInteger(candidate?.senseNumber) && candidate.senseNumber > 0) {
    const rankPoints = Math.max(
      0,
      LEXICAL_RANKING_POLICY_V2.scores.senseRankMax -
        (candidate.senseNumber - 1) * LEXICAL_RANKING_POLICY_V2.scores.senseRankStep
    );
    if (rankPoints) {
      points += rankPoints;
      signals.push(signal("pwn-sense-number:" + candidate.senseNumber, rankPoints));
    }
  }

  if (Number.isSafeInteger(candidate?.tagCount) && candidate.tagCount > 0) {
    const tagPoints = Math.min(
      Math.floor(Math.log2(candidate.tagCount + 1)) * 2,
      LEXICAL_RANKING_POLICY_V2.scores.senseTagMax
    );
    if (tagPoints) {
      points += tagPoints;
      signals.push(signal("pwn-tag-count:" + candidate.tagCount, tagPoints));
    }
  }

  return { points, signals };
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
  return normalizeLexicalKey(value).match(LEXICAL_TOKEN_RE) || [];
}

function signal(name, points) {
  return { name, points };
}

function decision(outcome, reason, lookupResult, candidates, scoreGap = null, details = {}) {
  return {
    outcome,
    reason,
    query: lookupResult.query || null,
    matchedBy: lookupResult.matchedBy || null,
    override: lookupResult.override === true,
    topCandidateId: candidates[0]?.id || null,
    scoreGap,
    candidates,
    ...details
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
