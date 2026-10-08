import test from "node:test";
import assert from "node:assert/strict";
import { createVocabularyBook, VOCABULARY_BOOK_STORAGE_KEY } from "../src/background/vocabulary-book.js";
import { VocabularyBookError, validateVocabularyDraft } from "../src/shared/vocabulary-book.js";

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
  assert.equal(local.value.version, 1);
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
