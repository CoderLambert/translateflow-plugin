import { BACKGROUND_MESSAGES } from "../../shared/constants.js";
import { validateVocabularyEntry } from "../../shared/vocabulary-book.js";

export type VocabularyEntry = ReturnType<typeof validateVocabularyEntry>;
export type ReviewRating = "again" | "know";
export interface VocabularyList {
  entries: VocabularyEntry[];
  due: VocabularyEntry[];
  count: number;
  dueCount: number;
  capacity: number;
}

export class VocabularyClientError extends Error {
  constructor(readonly code: string) { super(code); }
}

type Send = (message: Record<string, unknown>) => Promise<unknown>;

export class VocabularyBookClient {
  constructor(private readonly send: Send = message => chrome.runtime.sendMessage(message)) {}

  private async request(type: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    let raw: unknown;
    try { raw = await this.send({ type, ...fields }); }
    catch { throw new VocabularyClientError("VOCABULARY_DISCONNECTED"); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new VocabularyClientError("VOCABULARY_BAD_RESPONSE");
    const response = raw as Record<string, unknown>;
    if (response.ok !== true) throw new VocabularyClientError(typeof response.errorCode === "string" ? response.errorCode : "VOCABULARY_BAD_RESPONSE");
    return response;
  }

  async list(): Promise<VocabularyList> {
    const response = await this.request(BACKGROUND_MESSAGES.VOCABULARY_BOOK_LIST);
    if (!Array.isArray(response.entries) || !Array.isArray(response.due) ||
        !Number.isSafeInteger(response.count) || !Number.isSafeInteger(response.dueCount) ||
        !Number.isSafeInteger(response.capacity)) throw new VocabularyClientError("VOCABULARY_BAD_RESPONSE");
    const entries = response.entries.map(validateVocabularyEntry), due = response.due.map(validateVocabularyEntry);
    if (response.count !== entries.length || response.dueCount !== due.length || due.some(entry => !entries.some(saved => saved.id === entry.id))) {
      throw new VocabularyClientError("VOCABULARY_BAD_RESPONSE");
    }
    return { entries, due, count: entries.length, dueCount: due.length, capacity: response.capacity as number };
  }

  async review(id: string, rating: ReviewRating): Promise<VocabularyEntry> {
    const response = await this.request(BACKGROUND_MESSAGES.VOCABULARY_BOOK_REVIEW, { id, rating });
    try { return validateVocabularyEntry(response.entry); }
    catch { throw new VocabularyClientError("VOCABULARY_BAD_RESPONSE"); }
  }

  async remove(id: string): Promise<boolean> {
    const response = await this.request(BACKGROUND_MESSAGES.VOCABULARY_BOOK_REMOVE, { id });
    if (typeof response.removed !== "boolean") throw new VocabularyClientError("VOCABULARY_BAD_RESPONSE");
    return response.removed;
  }
}

export const vocabularyBookClient = new VocabularyBookClient();
