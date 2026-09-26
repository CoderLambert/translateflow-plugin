import { normalizeLexicalExactKey } from "./lexical.js";

export const SELECTION_EXPLANATION_DEPTH = Object.freeze({
  AUTO: "auto",
  CONCISE: "concise",
  STANDARD: "standard",
  PROFESSIONAL: "professional"
});

export const SELECTION_INTENT = Object.freeze({
  LEXICAL: "lexical",
  TRANSLATION: "translation"
});

export const SELECTION_ROUTE = Object.freeze({
  LOCAL: "local",
  TRANSLATION: "translation",
  NEEDS_EXPLANATION: "needs-explanation",
  UNRESOLVED: "unresolved"
});

const DEPTH_VALUES = new Set(Object.values(SELECTION_EXPLANATION_DEPTH));

export function normalizeSelectionDepth(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return DEPTH_VALUES.has(normalized) ? normalized : SELECTION_EXPLANATION_DEPTH.AUTO;
}

export function classifySelectionIntent({
  text,
  targetLanguage = "Simplified Chinese"
} = {}) {
  const normalized = normalizeLexicalExactKey(text);
  const tokenCount = countWordLikeTokens(normalized);
  const localTargetSupported = isSimplifiedChineseTarget(targetLanguage);
  const englishDominant = isEnglishDominantSelection(normalized);
  const sentenceLike = isSentenceLikeSelection(normalized, tokenCount);

  if (!normalized) {
    return {
      kind: SELECTION_INTENT.TRANSLATION,
      reason: "empty",
      localLexiconEligible: false,
      sourceLanguage: "unknown",
      targetLanguage,
      tokenCount
    };
  }

  if (!localTargetSupported || !englishDominant) {
    return {
      kind: SELECTION_INTENT.TRANSLATION,
      reason: !localTargetSupported ? "unsupported-local-target" : "unsupported-local-source",
      localLexiconEligible: false,
      sourceLanguage: englishDominant ? "en" : "unknown",
      targetLanguage,
      tokenCount
    };
  }

  if (sentenceLike) {
    return {
      kind: SELECTION_INTENT.TRANSLATION,
      reason: "sentence-or-long-text",
      localLexiconEligible: false,
      sourceLanguage: "en",
      targetLanguage,
      tokenCount
    };
  }

  return {
    kind: SELECTION_INTENT.LEXICAL,
    reason: tokenCount > 1 ? "lexical-phrase" : "lexical-token",
    localLexiconEligible: true,
    sourceLanguage: "en",
    targetLanguage,
    tokenCount
  };
}

export function resolveSelectionDepth(requestedDepth, { intent, decision } = {}) {
  const requested = normalizeSelectionDepth(requestedDepth);
  if (requested !== SELECTION_EXPLANATION_DEPTH.AUTO) return requested;

  if (intent?.kind === SELECTION_INTENT.TRANSLATION) {
    return SELECTION_EXPLANATION_DEPTH.CONCISE;
  }
  if (decision?.outcome === "sufficient") {
    return SELECTION_EXPLANATION_DEPTH.CONCISE;
  }
  return SELECTION_EXPLANATION_DEPTH.STANDARD;
}

export function chooseSelectionRoute({ intent, decision, depth, text } = {}) {
  if (!intent || intent.kind === SELECTION_INTENT.TRANSLATION) {
    return {
      route: SELECTION_ROUTE.TRANSLATION,
      reason: intent?.reason || "translation-intent",
      depth: resolveSelectionDepth(depth, { intent, decision }),
      explanationAllowed: false
    };
  }

  const effectiveDepth = resolveSelectionDepth(depth, { intent, decision });
  if (decision?.outcome === "sufficient") {
    return {
      route: SELECTION_ROUTE.LOCAL,
      reason: "local-sufficient",
      depth: effectiveDepth,
      explanationAllowed: false
    };
  }

  if (decision?.outcome === "unsupported") {
    return {
      route: SELECTION_ROUTE.TRANSLATION,
      reason: "local-unsupported",
      depth: effectiveDepth,
      explanationAllowed: false
    };
  }

  if (decision?.outcome === "no-hit" && isMultiWord(text)) {
    return {
      route: SELECTION_ROUTE.TRANSLATION,
      reason: "unknown-phrase-translation",
      depth: effectiveDepth,
      explanationAllowed: false
    };
  }

  if (decision?.outcome === "ambiguous" || decision?.outcome === "no-hit") {
    const explanationAllowed = effectiveDepth !== SELECTION_EXPLANATION_DEPTH.CONCISE;
    return {
      route: explanationAllowed ? SELECTION_ROUTE.NEEDS_EXPLANATION : SELECTION_ROUTE.UNRESOLVED,
      reason: decision.outcome === "ambiguous"
        ? (explanationAllowed ? "ambiguous-needs-explanation" : "ambiguous-concise")
        : (explanationAllowed ? "no-hit-needs-explanation" : "no-hit-concise"),
      depth: effectiveDepth,
      explanationAllowed
    };
  }

  return {
    route: SELECTION_ROUTE.UNRESOLVED,
    reason: decision?.outcome === "error" ? "local-error" : "unresolved",
    depth: effectiveDepth,
    explanationAllowed: false
  };
}

export function sanitizeSelectionContext(input, { maxChars = 900 } = {}) {
  const sensitive = Boolean(input?.sensitive);
  const raw = sensitive ? "" : normalizeLexicalExactKey(input?.text || "");
  const bounded = raw.slice(0, maxChars);
  return {
    text: bounded,
    sensitive,
    source: sensitive ? "selection-only" : (input?.source === "visible-local" ? "visible-local" : "none"),
    truncated: Boolean(input?.truncated) || raw.length > bounded.length
  };
}

export function isSimplifiedChineseTarget(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return [
    "simplified-chinese",
    "zh-cn",
    "zh-hans",
    "简体中文",
    "简体-中文"
  ].includes(normalized);
}

export function isEnglishDominantSelection(value) {
  const text = String(value || "");
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const letters = latin + cjk;
  return latin >= 2 && letters >= 2 && latin / letters >= 0.6;
}

function isSentenceLikeSelection(text, tokenCount) {
  if (text.length > 120) return true;
  if (tokenCount >= 7) return true;
  if (tokenCount >= 4 && /[.!?。！？](?:["')\]}”’]*)$/u.test(text)) return true;
  if (tokenCount >= 4 && /[,:;]\s/u.test(text)) return true;
  return false;
}

function countWordLikeTokens(text) {
  return (String(text || "").match(/[\p{L}\p{N}+#.'-]+/gu) || []).length;
}

function isMultiWord(text) {
  return countWordLikeTokens(text) > 1;
}
