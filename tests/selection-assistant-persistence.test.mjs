import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { BACKGROUND_MESSAGES } from "../src/shared/constants.js";
import { createVocabularyBook, VOCABULARY_BOOK_STORAGE_KEY } from "../src/background/vocabulary-book.js";

function fixture() {
  let data, sequence = 0, accepted, controls;
  const book = createVocabularyBook({ storage: {
    get: async key => data ? { [key]: structuredClone(data) } : {},
    set: async values => { data = structuredClone(values[VOCABULARY_BOOK_STORAGE_KEY]); }
  }, randomId: () => `entry-${++sequence}` });
  const realm = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: { modules: {
    runtime: { messages: { background: BACKGROUND_MESSAGES }, sendRuntimeMessage: async message => {
      if (message.type === BACKGROUND_MESSAGES.VOCABULARY_BOOK_ADD_AI_NOTE) return { ok: true, ...await book.addAiNote(structuredClone(message.note)) };
      assert.equal(message.type, BACKGROUND_MESSAGES.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE);
      return { ok: true, ...await book.syncAiNoteReference(structuredClone(message.reference)) };
    } }
  } } });
  for (const name of ["vocabulary-book", "assistant-persistence"]) {
    vm.runInContext(readFileSync(`src/content/selection/${name}.js`, "utf8"), realm);
  }
  const modules = realm.__TRANSLATE_FLOW_CONTENT__.modules;
  const persistence = modules.selectionAssistantPersistence.create({
    records: { accept(_ctx, _draft, callbacks) { accepted = callbacks; return true; } },
    vocabularyBook: modules.selectionVocabularyBook.create(),
    popover: { showAiPersistence(state) { controls = state; } }, isLive: () => true
  });
  const result = { queryRecord: {}, operation: { operationId: "operation-1" }, readingRef: null, action: "understand", note: {
    headword: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN", action: "understand", text: "Old answer", turnId: "old-turn",
    provenance: { provider: "mock", model: "mock", promptVersion: "v1", providerConfigFingerprint: "opaque" }, readingRef: null
  } };
  persistence.attach(result, {});
  return { book, result, save: () => controls.onSaveVocabulary({ isTrusted: true }),
    ack: () => accepted.onSaved({ recordId: "reading-1", artifactId: "artifact-1" }) };
}

test("late Reading acknowledgment cannot recreate a removed vocabulary entry", async () => {
  const f = fixture(); await f.save();
  await f.book.remove((await f.book.list()).entries[0].id);
  f.ack(); assert.equal((await f.book.list()).count, 0);
});

test("late Reading acknowledgment cannot overwrite a newer AI turn", async () => {
  const f = fixture(); await f.save();
  await f.book.addAiNote({ ...f.result.note, text: "New answer", turnId: "new-turn" });
  f.ack(); const note = (await f.book.list()).entries[0].aiNotes[0];
  assert.equal(note.turnId, "new-turn"); assert.equal(note.readingRef, null);
});

test("deleting and explicitly readding the same note does not reuse the deleted entry identity", async () => {
  const f = fixture(); await f.save();
  await f.book.remove((await f.book.list()).entries[0].id);
  await f.book.addAiNote(f.result.note);
  f.ack(); assert.equal((await f.book.list()).entries[0].aiNotes[0].readingRef, null);
});

test("Reading acknowledgment updates only the matching saved note reference", async () => {
  const f = fixture(); await f.save(); const before = (await f.book.list()).entries[0];
  f.ack(); const after = (await f.book.list()).entries[0];
  assert.deepEqual(after, { ...before, aiNotes: [{ ...before.aiNotes[0], readingRef: { recordId: "reading-1", artifactId: "artifact-1" } }] });
});
