import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { validateSourceSnapshot } from "./source.js";
import { validateResultArtifact } from "./artifact.js";
import { validateOperationToken } from "./lifecycle.js";
import { bool, choice, fail, id, integer, jsonBytes, nullable, object, pageKey, protocolVersion, recordId, safeReturnUrl, siteKey, text } from "./validation.js";

const BASE = ["protocolVersion", "method"];
const fields = {
  [M.BEGIN_QUERY]: ["operationId", "purpose", "sourceSnapshot", "pageKey", "safeReturnUrl", "pageTitle", "itemText", "sourceLanguage", "recordId", "recordRevision", "captureSafety"],
  [M.SAVE_QUERY_RESULT]: ["token", "artifact"], [M.APPEND_ASSISTANT]: ["token", "artifact"],
  [M.GET_PAGE_SUMMARY]: ["cursor", "limit"], [M.GET_RECORD]: ["recordId"],
  [M.LIST_RECORDS]: ["pageKey", "query", "cursor", "limit"], [M.LIST_PAGES]: ["query", "cursor", "limit"],
  [M.GET_RECORDING_STATE]: [], [M.SET_RECORDING]: ["enabled", "expectedConsentGeneration"],
  [M.DELETE_RECORD]: ["recordId", "expectedRevision"], [M.DELETE_PAGE]: ["pageKey"],
  [M.CLEAR_RECORDS]: ["expectedDataGeneration"], [M.EXPORT_START]: [],
  [M.EXPORT_NEXT]: ["exportId", "cursor"], [M.EXPORT_FINISH]: ["exportId", "sequence"],
  [M.EXPORT_CANCEL]: ["exportId"], [M.OPEN_LEARNING_CENTER]: ["recordId"],
  [M.GET_SITE_RECORDING]: ["siteKey"],
  [M.SET_SITE_RECORDING]: ["siteKey", "excluded", "expectedSitePolicyRevision"],
  [M.GET_SITE_MARKERS]: ["siteKey"], [M.SET_SITE_MARKERS]: ["siteKey", "enabled"],
  [M.LIST_RECORDING_EXCLUSIONS]: ["cursor", "limit"], [M.CANCEL_OPERATION]: ["operationId"],
  [M.REGISTER_DOCUMENT]: ["documentGeneration"],
  [M.CREATE_HANDOFF]: ["recordId", "expectedRevision"], [M.CONSUME_HANDOFF]: ["handoffId"]
};
export function validateReadingRequest(value) {
  jsonBytes(value, L.requestBytes, "request");
  if (!value || typeof value !== "object") fail(E.BAD_DTO, "request");
  const transportVersion = protocolVersion(value.protocolVersion, "request.protocolVersion");
  object(value, [...BASE, ...(fields[value.method] || [])], "request");
  const method = choice(value.method, Object.values(M), "request.method");
  return { protocolVersion: transportVersion, method, ...body(method, value) };
}
export function validateCaptureSafety(value, path = "captureSafety") {
  object(value, ["selection", "context", "root"], path);
  const states = ["safe", "sensitive", "unknown"];
  return { selection: choice(value.selection, states, `${path}.selection`),
    context: choice(value.context, states, `${path}.context`),
    root: choice(value.root, ["light-dom", "unsupported"], `${path}.root`) };
}
function pagination(value) {
  return { cursor: nullable(value.cursor, (item, path) => text(item, L.cursorChars, path), "request.cursor"),
    limit: value.limit === undefined ? 30 : integer(value.limit, 1, L.pageSize, "request.limit") };
}
function body(method, value) {
  if (method === M.BEGIN_QUERY) return begin(value);
  if ([M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT].includes(method)) {
    const token = validateOperationToken(value.token), artifact = validateResultArtifact(value.artifact);
    if (token.recordId !== artifact.recordId || token.operationId !== artifact.operationId ||
        (method === M.APPEND_ASSISTANT && (artifact.kind !== "assistant" || token.purpose !== "assistant")) ||
        (method === M.SAVE_QUERY_RESULT && (artifact.kind === "assistant" || token.purpose !== "lookup"))) fail(E.BAD_DTO, "request.artifact");
    return { token, artifact };
  }
  if ([M.GET_PAGE_SUMMARY, M.LIST_RECORDS, M.LIST_PAGES, M.LIST_RECORDING_EXCLUSIONS].includes(method)) {
    const result = pagination(value);
    if (method === M.LIST_RECORDS) result.pageKey = nullable(value.pageKey, pageKey, "request.pageKey");
    if ([M.LIST_RECORDS, M.LIST_PAGES].includes(method)) result.query = text(value.query, L.searchChars, "request.query", { empty: true });
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
  if (method === M.OPEN_LEARNING_CENTER) return value.recordId === undefined ? {} : { recordId: recordId(value.recordId, "request.recordId") };
  if (method === M.CANCEL_OPERATION) return { operationId: id(value.operationId, "request.operationId") };
  if (method === M.REGISTER_DOCUMENT) return { documentGeneration: id(value.documentGeneration, "request.documentGeneration") };
  if ([M.GET_SITE_RECORDING, M.GET_SITE_MARKERS].includes(method)) return value.siteKey === undefined ? {} : { siteKey: siteKey(value.siteKey, "request.siteKey") };
  if (method === M.SET_SITE_MARKERS) return { siteKey: siteKey(value.siteKey, "request.siteKey"), enabled: bool(value.enabled, "request.enabled") };
  if (method === M.SET_SITE_RECORDING) return { siteKey: siteKey(value.siteKey, "request.siteKey"), excluded: bool(value.excluded, "request.excluded"),
    expectedSitePolicyRevision: integer(value.expectedSitePolicyRevision, 1, Number.MAX_SAFE_INTEGER, "request.expectedSitePolicyRevision") };
  if ([M.EXPORT_NEXT, M.EXPORT_FINISH, M.EXPORT_CANCEL].includes(method)) {
    const result = { exportId: id(value.exportId, "request.exportId") };
    if (method === M.EXPORT_NEXT) result.cursor = text(value.cursor, L.cursorChars, "request.cursor");
    if (method === M.EXPORT_FINISH) result.sequence = integer(value.sequence, 0, Number.MAX_SAFE_INTEGER, "request.sequence");
    return result;
  }
  return {};
}
function begin(value) {
  const itemText = text(value.itemText, L.selectionChars, "request.itemText");
  const sourceLanguage = text(value.sourceLanguage, L.languageChars, "request.sourceLanguage");
  const sourceSnapshot = validateSourceSnapshot(value.sourceSnapshot);
  if (sourceSnapshot.selectedText !== itemText) fail(E.BAD_DTO, "request.sourceSnapshot");
  const existingId = nullable(value.recordId, recordId, "request.recordId");
  const recordRevision = nullable(value.recordRevision, (item, path) => integer(item, 1, Number.MAX_SAFE_INTEGER, path), "request.recordRevision");
  if ((existingId === null) !== (recordRevision === null)) fail(E.BAD_DTO, "request.recordRevision");
  return { operationId: id(value.operationId, "request.operationId"), purpose: choice(value.purpose, ["lookup", "assistant"], "request.purpose"), sourceSnapshot,
    pageKey: pageKey(value.pageKey, "request.pageKey"), safeReturnUrl: nullable(value.safeReturnUrl, safeReturnUrl, "request.safeReturnUrl"),
    pageTitle: text(value.pageTitle, L.titleChars, "request.pageTitle", { empty: true }), itemText, sourceLanguage,
    recordId: existingId, recordRevision, captureSafety: validateCaptureSafety(value.captureSafety) };
}
