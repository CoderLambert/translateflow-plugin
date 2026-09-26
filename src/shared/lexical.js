export const LEXICAL_RESULT_STATUS = Object.freeze({
  UNSUPPORTED: "unsupported",
  NO_HIT: "no-hit",
  CANDIDATES: "candidates",
  ERROR: "error"
});

export const LEXICAL_ERROR_CODES = Object.freeze({
  STORAGE: "LEXICON_STORAGE",
  CORRUPT: "LEXICON_CORRUPT",
  INCOMPATIBLE: "LEXICON_INCOMPATIBLE"
});

export function normalizeLexicalExactKey(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeLexicalKey(value) {
  return normalizeLexicalExactKey(value).toLowerCase();
}

export function isLexicalPhrase(value) {
  return normalizeLexicalExactKey(value).includes(" ");
}
