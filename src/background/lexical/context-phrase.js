import {
  LEXICAL_RESULT_STATUS,
  normalizeLexicalKey,
  normalizeLexicalLookupForm
} from "../../shared/lexical.js";

const CONTEXT_TOKEN_RE = /[\p{L}\p{M}\p{N}+#]+(?:[.'’‘ʼʻ\-‐‑‒–—―−﹘﹣－][\p{L}\p{M}\p{N}+#]+)*/gu;

export function extractContextPhraseCandidates({
  selectionText,
  contextText,
  minTokens = 2,
  maxTokens = 4,
  maxCandidates = 9
} = {}) {
  assertPositiveInteger(minTokens, "minTokens");
  assertPositiveInteger(maxTokens, "maxTokens");
  assertPositiveInteger(maxCandidates, "maxCandidates");
  if (minTokens < 2 || maxTokens < minTokens || maxTokens > 4) {
    throw new Error("context phrase token bounds must stay within 2..4");
  }

  const selected = normalizeLexicalLookupForm(selectionText);
  if (!selected || selected.includes(" ")) return [];
  const selectedKey = normalizeLexicalKey(selected);
  const tokens = tokenizeContext(contextText);
  if (tokens.length < minTokens) return [];

  const selectedIndexes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].key === selectedKey) selectedIndexes.push(index);
  }

  // Without a DOM range offset in the background request, repeated occurrences
  // are ambiguous. Prefer an honest word lookup over guessing the wrong phrase.
  if (selectedIndexes.length !== 1) return [];

  const selectedIndex = selectedIndexes[0];
  const candidates = [];
  const seen = new Set();

  for (let tokenCount = minTokens; tokenCount <= maxTokens; tokenCount += 1) {
    const firstStart = Math.min(selectedIndex, tokens.length - tokenCount);
    const lastStart = Math.max(0, selectedIndex - tokenCount + 1);

    // Prefer windows that begin at the selection, then progressively include
    // more left context. Shorter phrases are attempted before longer phrases.
    for (let start = firstStart; start >= lastStart; start -= 1) {
      const end = start + tokenCount;
      if (start < 0 || end > tokens.length || selectedIndex < start || selectedIndex >= end) continue;

      const rawText = tokens.slice(start, end).map((token) => token.surface).join(" ");
      const text = normalizeLexicalLookupForm(rawText);
      const normalized = normalizeLexicalKey(text);
      if (!text || !normalized || normalized === selectedKey || seen.has(normalized)) continue;
      seen.add(normalized);

      candidates.push({
        text,
        normalized,
        tokenCount,
        spanStart: tokens[start].start,
        spanEnd: tokens[end - 1].end,
        selectionTokenOffset: selectedIndex - start,
        provenance: "bounded-contiguous-context"
      });
      if (candidates.length >= maxCandidates) return candidates;
    }
  }

  return candidates;
}


export async function resolveContextPhraseMatch({
  selectionText,
  contextText,
  glossary = [],
  findGlossaryOverride,
  lookupPhrase
} = {}) {
  if (typeof findGlossaryOverride !== "function") {
    throw new Error("findGlossaryOverride is required");
  }
  if (typeof lookupPhrase !== "function") {
    throw new Error("lookupPhrase is required");
  }

  const phrases = extractContextPhraseCandidates({ selectionText, contextText });
  for (const phrase of phrases) {
    const glossaryOverride = findGlossaryOverride(phrase.text, glossary);
    if (glossaryOverride) {
      return {
        phrase,
        phraseMatchedBy: "user-glossary",
        override: true,
        glossaryOverride,
        candidates: []
      };
    }

    const candidates = await lookupPhrase(phrase.text);
    if (!Array.isArray(candidates) || !candidates.length) continue;
    return {
      phrase,
      phraseMatchedBy: candidates.every((candidate) => candidate.matchedBy === "alias")
        ? "alias"
        : "exact",
      override: false,
      glossaryOverride: null,
      candidates
    };
  }
  return null;
}

export function buildContextPhraseLookupResult({ query, match, candidates } = {}) {
  if (!match?.phrase || !query) throw new Error("context phrase match and query are required");
  return {
    status: LEXICAL_RESULT_STATUS.CANDIDATES,
    query,
    override: match.override === true,
    matchedBy: "context-phrase",
    resolvedForm: match.phrase.text,
    matchedPhrase: match.phrase.text,
    contextPhrase: {
      text: match.phrase.text,
      normalized: match.phrase.normalized,
      tokenCount: match.phrase.tokenCount,
      spanStart: match.phrase.spanStart,
      spanEnd: match.phrase.spanEnd,
      selectionTokenOffset: match.phrase.selectionTokenOffset,
      confidence: "high",
      provenance: match.phrase.provenance,
      matchedBy: match.phraseMatchedBy
    },
    candidates: Array.isArray(candidates) ? candidates : []
  };
}

function tokenizeContext(value) {
  const text = String(value || "");
  const tokens = [];
  CONTEXT_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = CONTEXT_TOKEN_RE.exec(text))) {
    const surface = match[0];
    const normalizedSurface = normalizeLexicalLookupForm(surface);
    const key = normalizeLexicalKey(normalizedSurface);
    if (!key) continue;
    tokens.push({
      surface,
      key,
      start: match.index,
      end: match.index + surface.length
    });
  }
  return tokens;
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive integer");
  }
}
