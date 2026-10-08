export const VOCABULARY_BOOK_VERSION = 1;
export const VOCABULARY_BOOK_LIMITS = Object.freeze({
  entries: 200,
  totalBytes: 4 * 1024 * 1024,
  entryBytes: 16 * 1024,
  textChars: 1200,
  headwordChars: 180,
  languageChars: 80,
  pronunciationChars: 240,
  partOfSpeechChars: 80,
  definitions: 4,
  examples: 2,
  sources: 4,
  sourceIdChars: 120,
  packIdChars: 120,
  packVersionChars: 120,
  sourceEntryIdChars: 180
});

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_MS = 15 * 60 * 1000;
const KNOWN_INTERVALS_DAYS = Object.freeze([1, 3, 7, 14]);
const ENTRY_FIELDS = Object.freeze([
  "id", "headword", "sourceLanguage", "targetLanguage", "pronunciation", "partOfSpeech", "definitions", "examples",
  "sources", "savedAt", "reviewCount", "knownStreak", "lastReviewedAt", "nextReviewAt"
]);
const DRAFT_FIELDS = Object.freeze([
  "headword", "sourceLanguage", "targetLanguage", "pronunciation", "partOfSpeech", "definitions", "examples", "sources"
]);
const SOURCE_FIELDS = Object.freeze(["sourceId", "packId", "packVersion", "sourceEntryId"]);

export class VocabularyBookError extends Error {
  constructor(code) { super(code); this.name = "VocabularyBookError"; this.code = code; }
}

function fail(code) { throw new VocabularyBookError(code); }
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactFields(value, fields) {
  if (!plainObject(value) || Object.keys(value).some((key) => !fields.includes(key))) fail("VOCABULARY_BAD_DATA");
}
function boundedText(value, max, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c]/u.test(value)) {
    fail("VOCABULARY_BAD_DATA");
  }
  return value.trim();
}
function textList(value, limit, max, { empty = false } = {}) {
  if (!Array.isArray(value) || value.length > limit) fail("VOCABULARY_BAD_DATA");
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = boundedText(item, max, { empty });
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
function sourcesList(value) {
  if (!Array.isArray(value) || !value.length || value.length > VOCABULARY_BOOK_LIMITS.sources) fail("VOCABULARY_BAD_DATA");
  const result = [], seen = new Set();
  for (const source of value) {
    exactFields(source, SOURCE_FIELDS);
    const item = {
      sourceId: boundedText(source.sourceId, VOCABULARY_BOOK_LIMITS.sourceIdChars),
      packId: boundedText(source.packId, VOCABULARY_BOOK_LIMITS.packIdChars),
      packVersion: boundedText(source.packVersion, VOCABULARY_BOOK_LIMITS.packVersionChars),
      sourceEntryId: boundedText(source.sourceEntryId, VOCABULARY_BOOK_LIMITS.sourceEntryIdChars)
    };
    const key = JSON.stringify(item);
    if (!seen.has(key)) { seen.add(key); result.push(item); }
  }
  if (!result.length) fail("VOCABULARY_BAD_DATA");
  return result;
}
function boundedNumber(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("VOCABULARY_BAD_DATA");
  return value;
}
function byteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

export function normalizeVocabularyHeadword(value) {
  return boundedText(value, VOCABULARY_BOOK_LIMITS.headwordChars)
    .normalize("NFKC").replace(/[\t\n\r\f ]+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export function vocabularyIdentity(value) {
  const entry = validateVocabularyDraft(Object.fromEntries(DRAFT_FIELDS.map((key) => [key, value?.[key]])));
  return `${entry.sourceLanguage.toLocaleLowerCase("en-US")}\u0000${entry.targetLanguage.toLocaleLowerCase("en-US")}\u0000${normalizeVocabularyHeadword(entry.headword)}`;
}

export function validateVocabularyDraft(value) {
  exactFields(value, DRAFT_FIELDS);
  const limits = VOCABULARY_BOOK_LIMITS;
  const entry = {
    headword: boundedText(value.headword, limits.headwordChars),
    sourceLanguage: boundedText(value.sourceLanguage, limits.languageChars),
    targetLanguage: boundedText(value.targetLanguage, limits.languageChars),
    pronunciation: boundedText(value.pronunciation, limits.pronunciationChars, { empty: true }),
    partOfSpeech: boundedText(value.partOfSpeech, limits.partOfSpeechChars, { empty: true }),
    definitions: textList(value.definitions, limits.definitions, limits.textChars),
    examples: textList(value.examples, limits.examples, limits.textChars, { empty: true }),
    sources: sourcesList(value.sources)
  };
  if (!entry.definitions.length) fail("VOCABULARY_BAD_DATA");
  if (byteLength(entry) > limits.entryBytes) fail("VOCABULARY_LIMIT");
  return entry;
}

export function validateVocabularyEntry(value) {
  exactFields(value, ENTRY_FIELDS);
  const draft = validateVocabularyDraft({
    headword: value.headword,
    sourceLanguage: value.sourceLanguage,
    targetLanguage: value.targetLanguage,
    pronunciation: value.pronunciation,
    partOfSpeech: value.partOfSpeech,
    definitions: value.definitions,
    examples: value.examples,
    sources: value.sources
  });
  const entry = {
    id: boundedText(value.id, 80),
    ...draft,
    savedAt: boundedNumber(value.savedAt, 0, Number.MAX_SAFE_INTEGER),
    reviewCount: boundedNumber(value.reviewCount, 0, 1_000_000),
    knownStreak: boundedNumber(value.knownStreak, 0, KNOWN_INTERVALS_DAYS.length),
    lastReviewedAt: value.lastReviewedAt === null ? null : boundedNumber(value.lastReviewedAt, 0, Number.MAX_SAFE_INTEGER),
    nextReviewAt: boundedNumber(value.nextReviewAt, 0, Number.MAX_SAFE_INTEGER)
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(entry.id) || byteLength(entry) > VOCABULARY_BOOK_LIMITS.entryBytes) fail("VOCABULARY_BAD_DATA");
  return entry;
}

export function validateVocabularyStore(value) {
  exactFields(value, ["version", "entries"]);
  if (value.version !== VOCABULARY_BOOK_VERSION || !Array.isArray(value.entries) || value.entries.length > VOCABULARY_BOOK_LIMITS.entries) {
    fail("VOCABULARY_BAD_DATA");
  }
  const entries = value.entries.map(validateVocabularyEntry);
  const ids = new Set(), identities = new Set();
  for (const entry of entries) {
    const identity = vocabularyIdentity(entry);
    if (ids.has(entry.id) || identities.has(identity)) fail("VOCABULARY_BAD_DATA");
    ids.add(entry.id); identities.add(identity);
  }
  const store = { version: VOCABULARY_BOOK_VERSION, entries };
  if (byteLength(store) > VOCABULARY_BOOK_LIMITS.totalBytes) fail("VOCABULARY_LIMIT");
  return store;
}

export function mergeVocabularyDraft(existingValue, draftValue) {
  const existing = validateVocabularyEntry(existingValue), draft = validateVocabularyDraft(draftValue);
  if (vocabularyIdentity(existing) !== vocabularyIdentity(draft)) fail("VOCABULARY_BAD_DATA");
  return validateVocabularyEntry({
    ...existing,
    definitions: [...new Set([...existing.definitions, ...draft.definitions])].slice(0, VOCABULARY_BOOK_LIMITS.definitions),
    examples: [...new Set([...existing.examples, ...draft.examples])].slice(0, VOCABULARY_BOOK_LIMITS.examples),
    sources: [...new Map([...existing.sources, ...draft.sources].map((source) => [JSON.stringify(source), source])).values()].slice(0, VOCABULARY_BOOK_LIMITS.sources)
  });
}

export function scheduleVocabularyReview(entryValue, rating, now) {
  const entry = validateVocabularyEntry(entryValue);
  boundedNumber(now, 0, Number.MAX_SAFE_INTEGER);
  if (now < entry.nextReviewAt || !["again", "know"].includes(rating)) fail("VOCABULARY_REVIEW_NOT_DUE");
  const knownStreak = rating === "know" ? Math.min(entry.knownStreak + 1, KNOWN_INTERVALS_DAYS.length) : 0;
  const interval = rating === "know" ? KNOWN_INTERVALS_DAYS[knownStreak - 1] * DAY_MS : AGAIN_MS;
  return validateVocabularyEntry({ ...entry, reviewCount: entry.reviewCount + 1, knownStreak,
    lastReviewedAt: now, nextReviewAt: now + interval });
}

export function isVocabularyDue(entryValue, now = Date.now()) {
  const entry = validateVocabularyEntry(entryValue);
  return Number.isSafeInteger(now) && entry.nextReviewAt <= now;
}
