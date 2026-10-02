import test from "node:test";
import assert from "node:assert/strict";
import { READING_CONTENT_METHODS, READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { validatePageSummaryItem, validateReadingResponse } from "../src/shared/reading/response.js";
import { pageSummaryItem, recordingState, response, token } from "./fixtures/reading/contract.mjs";

const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);
const oversized = (method, valid) => {
  const data = valid.data;
  if (method === M.BEGIN_QUERY) return { ...data, token: token({ operationId: "x".repeat(L.idChars + 1) }) };
  if ([M.SAVE_QUERY_RESULT, M.APPEND_ASSISTANT].includes(method)) return { ...data, artifactId: "x".repeat(L.idChars + 1) };
  if ([M.GET_PAGE_SUMMARY, M.LIST_RECORDS].includes(method)) return { ...data, items: Array(L.pageSize + 1).fill(data.items[0]) };
  if (method === M.GET_RECORD) return { ...data, snapshots: Array(L.snapshotsPerRecord + 1).fill(data.snapshots[0]) };
  if ([M.GET_RECORDING_STATE, M.SET_RECORDING].includes(method)) return recordingState("extension", { recordCount: L.records + 1 });
  if ([M.DELETE_PAGE, M.CLEAR_RECORDS].includes(method)) return { ...data, deletedCount: L.records + 1 };

  if (method === M.CREATE_HANDOFF) return { ...data, handoff: { ...data.handoff, expiresAt: 61001 } };
  if (method === M.CONSUME_HANDOFF) return { ...data, anchor: { ...data.anchor, quote: { ...data.anchor.quote, exact: "x".repeat(L.selectionChars + 1) } } };
  return { ...data, unexpected: "x".repeat(L.totalBytes + 1024 * 1024) }; // Boolean-only deletion receipt still has a whole-envelope byte ceiling.
};

for (const method of Object.values(M)) {
  test(`${method}: exact success/error response envelopes and bounded data`, () => {
    const valid = response(method);
    assert.deepEqual(validateReadingResponse(method, valid, "extension"), valid);
    rejects(() => validateReadingResponse(method, { ...valid, method }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { ...valid, data: { ...valid.data, extra: true } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { ...valid, data: oversized(method, valid) }, "extension"), E.LIMIT);
    for (const code of Object.values(E)) {
      const error = { protocolVersion: 2, ok: false, error: { code } };
      assert.deepEqual(validateReadingResponse(method, error, "extension"), error);
      assert.deepEqual(validateReadingResponse(method, error, "content"), error);
    }
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: false, error: { code: "UNKNOWN" } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: false, data: valid.data, error: { code: E.STORAGE } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: false, error: { code: E.STORAGE, message: "private context" } }, "extension"), E.BAD_DTO);
  });
}

test("Content automatic responses stay minimal while explicit RecordDetail remains available", () => {
  for (const method of READING_CONTENT_METHODS) assert.deepEqual(validateReadingResponse(method, response(method, "content"), "content"), response(method, "content"));
  for (const method of Object.values(M).filter((value) => !READING_CONTENT_METHODS.includes(value))) {
    rejects(() => validateReadingResponse(method, response(method), "content"), E.FORBIDDEN);
  }
  for (const key of ["pageKey", "safeReturnUrl", "pageTitle", "contextText", "artifacts", "sourceSnapshot", "lookupCount", "totalBytes"]) {
    rejects(() => validatePageSummaryItem(pageSummaryItem({ [key]: "private" })), E.BAD_DTO);
  }
  // Full detail remains available only after the service validates an explicit, matching-page read.
  assert.deepEqual(validateReadingResponse(M.GET_RECORD, response(M.GET_RECORD), "content"), response(M.GET_RECORD));
  for (const key of ["recordCount", "totalBytes", "dataGeneration", "siteExclusions"]) {
    rejects(() => validateReadingResponse(M.GET_RECORDING_STATE,
      response(M.GET_RECORDING_STATE, "content", { data: recordingState("content", { [key]: 1 }) }), "content"), E.BAD_DTO);
  }
  rejects(() => validateReadingResponse(M.GET_PAGE_SUMMARY, response(M.GET_PAGE_SUMMARY), undefined), E.BAD_DTO);
  rejects(() => validateReadingResponse("unknown-method", response(M.GET_PAGE_SUMMARY), "content"), E.BAD_DTO);
});

test("Pagination accepts empty/final/full pages and rejects duplicates, oversized cursors and caller limit overruns", () => {
  for (const method of [M.GET_PAGE_SUMMARY, M.LIST_RECORDS]) {
    const item = response(method).data.items[0];
    const full = Array.from({ length: L.pageSize }, (_, index) => ({ ...item,
      recordId: `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111` }));
    const extra = method === M.GET_PAGE_SUMMARY ? { pageRecordCount: L.pageSize, pageRevision: 1 } : { catalogRevision: 1 };
    for (const data of [{ items: [], nextCursor: null, ...extra }, { items: full, nextCursor: "opaque-next-page", ...extra }]) {
      assert.deepEqual(validateReadingResponse(method, { protocolVersion: 2, ok: true, data }, "extension").data, data);
    }
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [], nextCursor: "next", ...extra } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [item, item], nextCursor: null, ...extra } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: full, nextCursor: null, ...extra } }, "extension", 20), E.LIMIT);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [item], nextCursor: "x".repeat(L.cursorChars + 1), ...extra } }, "extension"), E.LIMIT);
  }
});

test("Disabled begin and future handoff branches have exact shapes, without exposing a token on failure", () => {
  assert.deepEqual(validateReadingResponse(M.BEGIN_QUERY, { protocolVersion: 2, ok: true, data: { state: "disabled" } }, "content"), { protocolVersion: 2, ok: true, data: { state: "disabled" } });
  rejects(() => validateReadingResponse(M.BEGIN_QUERY, { protocolVersion: 2, ok: true, data: { state: "disabled", token: token() } }, "content"), E.BAD_DTO);
  for (const state of ["permission-required", "unsupported"]) {
    assert.equal(validateReadingResponse(M.CREATE_HANDOFF, { protocolVersion: 2, ok: true, data: { state } }, "extension").data.state, state);
    rejects(() => validateReadingResponse(M.CREATE_HANDOFF, { protocolVersion: 2, ok: true, data: { state, handoff: response(M.CREATE_HANDOFF).data.handoff } }, "extension"), E.BAD_DTO);
  }
  rejects(() => validateReadingResponse(M.DELETE_RECORD, { protocolVersion: 2, ok: true, data: { deleted: false } }, "extension"), E.BAD_DTO);
  rejects(() => validateReadingResponse(M.GET_RECORDING_STATE, { protocolVersion: 2, ok: true, data: recordingState("extension", { capacityReached: true }) }, "extension"), E.BAD_DTO);
});
