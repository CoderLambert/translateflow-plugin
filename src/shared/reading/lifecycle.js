import { byteLength } from "../hash.js";
import { READING_CONTENT_METHODS, READING_ERROR, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { bool, choice, fail, id, integer, object, pageKey, recordId } from "./validation.js";

export function validateOperationToken(value, path = "token") {
  const keys = ["operationId", "purpose", "consentGeneration", "dataGeneration", "pageGeneration", "pageKey", "documentGeneration",
    "selectionGeneration", "recordId", "recordRevision", "issuedAt", "expiresAt"];
  object(value, keys, path);
  const issuedAt = integer(value.issuedAt, 0, Number.MAX_SAFE_INTEGER, `${path}.issuedAt`);
  const expiresAt = integer(value.expiresAt, issuedAt + 1, Number.MAX_SAFE_INTEGER, `${path}.expiresAt`);
  if (expiresAt - issuedAt > L.operationTtlMs) fail(READING_ERROR.LIMIT, `${path}.expiresAt`);
  const result = { operationId: id(value.operationId, `${path}.operationId`), purpose: choice(value.purpose, ["lookup", "assistant"], `${path}.purpose`), pageKey: pageKey(value.pageKey, `${path}.pageKey`),
    documentGeneration: id(value.documentGeneration, `${path}.documentGeneration`),
    recordId: recordId(value.recordId, `${path}.recordId`), issuedAt, expiresAt };
  for (const key of ["consentGeneration", "dataGeneration", "pageGeneration", "selectionGeneration", "recordRevision"]) {
    result[key] = integer(value[key], key === "recordRevision" ? 0 : 1, Number.MAX_SAFE_INTEGER, `${path}.${key}`);
  }
  return result;
}

// state and access must be constructed by the background, never from caller DTOs.
export function checkOperationScope(tokenValue, state, now) {
  const token = validateOperationToken(tokenValue);
  integer(now, 0, Number.MAX_SAFE_INTEGER, "now");
  if (!state?.enabled) fail(READING_ERROR.DISABLED, "recording");
  for (const key of ["operationId", "purpose", "issuedAt", "expiresAt", "consentGeneration", "dataGeneration", "pageGeneration", "documentGeneration", "selectionGeneration"]) {
    if (state[key] !== token[key]) fail(READING_ERROR.STALE_OPERATION, `token.${key}`);
  }
  if (state.pageKey !== token.pageKey || state.recordId !== token.recordId || state.deleted ||
      now < token.issuedAt || now >= token.expiresAt) fail(READING_ERROR.STALE_OPERATION, "token");
  return token;
}
export function checkWriteEligibility(tokenValue, state, now) {
  const token = checkOperationScope(tokenValue, state, now);
  if (state.recordRevision !== token.recordRevision) fail(READING_ERROR.REVISION_CONFLICT, "token.recordRevision");
  return true;
}

const CONTENT_METHODS = new Set(READING_CONTENT_METHODS);
const WRITE_METHODS = new Set([M.BEGIN_QUERY, M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT]);
export function authorizeReadingMethod(method, access, resourcePageKey = null) {
  if (!Object.values(M).includes(method)) fail(READING_ERROR.BAD_DTO, "method");
  if (!access || access.incognito !== false) fail(READING_ERROR.FORBIDDEN, "access.incognito");
  if (access.scope === "extension" && access.allowlisted === true) return true;
  if (access.scope !== "content" || access.senderVerified !== true || !CONTENT_METHODS.has(method) ||
      !access.documentGeneration || !access.pageKey) fail(READING_ERROR.FORBIDDEN, "access.scope");
  if ([M.BEGIN_QUERY, M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT, M.GET_RECORD, M.CONSUME_HANDOFF].includes(method) && resourcePageKey === null) fail(READING_ERROR.FORBIDDEN, "access.resource");
  if (resourcePageKey !== null && resourcePageKey !== access.pageKey) fail(READING_ERROR.FORBIDDEN, "access.pageKey");
  if (access.sensitive !== false || access.editable !== false || access.accountPage !== false ||
      (WRITE_METHODS.has(method) && access.siteExcluded !== false)) fail(READING_ERROR.FORBIDDEN, "access.policy");
  return true;
}
export function checkCapacity({ recordCount, totalBytes, addedRecords = 0, addedBytes = 0 }) {
  for (const [key, value] of Object.entries({ recordCount, totalBytes, addedRecords, addedBytes })) {
    integer(value, 0, Number.MAX_SAFE_INTEGER, key);
  }
  if (recordCount + addedRecords > L.records || totalBytes + addedBytes > L.totalBytes) fail(READING_ERROR.CAPACITY, "capacity");
  return { recordCount: recordCount + addedRecords, totalBytes: totalBytes + addedBytes };
}
export function applicationBytes(rows) {
  if (!Array.isArray(rows)) fail(READING_ERROR.BAD_DTO, "rows");
  return rows.reduce((total, row) => {
    let encoded;
    try { encoded = JSON.stringify(row); } catch { fail(READING_ERROR.BAD_DTO, "rows"); }
    if (encoded === undefined) fail(READING_ERROR.BAD_DTO, "rows");
    return total + byteLength(encoded);
  }, 0);
}
export function validateHandoff(value, path = "handoff") {
  object(value, ["handoffId", "recordId", "recordRevision", "tabId", "pageKey", "documentGeneration",
    "generation", "issuedAt", "expiresAt", "consumed"], path);
  const issuedAt = integer(value.issuedAt, 0, Number.MAX_SAFE_INTEGER, `${path}.issuedAt`);
  const expiresAt = integer(value.expiresAt, issuedAt + 1, Number.MAX_SAFE_INTEGER, `${path}.expiresAt`);
  if (expiresAt - issuedAt > L.handoffTtlMs) fail(READING_ERROR.LIMIT, `${path}.expiresAt`);
  return { handoffId: id(value.handoffId, `${path}.handoffId`), recordId: recordId(value.recordId, `${path}.recordId`),
    recordRevision: integer(value.recordRevision, 1, Number.MAX_SAFE_INTEGER, `${path}.recordRevision`),
    tabId: integer(value.tabId, 0, Number.MAX_SAFE_INTEGER, `${path}.tabId`), pageKey: pageKey(value.pageKey, `${path}.pageKey`),
    documentGeneration: id(value.documentGeneration, `${path}.documentGeneration`),
    generation: integer(value.generation, 1, Number.MAX_SAFE_INTEGER, `${path}.generation`), issuedAt, expiresAt,
    consumed: bool(value.consumed, `${path}.consumed`) };
}
export function checkHandoff(handoffValue, current, now) {
  const handoff = validateHandoff(handoffValue);
  integer(now, 0, Number.MAX_SAFE_INTEGER, "now");
  if (handoff.consumed || now < handoff.issuedAt || now >= handoff.expiresAt) fail(READING_ERROR.HANDOFF_EXPIRED, "handoff");
  for (const key of ["recordId", "recordRevision", "tabId", "pageKey", "documentGeneration", "generation"]) {
    if (handoff[key] !== current?.[key]) fail(READING_ERROR.STALE_OPERATION, `handoff.${key}`);
  }
  if (current.deleted || current.incognito !== false || current.permissionGranted !== true) fail(READING_ERROR.FORBIDDEN, "handoff.access");
  return true;
}
