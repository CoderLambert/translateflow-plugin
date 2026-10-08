import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { EXTENSION_PAGES } from "../shared/runtime-assets.js";
import { createChromeVocabularyBook } from "./vocabulary-book.js";

let vocabularyBook;
function getVocabularyBook() {
  vocabularyBook ||= createChromeVocabularyBook();
  return vocabularyBook;
}

export async function handleVocabularyBookMessage(message, sender) {
  switch (message?.type) {
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_ADD:
      assertVocabularyContentSender(sender);
      return getVocabularyBook().add(message.entry);
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_OPEN:
      assertVocabularyContentSender(sender);
      await chrome.tabs.create({ url: `${chrome.runtime.getURL(EXTENSION_PAGES.learningCenter)}#wordbook` });
      return { opened: true };
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_LIST:
      assertVocabularyLearningCenterSender(sender);
      return getVocabularyBook().list();
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_REVIEW:
      assertVocabularyLearningCenterSender(sender);
      return getVocabularyBook().review(message.id, message.rating);
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_REMOVE:
      assertVocabularyLearningCenterSender(sender);
      return getVocabularyBook().remove(message.id);
    default:
      throw new Error("Unknown vocabulary book message.");
  }
}

function assertVocabularyContentSender(sender) {
  let pageUrl;
  try { pageUrl = new URL(String(sender?.url || "")); } catch { pageUrl = null; }
  const extensionId = globalThis.chrome?.runtime?.id;
  if (!extensionId || sender?.id !== extensionId || !Number.isInteger(sender?.tab?.id) ||
      !pageUrl || !["http:", "https:"].includes(pageUrl.protocol)) {
    const error = new Error("Vocabulary save is only available from TranslateFlow page content.");
    error.code = "RICH_MDICT_CONTENT_ONLY";
    throw error;
  }
  if (sender?.frameId !== 0 || sender?.incognito === true || sender?.tab?.incognito === true) {
    const error = new Error("Vocabulary book actions require a regular top-level page.");
    error.code = "VOCABULARY_FORBIDDEN";
    throw error;
  }
}

function assertVocabularyLearningCenterSender(sender) {
  const expected = chrome.runtime.getURL(EXTENSION_PAGES.learningCenter);
  const actual = String(sender?.url || "");
  const allowed = new Set([expected, `${expected}#wordbook`, `${expected}#review`]);
  if (sender?.id !== chrome.runtime.id || sender?.frameId !== 0 || sender?.incognito === true ||
      sender?.tab?.incognito === true || !allowed.has(actual)) {
    const error = new Error("Vocabulary book data is available only in the Learning Center.");
    error.code = "VOCABULARY_FORBIDDEN";
    throw error;
  }
}
