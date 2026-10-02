import { READING_CONTENT_METHODS, READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { validateHandoff, validateOperationToken } from "./lifecycle.js";
import { validateRecordDetail } from "./record.js";
import { validateExportResponse } from "./export.js";
import { revision, validateExclusionItem, validateListPage, validatePageListItem, validatePageSummaryItem, validateRecordListItem } from "./list.js";
import { bool, choice, fail, id, integer, jsonBytes, nullable, object, pageKey, protocolVersion, recordId, siteKey } from "./validation.js";
export { validatePageSummaryItem } from "./list.js";

// The trusted adapter supplies scope; a caller cannot declare it. These validators prove syntax only.
export function validateReadingResponse(method, value, scope, pageLimit = L.pageSize) {
  choice(method, Object.values(M), "response.method");
  choice(scope, ["content", "extension", "entry"], "response.scope");
  jsonBytes(value, method === M.GET_RECORD ? L.detailResponseBytes : L.listResponseBytes, "response");
  object(value, value?.ok === true ? ["protocolVersion", "ok", "data"] : ["protocolVersion", "ok", "error"], "response");
  const transportVersion = protocolVersion(value.protocolVersion, "response.protocolVersion");
  if (!bool(value.ok, "response.ok")) {
    object(value.error, ["code"], "response.error");
    return { protocolVersion: transportVersion, ok: false, error: { code: choice(value.error.code, Object.values(E), "response.error.code") } };
  }
  if ((scope === "content" && !READING_CONTENT_METHODS.includes(method)) ||
      (scope === "entry" && method !== M.OPEN_LEARNING_CENTER)) fail(E.FORBIDDEN, "response.scope");
  return { protocolVersion: transportVersion, ok: true, data: data(method, value.data, scope, pageLimit) };
}
export function validateRecordingState(value, scope, path = "recordingState") {
  choice(scope, ["content", "extension"], `${path}.scope`);
  const fields = ["enabled", "consentGeneration", "capacityReached"];
  if (scope === "extension") fields.push("dataGeneration", "recordCount", "totalBytes");
  object(value, fields, path);
  const state = { enabled: bool(value.enabled, `${path}.enabled`), consentGeneration: revision(value.consentGeneration, `${path}.consentGeneration`),
    capacityReached: bool(value.capacityReached, `${path}.capacityReached`) };
  if (scope === "extension") {
    state.dataGeneration = revision(value.dataGeneration, `${path}.dataGeneration`);
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
      revision: revision(value.revision, "data.revision"), artifactId: id(value.artifactId, "data.artifactId"), duplicate: bool(value.duplicate, "data.duplicate") };
  }
  if (method === M.GET_PAGE_SUMMARY) {
    const result = validateListPage(value, validatePageSummaryItem, "recordId", pageLimit,
      { pageRecordCount: (v, p) => integer(v, 0, L.records, p), pageRevision: revision });
    if (result.items.length > result.pageRecordCount) fail(E.BAD_DTO, "data.pageRecordCount");
    return result;
  }
  if (method === M.LIST_RECORDS) return validateListPage(value, validateRecordListItem, "recordId", pageLimit, { catalogRevision: revision });
  if (method === M.LIST_PAGES) return validateListPage(value, validatePageListItem, "pageKey", pageLimit, { catalogRevision: revision });
  if (method === M.LIST_RECORDING_EXCLUSIONS) return validateListPage(value, validateExclusionItem, "siteKey", pageLimit, {});
  if (method === M.GET_RECORD) return validateRecordDetail(value, "data");
  if ([M.GET_RECORDING_STATE, M.SET_RECORDING].includes(method)) return validateRecordingState(value, scope, "data");
  if ([M.GET_SITE_RECORDING, M.SET_SITE_RECORDING].includes(method)) {
    object(value, ["excluded", "sitePolicyRevision"], "data");
    return { excluded: bool(value.excluded, "data.excluded"), sitePolicyRevision: revision(value.sitePolicyRevision, "data.sitePolicyRevision") };
  }
  if (method === M.DELETE_RECORD) {
    object(value, ["deleted"], "data");
    return { deleted: choice(value.deleted, [true], "data.deleted") };
  }
  if ([M.DELETE_PAGE, M.CLEAR_RECORDS].includes(method)) {
    const key = method === M.DELETE_PAGE ? "pageGeneration" : "dataGeneration";
    object(value, ["deletedCount", key], "data");
    return { deletedCount: integer(value.deletedCount, 0, L.records, "data.deletedCount"), [key]: revision(value[key], `data.${key}`) };
  }
  if ([M.EXPORT_START, M.EXPORT_NEXT, M.EXPORT_FINISH, M.EXPORT_CANCEL].includes(method)) return validateExportResponse(method, value);
  if (method === M.OPEN_LEARNING_CENTER) {
    object(value, ["opened"], "data");
    return { opened: choice(value.opened, [true], "data.opened") };
  }
  if (method === M.REGISTER_DOCUMENT) {
    object(value, ["documentGeneration", "navigationGeneration", "pageKey", "siteKey"], "data");
    return { documentGeneration: id(value.documentGeneration, "data.documentGeneration"), navigationGeneration: revision(value.navigationGeneration, "data.navigationGeneration"),
      pageKey: pageKey(value.pageKey, "data.pageKey"), siteKey: siteKey(value.siteKey, "data.siteKey") };
  }
  if (method === M.CANCEL_OPERATION) {
    object(value, ["operationId", "state", "recordId", "revision"], "data");
    const state = choice(value.state, ["cancelled", "committed"], "data.state");
    const savedId = nullable(value.recordId, recordId, "data.recordId");
    const savedRevision = nullable(value.revision, revision, "data.revision");
    if ((savedId === null) !== (savedRevision === null) || (state === "committed" && savedId === null)) fail(E.BAD_DTO, "data.recordId");
    return { operationId: id(value.operationId, "data.operationId"), state, recordId: savedId, revision: savedRevision };
  }
  if (method === M.CREATE_HANDOFF) {
    object(value, value?.state === "ready" ? ["state", "handoff"] : ["state"], "data");
    const state = choice(value.state, ["ready", "permission-required", "unsupported"], "data.state");
    return state === "ready" ? { state, handoff: validateHandoff(value.handoff) } : { state };
  }
  return validatePageSummaryItem(value, "data");
}
