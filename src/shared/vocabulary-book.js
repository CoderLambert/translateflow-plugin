export const VOCABULARY_BOOK_VERSION = 2;
export const VOCABULARY_BOOK_LIMITS = Object.freeze({
  entries: 200,
  totalBytes: 4 * 1024 * 1024,
  entryBytes: 64 * 1024,
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
  sourceEntryIdChars: 180,
  aiNotes: 3,
  aiNoteChars: 4000,
  aiInputChars: 24000,
  providerChars: 120,
  modelChars: 120,
  promptVersionChars: 120,
  providerFingerprintChars: 180,
  idChars: 120
});

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_MS = 15 * 60 * 1000;
const KNOWN_INTERVALS_DAYS = Object.freeze([1, 3, 7, 14]);
const ENTRY_FIELDS = Object.freeze([
  "id", "headword", "sourceLanguage", "targetLanguage", "pronunciation", "partOfSpeech", "definitions", "examples",
  "sources", "aiNotes", "savedAt", "reviewCount", "knownStreak", "lastReviewedAt", "nextReviewAt"
]);
const LEGACY_ENTRY_FIELDS = Object.freeze(ENTRY_FIELDS.filter((field) => field !== "aiNotes"));
const DRAFT_FIELDS = Object.freeze([
  "headword", "sourceLanguage", "targetLanguage", "pronunciation", "partOfSpeech", "definitions", "examples", "sources"
]);
const AI_NOTE_DRAFT_FIELDS = Object.freeze([
  "headword", "sourceLanguage", "targetLanguage", "action", "text", "turnId", "provenance", "readingRef"
]);
const AI_NOTE_FIELDS = Object.freeze(["action", "text", "truncated", "turnId", "provenance", "readingRef", "savedAt"]);
const PROVENANCE_FIELDS = Object.freeze(["provider", "model", "promptVersion", "providerConfigFingerprint"]);
const READING_REF_FIELDS = Object.freeze(["recordId", "artifactId"]);
const SOURCE_FIELDS = Object.freeze(["sourceId", "packId", "packVersion", "sourceEntryId"]);
const AI_ACTIONS = Object.freeze(["understand", "analyze", "usage"]);

export class VocabularyBookError extends Error {
  constructor(code) { super(code); this.name = "VocabularyBookError"; this.code = code; }
}

function fail(code) { throw new VocabularyBookError(code); }
function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactFields(value, fields) {
  if (!plainObject(value) || Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) {
    fail("VOCABULARY_BAD_DATA");
  }
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
  if (!Array.isArray(value) || value.length > VOCABULARY_BOOK_LIMITS.sources) fail("VOCABULARY_BAD_DATA");
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
  return result;
}
function boundedNumber(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("VOCABULARY_BAD_DATA");
  return value;
}
function byteLength(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function identityFields(value) {
  return {
    headword: boundedText(value?.headword, VOCABULARY_BOOK_LIMITS.headwordChars),
    sourceLanguage: boundedText(value?.sourceLanguage, VOCABULARY_BOOK_LIMITS.languageChars),
    targetLanguage: boundedText(value?.targetLanguage, VOCABULARY_BOOK_LIMITS.languageChars)
  };
}
function lexicalFields(value, { required = false } = {}) {
  const limits = VOCABULARY_BOOK_LIMITS;
  const fields = {
    pronunciation: boundedText(value.pronunciation, limits.pronunciationChars, { empty: true }),
    partOfSpeech: boundedText(value.partOfSpeech, limits.partOfSpeechChars, { empty: true }),
    definitions: textList(value.definitions, limits.definitions, limits.textChars),
    examples: textList(value.examples, limits.examples, limits.textChars, { empty: true }),
    sources: sourcesList(value.sources)
  };
  if (required && (!fields.definitions.length || !fields.sources.length)) fail("VOCABULARY_BAD_DATA");
  if (Boolean(fields.definitions.length) !== Boolean(fields.sources.length)) fail("VOCABULARY_BAD_DATA");
  if (!fields.definitions.length && fields.examples.length) fail("VOCABULARY_BAD_DATA");
  return fields;
}
function provenance(value) {
  exactFields(value, PROVENANCE_FIELDS);
  const limits = VOCABULARY_BOOK_LIMITS;
  return {
    provider: boundedText(value.provider, limits.providerChars),
    model: boundedText(value.model, limits.modelChars),
    promptVersion: boundedText(value.promptVersion, limits.promptVersionChars),
    providerConfigFingerprint: boundedText(value.providerConfigFingerprint, limits.providerFingerprintChars)
  };
}
function readingRef(value) {
  if (value === null) return null;
  exactFields(value, READING_REF_FIELDS);
  return {
    recordId: boundedText(value.recordId, VOCABULARY_BOOK_LIMITS.idChars),
    artifactId: boundedText(value.artifactId, VOCABULARY_BOOK_LIMITS.idChars)
  };
}
function validateVocabularyAiNote(value) {
  exactFields(value, AI_NOTE_FIELDS);
  if (typeof value.truncated !== "boolean") fail("VOCABULARY_BAD_DATA");
  const action = boundedText(value.action, 20);
  if (!AI_ACTIONS.includes(action)) fail("VOCABULARY_BAD_DATA");
  return {
    action,
    text: boundedText(value.text, VOCABULARY_BOOK_LIMITS.aiNoteChars),
    truncated: value.truncated,
    turnId: boundedText(value.turnId, VOCABULARY_BOOK_LIMITS.idChars),
    provenance: provenance(value.provenance),
    readingRef: readingRef(value.readingRef),
    savedAt: boundedNumber(value.savedAt, 0, Number.MAX_SAFE_INTEGER)
  };
}
function aiNotesList(value) {
  if (!Array.isArray(value) || value.length > VOCABULARY_BOOK_LIMITS.aiNotes) fail("VOCABULARY_BAD_DATA");
  const notes = value.map(validateVocabularyAiNote);
  if (new Set(notes.map((note) => note.action)).size !== notes.length) fail("VOCABULARY_BAD_DATA");
  return notes;
}

export function normalizeVocabularyHeadword(value) {
  return boundedText(value, VOCABULARY_BOOK_LIMITS.headwordChars)
    .normalize("NFKC").replace(/[\t\n\r\f ]+/gu, " ").trim().toLocaleLowerCase("en-US");
}

export function vocabularyIdentity(value) {
  const entry = identityFields(value);
  return `${entry.sourceLanguage.toLocaleLowerCase("en-US")}\u0000${entry.targetLanguage.toLocaleLowerCase("en-US")}\u0000${normalizeVocabularyHeadword(entry.headword)}`;
}

export function validateVocabularyDraft(value) {
  exactFields(value, DRAFT_FIELDS);
  const entry = { ...identityFields(value), ...lexicalFields(value, { required: true }) };
  if (byteLength(entry) > VOCABULARY_BOOK_LIMITS.entryBytes) fail("VOCABULARY_LIMIT");
  return entry;
}

export function validateVocabularyAiNoteDraft(value) {
  exactFields(value, AI_NOTE_DRAFT_FIELDS);
  const identity = identityFields(value);
  const rawText = boundedText(value.text, VOCABULARY_BOOK_LIMITS.aiInputChars);
  const action = boundedText(value.action, 20);
  if (!AI_ACTIONS.includes(action)) fail("VOCABULARY_BAD_DATA");
  return {
    ...identity,
    action,
    text: rawText.slice(0, VOCABULARY_BOOK_LIMITS.aiNoteChars),
    truncated: rawText.length > VOCABULARY_BOOK_LIMITS.aiNoteChars,
    turnId: boundedText(value.turnId, VOCABULARY_BOOK_LIMITS.idChars),
    provenance: provenance(value.provenance),
    readingRef: readingRef(value.readingRef)
  };
}

export function validateVocabularyEntry(value) {
  exactFields(value, ENTRY_FIELDS);
  const entry = {
    id: boundedText(value.id, 80),
    ...identityFields(value),
    ...lexicalFields(value),
    aiNotes: aiNotesList(value.aiNotes),
    savedAt: boundedNumber(value.savedAt, 0, Number.MAX_SAFE_INTEGER),
    reviewCount: boundedNumber(value.reviewCount, 0, 1_000_000),
    knownStreak: boundedNumber(value.knownStreak, 0, KNOWN_INTERVALS_DAYS.length),
    lastReviewedAt: value.lastReviewedAt === null ? null : boundedNumber(value.lastReviewedAt, 0, Number.MAX_SAFE_INTEGER),
    nextReviewAt: boundedNumber(value.nextReviewAt, 0, Number.MAX_SAFE_INTEGER)
  };
  if (!entry.definitions.length && !entry.aiNotes.length) fail("VOCABULARY_BAD_DATA");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(entry.id) || byteLength(entry) > VOCABULARY_BOOK_LIMITS.entryBytes) fail("VOCABULARY_BAD_DATA");
  return entry;
}

function migrateLegacyEntry(value) {
  exactFields(value, LEGACY_ENTRY_FIELDS);
  return validateVocabularyEntry({ ...value, aiNotes: [] });
}

export function validateVocabularyStore(value) {
  exactFields(value, ["version", "entries"]);
  if (![1, VOCABULARY_BOOK_VERSION].includes(value.version) || !Array.isArray(value.entries) || value.entries.length > VOCABULARY_BOOK_LIMITS.entries) {
    fail("VOCABULARY_BAD_DATA");
  }
  const entries = value.entries.map(value.version === 1 ? migrateLegacyEntry : validateVocabularyEntry);
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
    pronunciation: existing.pronunciation || draft.pronunciation,
    partOfSpeech: existing.partOfSpeech || draft.partOfSpeech,
    definitions: [...new Set([...existing.definitions, ...draft.definitions])].slice(0, VOCABULARY_BOOK_LIMITS.definitions),
    examples: [...new Set([...existing.examples, ...draft.examples])].slice(0, VOCABULARY_BOOK_LIMITS.examples),
    sources: [...new Map([...existing.sources, ...draft.sources].map((source) => [JSON.stringify(source), source])).values()].slice(0, VOCABULARY_BOOK_LIMITS.sources)
  });
}

export function mergeVocabularyAiNote(existingValue, noteDraftValue, savedAt) {
  const existing = validateVocabularyEntry(existingValue), draft = validateVocabularyAiNoteDraft(noteDraftValue);
  if (vocabularyIdentity(existing) !== vocabularyIdentity(draft)) fail("VOCABULARY_BAD_DATA");
  const candidate = { action: draft.action, text: draft.text, truncated: draft.truncated,
    turnId: draft.turnId, provenance: draft.provenance, readingRef: draft.readingRef };
  const previous = existing.aiNotes.find((item) => item.action === draft.action);
  if (previous && JSON.stringify({ ...previous, savedAt: undefined }) === JSON.stringify({ ...candidate, savedAt: undefined })) return existing;
  const note = validateVocabularyAiNote({ action: draft.action, text: draft.text, truncated: draft.truncated,
    turnId: draft.turnId, provenance: draft.provenance, readingRef: draft.readingRef, savedAt });
  const notesByAction = new Map(existing.aiNotes.map((item) => [item.action, item]));
  notesByAction.set(note.action, note);
  return validateVocabularyEntry({ ...existing, aiNotes: AI_ACTIONS.map((action) => notesByAction.get(action)).filter(Boolean) });
}

export function createVocabularyAiEntry(noteDraftValue, { id, savedAt }) {
  const draft = validateVocabularyAiNoteDraft(noteDraftValue);
  return validateVocabularyEntry({ id, headword: draft.headword, sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage, pronunciation: "", partOfSpeech: "", definitions: [], examples: [], sources: [],
    aiNotes: [{ action: draft.action, text: draft.text, truncated: draft.truncated, turnId: draft.turnId,
      provenance: draft.provenance, readingRef: draft.readingRef, savedAt }], savedAt, reviewCount: 0,
    knownStreak: 0, lastReviewedAt: null, nextReviewAt: savedAt });
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
