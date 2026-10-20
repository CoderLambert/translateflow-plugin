import { validateVocabularyStore, VOCABULARY_BOOK_LIMITS, VocabularyBookError } from "./vocabulary-book.js";
export function validateVocabularyBackup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["format", "schemaVersion", "exportedAt", "store"].includes(key)) ||
      value.format !== "translateflow-vocabulary" || value.schemaVersion !== 1 || !Number.isSafeInteger(value.exportedAt) || value.exportedAt < 0) throw new VocabularyBookError("VOCABULARY_BAD_DATA");
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > VOCABULARY_BOOK_LIMITS.totalBytes + 1024) throw new VocabularyBookError("VOCABULARY_LIMIT");
  return { format: "translateflow-vocabulary", schemaVersion: 1, exportedAt: value.exportedAt, store: validateVocabularyStore(value.store) };
}
