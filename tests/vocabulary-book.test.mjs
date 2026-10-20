import test from "node:test";
import assert from "node:assert/strict";
import { createVocabularyBook, VOCABULARY_BOOK_STORAGE_KEY } from "../src/background/vocabulary-book.js";
import { VocabularyBookError, VOCABULARY_BOOK_VERSION, validateVocabularyDraft } from "../src/shared/vocabulary-book.js";

const DAY = 24 * 60 * 60 * 1000;
function draft(headword = "persistent", patch = {}) {
  return {
    headword, sourceLanguage: "en", targetLanguage: "zh-CN", pronunciation: "/pəˈsɪstənt/", partOfSpeech: "adjective",
    definitions: ["持久的", "持续存在的"], examples: ["The fixture contains a persistent term."],
    sources: [{ sourceId: "pwn-3.0", packId: "core-fixture", packVersion: "fixture-1", sourceEntryId: "10000003-a" }],
    ...patch
  };
}
function storage(initial = null) {
  let value = initial;
  return {
    adapter: {
      async get(key) { return value === null ? {} : { [key]: structuredClone(value) }; },
      async set(values) { value = structuredClone(values[VOCABULARY_BOOK_STORAGE_KEY]); }
    },
    get value() { return value; }
  };
}
function aiNote(action = "understand", patch = {}) {
  return {
    headword: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN", action,
    text: "A bounded synthetic AI learning note.", turnId: `turn-${action}`,
    provenance: { provider: "mock", model: "mock-model", promptVersion: "selection-assistant-v1",
      providerConfigFingerprint: "opaque-fingerprint" },
    readingRef: { recordId: "record-1", artifactId: `artifact-${action}` },
    ...patch
  };
}

test("saves bounded dictionary provenance, deduplicates normalized headword and keeps first review due", async () => {
  const local = storage(); let now = 1000, id = 0;
  const book = createVocabularyBook({ storage: local.adapter, now: () => now, randomId: () => `entry-${++id}` });
  const first = await book.add(draft("Persistent"));
  assert.deepEqual({ added: first.added, updated: first.updated }, { added: true, updated: false });
  assert.equal(first.entry.nextReviewAt, now);
  now += 100;
  const duplicate = await book.add(draft(" persistent ", { examples: ["A second local example."] }));
  assert.deepEqual({ added: duplicate.added, updated: duplicate.updated }, { added: false, updated: true });
  assert.equal(duplicate.entry.id, first.entry.id);
  const list = await book.list();
  assert.equal(list.count, 1);
  assert.equal(list.dueCount, 1);
  assert.deepEqual(list.entries[0].examples, ["The fixture contains a persistent term.", "A second local example."]);
  assert.equal(local.value.version, VOCABULARY_BOOK_VERSION);
  assert.deepEqual(local.value.entries[0].aiNotes, []);
});

test("migrates v1 entries in place without changing lexical or review data", async () => {
  const legacy = { version: 1, entries: [{ id: "legacy-entry", ...draft("Legacy"), savedAt: 10,
    reviewCount: 3, knownStreak: 2, lastReviewedAt: 20, nextReviewAt: 30 }] };
  const local = storage(legacy), book = createVocabularyBook({ storage: local.adapter, now: () => 40 });
  const list = await book.list();
  assert.equal(list.entries[0].headword, "Legacy");
  assert.equal(list.entries[0].reviewCount, 3);
  assert.equal(list.entries[0].nextReviewAt, 30);
  assert.deepEqual(list.entries[0].aiNotes, []);
  assert.equal(local.value.version, VOCABULARY_BOOK_VERSION);
});

test("creates AI-only entries, merges dictionary facts and replaces each AI action without duplication", async () => {
  const local = storage(); let now = 100;
  const book = createVocabularyBook({ storage: local.adapter, now: () => now++, randomId: () => "ai-entry" });
  const created = await book.addAiNote(aiNote("understand", { text: "字".repeat(4100) }));
  assert.equal(created.added, true);
  assert.deepEqual(created.entry.definitions, []);
  assert.deepEqual(created.entry.sources, []);
  assert.equal(created.entry.aiNotes[0].text.length, 4000);
  assert.equal(created.entry.aiNotes[0].truncated, true);

  const lexical = await book.add(draft());
  assert.equal(lexical.updated, true);
  assert.deepEqual(lexical.entry.definitions, ["持久的", "持续存在的"]);
  assert.equal(lexical.entry.aiNotes.length, 1);

  await book.addAiNote(aiNote("analyze"));
  await book.addAiNote(aiNote("usage"));
  const unchanged = await book.addAiNote(aiNote("usage"));
  assert.equal(unchanged.updated, false);
  const replaced = await book.addAiNote(aiNote("understand", { text: "Updated understanding.", readingRef: null }));
  assert.equal(replaced.updated, true);
  assert.equal(replaced.entry.aiNotes.length, 3);
  assert.equal(replaced.entry.aiNotes.find(note => note.action === "understand").text, "Updated understanding.");
  assert.equal(replaced.entry.aiNotes.find(note => note.action === "understand").readingRef, null);
});

test("accepts only due reviews and advances Again and Know with the minimal schedule", async () => {
  const local = storage(); let now = 10_000;
  const book = createVocabularyBook({ storage: local.adapter, now: () => now, randomId: () => "review-entry" });
  const saved = await book.add(draft());
  const first = await book.review(saved.entry.id, "know");
  assert.equal(first.entry.nextReviewAt, now + DAY);
  assert.equal(first.entry.knownStreak, 1);
  await assert.rejects(book.review(saved.entry.id, "again"), (error) => error.code === "VOCABULARY_REVIEW_NOT_DUE");
  now += DAY;
  const second = await book.review(saved.entry.id, "know");
  assert.equal(second.entry.nextReviewAt, now + 3 * DAY);
  assert.equal(second.entry.knownStreak, 2);
  now = second.entry.nextReviewAt;
  const again = await book.review(saved.entry.id, "again");
  assert.equal(again.entry.nextReviewAt, now + 15 * 60 * 1000);
  assert.equal(again.entry.knownStreak, 0);
  assert.equal(again.entry.reviewCount, 3);
});

test("bounds and exact fields reject page context and oversized data", () => {
  assert.throws(() => validateVocabularyDraft({ ...draft(), pageUrl: "https://private.example/" }), VocabularyBookError);
  assert.throws(() => validateVocabularyDraft(draft("word", { definitions: ["x".repeat(1201)] })), error => error.code === "VOCABULARY_BAD_DATA");
  assert.throws(() => validateVocabularyDraft(draft("word", { definitions: ["meaning", "meaning", "meaning", "meaning", "fifth"] })), error => error.code === "VOCABULARY_BAD_DATA");
});

test("serializes concurrent adds, removes only the vocabulary entry and enforces the entry cap", async () => {
  const local = storage(); let id = 0;
  const book = createVocabularyBook({ storage: local.adapter, now: () => 500, randomId: () => `item-${++id}` });
  const [a, b] = await Promise.all([book.add(draft("word")), book.add(draft("WORD"))]);
  assert.equal((await book.list()).count, 1);
  assert.equal((await book.remove(a.entry.id)).removed, true);
  assert.equal((await book.remove(b.entry.id)).removed, false);
  for (let index = 0; index < 200; index++) await book.add(draft(`word-${index}`));
  await assert.rejects(book.add(draft("one-too-many")), error => error.code === "VOCABULARY_CAPACITY");
  assert.equal((await book.list()).count, 200);
});

test("storage failures are stable and do not report successful writes", async () => {
  const book = createVocabularyBook({ storage: { get: async () => ({}), set: async () => { throw new Error("quota"); } }, now: () => 1, randomId: () => "failure" });
  await assert.rejects(book.add(draft()), error => error.code === "VOCABULARY_STORAGE");
});

test("wordbook backup restores exact notes, languages and reviews; duplicates preserve newer local data", async () => {
  const local = storage(), original = createVocabularyBook({ storage: local.adapter, now: () => 1000, randomId: () => "saved-1" });
  await original.add(draft("persistent", { targetLanguage: "ja" }));
  await original.addAiNote(aiNote("usage", { targetLanguage: "ja" }));
  await original.review("saved-1", "know");
  const { backup } = await original.backup();
  const target = storage(), restored = createVocabularyBook({ storage: target.adapter });
  assert.deepEqual(await restored.restore(backup), { imported: 1, skipped: 0 });
  assert.deepEqual((await restored.backup()).backup.store, backup.store);
  assert.deepEqual(await restored.restore(backup), { imported: 0, skipped: 1 });
  assert.equal((await createVocabularyBook({ storage: target.adapter }).list()).entries[0].targetLanguage, "ja");
  const before = structuredClone(target.value);
  await assert.rejects(async () => restored.restore({ ...backup, store: { ...backup.store, entries: [...backup.store.entries, { bad: true }] } }), { code: "VOCABULARY_BAD_DATA" });
  await assert.rejects(async () => restored.restore({ ...backup, schemaVersion: 77 }), { code: "VOCABULARY_BAD_DATA" });
  assert.deepEqual(target.value, before);
});

test("wordbook restore capacity and failed writes never acknowledge success or replace existing data", async () => {
  const originalStorage = storage(), original = createVocabularyBook({ storage: originalStorage.adapter, randomId: () => "existing" });
  await original.add(draft()); const { backup } = await original.backup();
  const entries = Array.from({ length: 200 }, (_, index) => ({ ...backup.store.entries[0], id: `filled-${index}`, headword: `filled-${index}` }));
  const target = storage({ version: 2, entries }), restored = createVocabularyBook({ storage: target.adapter });
  await assert.rejects(restored.restore(backup), { code: "VOCABULARY_CAPACITY" });
  assert.deepEqual(target.value.entries, entries);
  const broken = createVocabularyBook({ storage: { get: async () => ({}), set: async () => { throw new Error("synthetic quota"); } } });
  await assert.rejects(broken.restore(backup), { code: "VOCABULARY_STORAGE" });
});
