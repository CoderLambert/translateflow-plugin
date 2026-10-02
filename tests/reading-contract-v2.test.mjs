import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { validateReadingRequest } from "../src/shared/reading/dto.js";
import { validateReadingResponse } from "../src/shared/reading/response.js";
import { validateRecordDetail } from "../src/shared/reading/record.js";
import { projectRecordListItem } from "../src/shared/reading/previews.js";
import { siteKey } from "../src/shared/reading/validation.js";
import { artifact, pageListItem, record, recordListItem, request, response, snapshot } from "./fixtures/reading/contract.mjs";
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);

test("Protocol 2 is singular; old export-json is rejected while stored schema 1 remains readable", () => {
  for (const protocolVersion of [undefined, 1, 3, "2"]) rejects(() => validateReadingRequest({ ...request(M.EXPORT_START), protocolVersion }), E.UNSUPPORTED_VERSION);
  rejects(() => validateReadingRequest({ schemaVersion: 1, method: "reading.export-json" }), E.UNSUPPORTED_VERSION);
  rejects(() => validateReadingRequest({ protocolVersion: 2, method: "reading.export-json" }), E.BAD_DTO);
  rejects(() => validateReadingRequest({ ...request(M.EXPORT_START), schemaVersion: 1 }), E.BAD_DTO);
  rejects(() => validateReadingResponse(M.EXPORT_START, { ...response(M.EXPORT_START), protocolVersion: 1 }, "extension"), E.UNSUPPORTED_VERSION);
  assert.equal(validateRecordDetail({ record: record(), snapshots: [snapshot()], artifacts: [artifact()] }).record.schemaVersion, 1);
});
test("Minimal current-page summary has counts/revision/assistant flag without URLs, context or global counts", () => {
  for (const field of ["recordCount", "catalogRevision", "safeReturnUrl", "siteKey", "contextText", "artifacts"]) {
    rejects(() => validateReadingResponse(M.GET_PAGE_SUMMARY, response(M.GET_PAGE_SUMMARY, "content", { data: { ...response(M.GET_PAGE_SUMMARY).data, [field]: "private" } }), "content"), E.BAD_DTO);
  }
  rejects(() => validateReadingResponse(M.GET_PAGE_SUMMARY, response(M.GET_PAGE_SUMMARY, "content", { data: { ...response(M.GET_PAGE_SUMMARY).data, pageRecordCount: 0 } }), "content"), E.BAD_DTO);
  const item = response(M.GET_PAGE_SUMMARY).data.items[0]; delete item.hasCompletedAssistant;
  rejects(() => validateReadingResponse(M.GET_PAGE_SUMMARY, response(M.GET_PAGE_SUMMARY, "content", { data: { ...response(M.GET_PAGE_SUMMARY).data, items: [item] } }), "content"), E.BAD_DTO);
});
test("Record preview derives latest completed artifact and that exact snapshot; no-hit is honest", () => {
  const s2 = snapshot({ sourceSnapshotId: "source-2", contextText: "New frozen context" });
  const t = artifact("translation", { artifactId: "z-last", sourceSnapshotId: "source-2", createdAt: 1001 });
  const detail = { record: record(), snapshots: [snapshot(), s2], artifacts: [t, artifact()] };
  const projected = projectRecordListItem(detail, "https://example.test");
  assert.equal(projected.resultPreview.artifactId, "z-last"); assert.equal(projected.contextPreview, s2.contextText);
  const noHit = artifact("dictionary", { payload: { ...artifact().payload, outcome: "no-hit", definitions: [] }, provenance: [] });
  assert.equal(projectRecordListItem({ ...detail, artifacts: [noHit] }, "https://example.test").resultPreview.text, "No dictionary result");
  const long = artifact("translation", { payload: { text: "字".repeat(239) + "😀tail" } });
  const preview = projectRecordListItem({ ...detail, artifacts: [long] }, "https://example.test").resultPreview;
  assert.equal(preview.text.length, 239); assert.equal(preview.truncated, true);
  for (const key of ["artifacts", "snapshots", "provenance", "providerConfigFingerprint"]) {
    rejects(() => validateReadingResponse(M.LIST_RECORDS, response(M.LIST_RECORDS, "extension", { data: { items: [recordListItem({ [key]: "private" })], nextCursor: null, catalogRevision: 1 } }), "extension"), E.BAD_DTO);
  }
});
test("List-pages and exclusions are bounded, duplicate-free, with opaque terminal cursors", () => {
  for (const method of [M.LIST_PAGES, M.LIST_RECORDING_EXCLUSIONS]) {
    const item = response(method).data.items[0], extras = method === M.LIST_PAGES ? { catalogRevision: 1 } : {};
    assert.deepEqual(validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [], nextCursor: null, ...extras } }, "extension").data.items, []);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [item, item], nextCursor: null, ...extras } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingResponse(method, { protocolVersion: 2, ok: true, data: { items: [], nextCursor: "stale", ...extras } }, "extension"), E.BAD_DTO);
    rejects(() => validateReadingRequest(request(method, { cursor: "x".repeat(257) })), E.LIMIT);
  }
  for (const bad of ["https://example.test/", "HTTPS://example.test", "https://example.test:443", "https://u:p@example.test", "https://example.test?q=1", "file:///x", "https://example.test#x"]) rejects(() => siteKey(bad, "site"), E.BAD_DTO);
  assert.equal(siteKey("http://example.test:8080", "site"), "http://example.test:8080");
  assert.equal(validateReadingRequest(request(M.LIST_PAGES, { limit: undefined })).limit, 30);
});
test("Both raw UTF-8 fragment and escaped full response limits apply; surrogate boundaries are intact", () => {
  const base = response(M.EXPORT_NEXT).data;
  const next = (jsonChunk) => ({ protocolVersion: 2, ok: true, data: { ...base, jsonChunk } });
  assert.equal(validateReadingResponse(M.EXPORT_NEXT, next("字".repeat(Math.floor(L.exportChunkBytes / 3))), "extension").data.sequence, 0);
  rejects(() => validateReadingResponse(M.EXPORT_NEXT, next("字".repeat(Math.floor(L.exportChunkBytes / 3) + 1)), "extension"), E.LIMIT);
  // ASCII control characters expand sixfold in JSON; raw chunk bound alone would be insufficient.
  rejects(() => validateReadingResponse(M.EXPORT_NEXT, next("\u0001".repeat(L.exportChunkBytes)), "extension"), E.LIMIT);
  for (const bad of ["abc\uD83D", "\uDE00abc"]) rejects(() => validateReadingResponse(M.EXPORT_NEXT, next(bad), "extension"), E.BAD_DTO);
  assert.equal(validateReadingResponse(M.EXPORT_NEXT, next("😀"), "extension").data.jsonChunk, "😀");
  rejects(() => validateReadingResponse(M.EXPORT_NEXT, { ...next("end"), data: { ...base, jsonChunk: "end", done: true } }, "extension"), E.BAD_DTO);
  assert.equal(validateReadingResponse(M.EXPORT_NEXT, { ...next("end"), data: { ...base, jsonChunk: "end", done: true, nextCursor: null } }, "extension").data.done, true);
});
test("D domain fixtures preserve root action and branch; follow-up regeneration is never production-enabled", () => {
  for (const action of ["understand", "analyze", "usage"]) {
    const root = artifact("assistant", { payload: { ...artifact("assistant").payload, action } });
    const follow = { ...root, artifactId: "follow", createdAt: 1002, payload: { ...root.payload, turnId: "turn-2", action: "follow-up", parentTurnId: "turn-1" } };
    const regen = { ...root, artifactId: "regen", createdAt: 1003, payload: { ...root.payload, turnId: "turn-3", branchId: "branch-2", regenerationOf: "turn-1" } };
    const detail = { record: record(), snapshots: [snapshot()], artifacts: [root, follow, regen] };
    assert.equal(validateRecordDetail(detail).artifacts[1].payload.parentTurnId, "turn-1");
    rejects(() => validateRecordDetail({ ...detail, artifacts: [root, { ...regen, payload: { ...regen.payload, action: action === "usage" ? "analyze" : "usage" } }] }), E.BAD_DTO);
    rejects(() => validateRecordDetail({ ...detail, artifacts: [root, follow, { ...regen, payload: { ...regen.payload, regenerationOf: "turn-2" } }] }), E.BAD_DTO);
  }
});

test("A legal maximum-cardinality escaped detail stays below the separate 32MiB message ceiling", () => {
  const selected = `x${"\u0001".repeat(L.selectionChars - 1)}`;
  const longSnapshot = snapshot({ selectedText: selected, contextText: `x${"\u0001".repeat(L.contextChars - 1)}`,
    anchor: { ...snapshot().anchor, quote: { exact: selected, prefix: "\u0001".repeat(L.quoteContextChars), suffix: "\u0001".repeat(L.quoteContextChars) }, position: { start: 0, end: selected.length } } });
  const r = record({ itemText: selected, itemKey: `ri1:${JSON.stringify(["en", selected])}`, anchor: longSnapshot.anchor });
  const snapshots = Array.from({ length: L.snapshotsPerRecord }, (_, i) => ({ ...longSnapshot, sourceSnapshotId: `source-${i}` }));
  const base = artifact("translation", { sourceSnapshotId: "source-0", payload: { text: `x${"\u0001".repeat(10000)}` } });
  const artifacts = Array.from({ length: L.artifactsPerRecord }, (_, i) => {
    const value = { ...base, artifactId: `artifact-${i}` }, current = new TextEncoder().encode(JSON.stringify(value)).length;
    value.payload = { text: `${base.payload.text}${"x".repeat(L.artifactBytes - current)}` }; return value;
  });
  const envelope = { protocolVersion: 2, ok: true, data: { record: r, snapshots, artifacts } };
  assert.ok(new TextEncoder().encode(JSON.stringify(envelope)).length < L.detailResponseBytes);
  assert.equal(validateReadingResponse(M.GET_RECORD, envelope, "extension").data.artifacts.length, 256);
  // List allocation is an independent bound; count≤100 alone does not permit >1MiB escaped text.
  const items = Array.from({ length: 100 }, (_, i) => recordListItem({ recordId: `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`, itemText: selected }));
  rejects(() => validateReadingResponse(M.LIST_RECORDS, { protocolVersion: 2, ok: true, data: { items, nextCursor: null, catalogRevision: 1 } }, "extension"), E.LIMIT);
});
