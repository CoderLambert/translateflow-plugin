import { READING_ERROR, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { validateSourceSnapshot } from "./source.js";
import { validateResultArtifact } from "./artifact.js";
import { validateOperationToken } from "./lifecycle.js";
import { bool, choice, fail, id, integer, jsonBytes, nullable, object, pageKey, recordId, safeReturnUrl, text, version } from "./validation.js";

const BASE = ["schemaVersion", "method"];
const fields = {
  [M.BEGIN_QUERY]: ["operationId", "purpose", "sourceSnapshot", "pageKey", "safeReturnUrl", "pageTitle", "itemText", "sourceLanguage", "recordId", "recordRevision"],
  [M.SAVE_QUERY_RESULT]: ["token", "artifact"],
  [M.APPEND_ASSISTANT]: ["token", "artifact"],
  [M.GET_PAGE_SUMMARY]: ["cursor", "limit"],
  [M.GET_RECORD]: ["recordId"],
  [M.LIST_RECORDS]: ["pageKey", "query", "cursor", "limit"],
  [M.GET_RECORDING_STATE]: [],
  [M.SET_RECORDING]: ["enabled", "expectedConsentGeneration"],
  [M.DELETE_RECORD]: ["recordId", "expectedRevision"],
  [M.DELETE_PAGE]: ["pageKey"],
  [M.CLEAR_RECORDS]: ["expectedDataGeneration"],
  [M.EXPORT_JSON]: [],
  [M.CREATE_HANDOFF]: ["recordId", "expectedRevision"],
  [M.CONSUME_HANDOFF]: ["handoffId"]
};
export function validateReadingRequest(value) {
  jsonBytes(value, L.requestBytes, "request");
  object(value, [...BASE, ...(fields[value?.method] || [])], "request");
  const schemaVersion = version(value.schemaVersion, "request.schemaVersion");
  const method = choice(value.method, Object.values(M), "request.method");
  return { schemaVersion, method, ...body(method, value) };
}
function body(method, value) {
  if (method === M.BEGIN_QUERY) return begin(value);
  if ([M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT].includes(method)) {
    const token = validateOperationToken(value.token), artifact = validateResultArtifact(value.artifact);
    if (token.recordId !== artifact.recordId || token.operationId !== artifact.operationId ||
        (method === M.APPEND_ASSISTANT && (artifact.kind !== "assistant" || token.purpose !== "assistant")) ||
        (method === M.SAVE_QUERY_RESULT && token.purpose !== "lookup")) fail(READING_ERROR.BAD_DTO, "request.artifact");
    return { token, artifact };
  }
  if ([M.GET_PAGE_SUMMARY, M.LIST_RECORDS].includes(method)) {
    const result = { cursor: nullable(value.cursor, (item, path) => text(item, L.cursorChars, path), "request.cursor"),
      limit: integer(value.limit, 1, L.pageSize, "request.limit") };
    if (method === M.LIST_RECORDS) Object.assign(result, {
      pageKey: nullable(value.pageKey, pageKey, "request.pageKey"),
      query: text(value.query, L.searchChars, "request.query", { empty: true })
    });
    return result;
  }
  if ([M.GET_RECORD, M.DELETE_RECORD, M.CREATE_HANDOFF].includes(method)) {
    const result = { recordId: recordId(value.recordId, "request.recordId") };
    if (method !== M.GET_RECORD) result.expectedRevision = integer(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER, "request.expectedRevision");
    return result;
  }
  if (method === M.SET_RECORDING) return { enabled: bool(value.enabled, "request.enabled"),
    expectedConsentGeneration: integer(value.expectedConsentGeneration, 1, Number.MAX_SAFE_INTEGER, "request.expectedConsentGeneration") };
  if (method === M.DELETE_PAGE) return { pageKey: pageKey(value.pageKey, "request.pageKey") };
  if (method === M.CLEAR_RECORDS) return { expectedDataGeneration: integer(value.expectedDataGeneration, 1, Number.MAX_SAFE_INTEGER, "request.expectedDataGeneration") };
  if (method === M.CONSUME_HANDOFF) return { handoffId: id(value.handoffId, "request.handoffId") };
  return {};
}
function begin(value) {
  const itemText = text(value.itemText, L.selectionChars, "request.itemText");
  const sourceLanguage = text(value.sourceLanguage, L.languageChars, "request.sourceLanguage");
  const sourceSnapshot = validateSourceSnapshot(value.sourceSnapshot);
  if (sourceSnapshot.selectedText !== itemText) fail(READING_ERROR.BAD_DTO, "request.sourceSnapshot");
  const existingId = nullable(value.recordId, recordId, "request.recordId");
  const recordRevision = nullable(value.recordRevision,
    (item, path) => integer(item, 1, Number.MAX_SAFE_INTEGER, path), "request.recordRevision");
  if ((existingId === null) !== (recordRevision === null)) fail(READING_ERROR.BAD_DTO, "request.recordRevision");
  return { operationId: id(value.operationId, "request.operationId"), purpose: choice(value.purpose, ["lookup", "assistant"], "request.purpose"), sourceSnapshot,
    pageKey: pageKey(value.pageKey, "request.pageKey"), safeReturnUrl: nullable(value.safeReturnUrl, safeReturnUrl, "request.safeReturnUrl"),
    pageTitle: text(value.pageTitle, L.titleChars, "request.pageTitle", { empty: true }), itemText, sourceLanguage,
    recordId: existingId, recordRevision };
}
