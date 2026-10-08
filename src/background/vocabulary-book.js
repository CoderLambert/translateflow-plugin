import {
  VocabularyBookError,
  VOCABULARY_BOOK_LIMITS,
  VOCABULARY_BOOK_VERSION,
  isVocabularyDue,
  mergeVocabularyDraft,
  validateVocabularyDraft,
  validateVocabularyEntry,
  validateVocabularyStore,
  vocabularyIdentity,
  scheduleVocabularyReview
} from "../shared/vocabulary-book.js";

export const VOCABULARY_BOOK_STORAGE_KEY = "tfVocabularyBookV1";
const EMPTY_STORE = Object.freeze({ version: VOCABULARY_BOOK_VERSION, entries: Object.freeze([]) });

function error(code) { return new VocabularyBookError(code); }

export function createVocabularyBook({ storage, now = Date.now, randomId = () => crypto.randomUUID() } = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") throw new TypeError("Vocabulary storage adapter is required.");
  let tail = Promise.resolve();

  function serialize(operation) {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  }

  async function readStore() {
    let result;
    try { result = await storage.get(VOCABULARY_BOOK_STORAGE_KEY); }
    catch { throw error("VOCABULARY_STORAGE"); }
    if (!result || !Object.hasOwn(result, VOCABULARY_BOOK_STORAGE_KEY)) return { ...EMPTY_STORE, entries: [] };
    return validateVocabularyStore(result[VOCABULARY_BOOK_STORAGE_KEY]);
  }

  async function writeStore(store) {
    const checked = validateVocabularyStore(store);
    try { await storage.set({ [VOCABULARY_BOOK_STORAGE_KEY]: checked }); }
    catch { throw error("VOCABULARY_STORAGE"); }
    return checked;
  }

  function publicList(store, at) {
    const entries = store.entries.slice().sort((a, b) => b.savedAt - a.savedAt || a.headword.localeCompare(b.headword));
    const due = entries.filter((entry) => isVocabularyDue(entry, at)).sort((a, b) => a.nextReviewAt - b.nextReviewAt || a.savedAt - b.savedAt);
    return { entries, due, count: entries.length, dueCount: due.length, capacity: VOCABULARY_BOOK_LIMITS.entries };
  }

  return Object.freeze({
    list() {
      return serialize(async () => publicList(await readStore(), now()));
    },
    add(input) {
      return serialize(async () => {
        const draft = validateVocabularyDraft(input), store = await readStore(), identity = vocabularyIdentity(draft);
        const index = store.entries.findIndex((entry) => vocabularyIdentity(entry) === identity);
        if (index >= 0) {
          const previous = store.entries[index], updated = mergeVocabularyDraft(previous, draft);
          const entries = store.entries.slice(); entries[index] = updated;
          const changed = JSON.stringify(previous) !== JSON.stringify(updated);
          if (changed) await writeStore({ ...store, entries });
          return { added: false, updated: changed, entry: updated };
        }
        if (store.entries.length >= VOCABULARY_BOOK_LIMITS.entries) throw error("VOCABULARY_CAPACITY");
        const at = now();
        const entry = validateVocabularyEntry({ id: randomId(), ...draft, savedAt: at, reviewCount: 0,
          knownStreak: 0, lastReviewedAt: null, nextReviewAt: at });
        await writeStore({ ...store, entries: [entry, ...store.entries] });
        return { added: true, updated: false, entry };
      });
    },
    review(id, rating) {
      return serialize(async () => {
        if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(id)) throw error("VOCABULARY_BAD_DATA");
        const store = await readStore(), index = store.entries.findIndex((entry) => entry.id === id);
        if (index < 0) throw error("VOCABULARY_NOT_FOUND");
        const entry = scheduleVocabularyReview(store.entries[index], rating, now());
        const entries = store.entries.slice(); entries[index] = entry;
        await writeStore({ ...store, entries });
        return { entry };
      });
    },
    remove(id) {
      return serialize(async () => {
        if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(id)) throw error("VOCABULARY_BAD_DATA");
        const store = await readStore(), entries = store.entries.filter((entry) => entry.id !== id);
        if (entries.length === store.entries.length) return { removed: false };
        await writeStore({ ...store, entries });
        return { removed: true };
      });
    }
  });
}

export function createChromeVocabularyBook() {
  return createVocabularyBook({ storage: globalThis.chrome?.storage?.local });
}
