import { READING_CONTENT_METHODS, READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { validateHandoff, validateOperationToken } from "./lifecycle.js";
import { validateReadingExport, validateReadingRecord, validateRecordDetail } from "./record.js";
import { validateAnchor } from "./source.js";
import { array, bool, choice, fail, id, integer, jsonBytes, nullable, object, recordId, text } from "./validation.js";

// method/scope are supplied by the trusted caller adapter, never from response data.
// Syntax validation does not prove sender authority, committed storage, or page ownership.
export function validateReadingResponse(method, value, scope, pageLimit = L.pageSize) {
  choice(method, Object.values(M), "response.method");
  choice(scope, ["content", "extension"], "response.scope");
  jsonBytes(value, L.totalBytes + 1024 * 1024, "response");
  object(value, value?.ok === true ? ["ok", "data"] : ["ok", "error"], "response");
  if (!bool(value.ok, "response.ok")) {
    object(value.error, ["code"], "response.error");
    return { ok: false, error: { code: choice(value.error.code, Object.values(E), "response.error.code") } };
  }
  if (scope === "content" && !READING_CONTENT_METHODS.includes(method)) fail(E.FORBIDDEN, "response.scope");
  return { ok: true, data: data(method, value.data, scope, pageLimit) };
}

export function validatePageSummaryItem(value, path = "pageSummaryItem") {
  object(value, ["recordId", "revision", "anchor"], path);
  return { recordId: recordId(value.recordId, `${path}.recordId`),
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, `${path}.revision`),
    anchor: validateAnchor(value.anchor, `${path}.anchor`) };
}

export function validateRecordingState(value, scope, path = "recordingState") {
  choice(scope, ["content", "extension"], `${path}.scope`);
  const fields = ["enabled", "consentGeneration", "capacityReached"];
  if (scope === "extension") fields.push("dataGeneration", "recordCount", "totalBytes");
  object(value, fields, path);
  const state = { enabled: bool(value.enabled, `${path}.enabled`),
    consentGeneration: integer(value.consentGeneration, 1, Number.MAX_SAFE_INTEGER, `${path}.consentGeneration`),
    capacityReached: bool(value.capacityReached, `${path}.capacityReached`) };
  if (scope === "extension") {
    state.dataGeneration = integer(value.dataGeneration, 1, Number.MAX_SAFE_INTEGER, `${path}.dataGeneration`);
    state.recordCount = integer(value.recordCount, 0, L.records, `${path}.recordCount`);
    state.totalBytes = integer(value.totalBytes, 0, L.totalBytes, `${path}.totalBytes`);
    if (state.capacityReached !== (state.recordCount === L.records || state.totalBytes === L.totalBytes)) fail(E.BAD_DTO, `${path}.capacityReached`);
  }
  return state;
}

function data(method, value, scope, pageLimit) {
  if (method === M.BEGIN_QUERY) {
    object(value, value?.state === "ready" ? ["state", "token"] : ["state"], "data");
    const state = choice(value.state, ["ready", "disabled"], "data.state");
    return state === "ready" ? { state, token: validateOperationToken(value.token) } : { state };
  }
  if ([M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT].includes(method)) {
    object(value, ["state", "recordId", "revision", "artifactId", "duplicate"], "data");
    return { state: choice(value.state, ["saved"], "data.state"), recordId: recordId(value.recordId, "data.recordId"),
      revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, "data.revision"),
      artifactId: id(value.artifactId, "data.artifactId"), duplicate: bool(value.duplicate, "data.duplicate") };
  }
  if ([M.GET_PAGE_SUMMARY, M.LIST_RECORDS].includes(method)) {
    object(value, ["items", "nextCursor"], "data");
    integer(pageLimit, 1, L.pageSize, "response.pageLimit");
    const items = array(value.items, pageLimit,
      method === M.GET_PAGE_SUMMARY ? validatePageSummaryItem : validateReadingRecord, "data.items");
    const nextCursor = nullable(value.nextCursor, (item, path) => text(item, L.cursorChars, path), "data.nextCursor");
    if ((!items.length && nextCursor !== null) || new Set(items.map((item) => item.recordId)).size !== items.length) fail(E.BAD_DTO, "data.items");
    return { items, nextCursor };
  }
  if (method === M.GET_RECORD) return validateRecordDetail(value, "data");
  if ([M.GET_RECORDING_STATE, M.SET_RECORDING].includes(method)) return validateRecordingState(value, scope, "data");
  if (method === M.DELETE_RECORD) {
    object(value, ["deleted"], "data");
    return { deleted: choice(value.deleted, [true], "data.deleted") };
  }
  if ([M.DELETE_PAGE, M.CLEAR_RECORDS].includes(method)) {
    const key = method === M.DELETE_PAGE ? "pageGeneration" : "dataGeneration";
    object(value, ["deletedCount", key], "data");
    return { deletedCount: integer(value.deletedCount, 0, L.records, "data.deletedCount"),
      [key]: integer(value[key], 1, Number.MAX_SAFE_INTEGER, `data.${key}`) };
  }
  if (method === M.EXPORT_JSON) return validateReadingExport(value);
  if (method === M.CREATE_HANDOFF) {
    object(value, value?.state === "ready" ? ["state", "handoff"] : ["state"], "data");
    const state = choice(value.state, ["ready", "permission-required", "unsupported"], "data.state");
    return state === "ready" ? { state, handoff: validateHandoff(value.handoff) } : { state };
  }
  return validatePageSummaryItem(value, "data"); // consume-handoff; future B, no execution here.
}
