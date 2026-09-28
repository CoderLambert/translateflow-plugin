
const COPY_ARTIFACT_RE = /[\u00ad\u200b\u2060\ufeff]/gu;
const APOSTROPHE_VARIANT_RE = /[\u2018\u2019\u02bc\u02bb]/gu;
const DASH_VARIANT_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d]/gu;
const SAFE_LEXICAL_ATOM = "[\\p{L}\\p{M}\\p{N}+#]+(?:[.'-][\\p{L}\\p{M}\\p{N}+#]+)*";
const SAFE_LEXICAL_LOOKUP_RE = new RegExp(`^${SAFE_LEXICAL_ATOM}(?:\\s+${SAFE_LEXICAL_ATOM}){0,3}
const COPY_ARTIFACT_RE = /[\u00ad\u200b\u2060\ufeff]/gu;
const APOSTROPHE_VARIANT_RE = /[\u2018\u2019\u02bc\u02bb]/gu;
const DASH_VARIANT_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d]/gu;
const SAFE_LEXICAL_ATOM = "[\\p{L}\\p{M}\\p{N}+#]+(?:[.'-][\\p{L}\\p{M}\\p{N}+#]+)*";
, "u");
const POSSESSIVE_RE = /^([\p{L}\p{M}][\p{L}\p{M}\p{N}-]*)(?:'s|')$/iu;

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

export const LEXICAL_DECISION_OUTCOME = Object.freeze({
  SUFFICIENT: "sufficient",
  AMBIGUOUS: "ambiguous",
  NO_HIT: "no-hit",
  UNSUPPORTED: "unsupported",
  ERROR: "error"
});

export function normalizeLexicalExactKey(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeLexicalKey(value) {
  return normalizeLexicalExactKey(value).toLowerCase();
}

export function normalizeLexicalLookupForm(value) {
  const original = normalizeLexicalExactKey(value);
  if (!original) return "";

  let candidate = original
    .replace(COPY_ARTIFACT_RE, "")
    .replace(APOSTROPHE_VARIANT_RE, "'")
    .replace(DASH_VARIANT_RE, "-");
  candidate = normalizeLexicalExactKey(candidate);
  candidate = stripWrappingQuotes(candidate);

  const withoutTrailing = candidate.replace(/[.,:;!?)}\]]+$/u, "").trim();
  if (withoutTrailing) candidate = withoutTrailing;

  const possessive = candidate.match(POSSESSIVE_RE);
  if (possessive) candidate = possessive[1];

  candidate = normalizeLexicalExactKey(candidate);
  return SAFE_LEXICAL_LOOKUP_RE.test(candidate) ? candidate : original;
}

export function isSafeLexicalLookupForm(value) {
  return SAFE_LEXICAL_LOOKUP_RE.test(normalizeLexicalExactKey(value));
}

function stripWrappingQuotes(value) {
  if (value.length < 3) return value;
  const first = value[0];
  const last = value.at(-1);
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "“" && last === "”")
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

export function isLexicalPhrase(value) {
  return normalizeLexicalExactKey(value).includes(" ");
}
