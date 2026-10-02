import { SELECTION_EXPLAIN_LIMITS } from "../selection-explanation.js";

export const READING_SCHEMA_VERSION = 1;
export const READING_PROTOCOL_VERSION = 2;
// Path only: #235 creates this page; it is not yet a built asset.
export const READING_LEARNING_CENTER_PATH = "learning-center.html";
export const READING_INVALIDATION_PORT = "reading.invalidate";
export const READING_PROJECTION_VERSION = "tf-source-utf16-v1";
export const READING_ITEM_KEY_VERSION = "ri1";
export const READING_LIMITS = Object.freeze({
  selectionChars: SELECTION_EXPLAIN_LIMITS.selectionChars,
  contextChars: SELECTION_EXPLAIN_LIMITS.contextChars,
  quoteContextChars: 120,
  idChars: 120,
  phoneticChars: 240,
  partOfSpeechChars: 80,
  packVersionChars: 120,
  sourceEntryChars: 180,
  modelChars: 120,
  providerFingerprintChars: 180,
  cursorChars: 256,
  titleChars: 300,
  urlChars: 4096,
  languageChars: 80,
  questionChars: 2000,
  answerChars: 24000,
  dictionaryEntries: 8,
  definitionChars: 240,
  provenanceEntries: 4,
  artifactBytes: 64 * 1024,
  requestBytes: 128 * 1024,
  records: 10000,
  totalBytes: 64 * 1024 * 1024,
  pageSize: 100,
  searchChars: 200,
  artifactsPerRecord: 256,
  snapshotsPerRecord: 256,
  scanSliceChars: 16000,
  scanSliceNodes: 500,
  scanSliceMs: 8,
  scanTotalChars: 1000000,
  scanTotalNodes: 25000,
  scanTotalMs: 250,
  scanRetryCount: 3,
  mutationDebounceMs: 150,
  pageMarkers: 200,
  handoffTtlMs: 60000,
  operationTtlMs: 10 * 60 * 1000,
  listResponseBytes: 1024 * 1024,
  detailResponseBytes: 32 * 1024 * 1024,
  resultPreviewChars: 240,
  contextPreviewChars: 160,
  exclusionSites: 200,
  operationsPerOwner: 16,
  operationsGlobal: 128,
  exportChunkBytes: 256 * 1024,
  exportsPerOwner: 1,
  exportsGlobal: 2,
  exportTtlMs: 10 * 60 * 1000
});

export const READING_METHOD = Object.freeze({
  BEGIN_QUERY: "reading.begin-query",
  SAVE_QUERY_RESULT: "reading.save-query-result",
  APPEND_ASSISTANT: "reading.append-assistant",
  GET_PAGE_SUMMARY: "reading.get-page-summary",
  GET_RECORD: "reading.get-record",
  LIST_RECORDS: "reading.list-records",
  GET_RECORDING_STATE: "reading.get-recording-state",
  SET_RECORDING: "reading.set-recording",
  DELETE_RECORD: "reading.delete-record",
  DELETE_PAGE: "reading.delete-page",
  CLEAR_RECORDS: "reading.clear-records",
  LIST_PAGES: "reading.list-pages",
  EXPORT_START: "reading.export-start",
  EXPORT_NEXT: "reading.export-next",
  EXPORT_FINISH: "reading.export-finish",
  EXPORT_CANCEL: "reading.export-cancel",
  OPEN_LEARNING_CENTER: "reading.open-learning-center",
  GET_SITE_RECORDING: "reading.get-site-recording",
  SET_SITE_RECORDING: "reading.set-site-recording",
  LIST_RECORDING_EXCLUSIONS: "reading.list-recording-exclusions",
  CANCEL_OPERATION: "reading.cancel-operation",
  REGISTER_DOCUMENT: "reading.register-document",
  CREATE_HANDOFF: "reading.create-handoff",
  CONSUME_HANDOFF: "reading.consume-handoff"
});

export const READING_ERROR = Object.freeze({
  BAD_DTO: "READING_BAD_DTO",
  NOT_READY: "READING_NOT_READY",
  CAPABILITY_LIMITED: "READING_CAPABILITY_LIMITED",
  LIMIT: "READING_LIMIT",
  UNSUPPORTED_VERSION: "READING_UNSUPPORTED_VERSION",
  FORBIDDEN: "READING_FORBIDDEN",
  DISABLED: "READING_DISABLED",
  STALE_OPERATION: "READING_STALE_OPERATION",
  REVISION_CONFLICT: "READING_REVISION_CONFLICT",
  NOT_FOUND: "READING_NOT_FOUND",
  CAPACITY: "READING_CAPACITY",
  STORAGE: "READING_STORAGE",
  QUOTA: "READING_QUOTA",
  INTERRUPTED: "READING_INTERRUPTED",
  UNSAFE_URL: "READING_UNSAFE_URL",
  HANDOFF_EXPIRED: "READING_HANDOFF_EXPIRED"
});

export const READING_CONTENT_METHODS = Object.freeze([
  READING_METHOD.BEGIN_QUERY, READING_METHOD.SAVE_QUERY_RESULT, READING_METHOD.APPEND_ASSISTANT,
  READING_METHOD.GET_PAGE_SUMMARY, READING_METHOD.GET_RECORD, READING_METHOD.GET_RECORDING_STATE,
  READING_METHOD.CONSUME_HANDOFF, READING_METHOD.OPEN_LEARNING_CENTER, READING_METHOD.GET_SITE_RECORDING,
  READING_METHOD.CANCEL_OPERATION, READING_METHOD.REGISTER_DOCUMENT
]);

export const READING_LOCATION_STATUS = Object.freeze([
  "resolved", "ambiguous", "missing", "not-loaded", "unsupported", "permission-required"
]);
