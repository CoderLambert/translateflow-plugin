import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { validateReadingRequest } from "../src/shared/reading/dto.js";
import { validateResultArtifact } from "../src/shared/reading/artifact.js";
import { validateSourceSnapshot } from "../src/shared/reading/source.js";
import { validateReadingRecord, validateRecordDetail, validateReadingExport } from "../src/shared/reading/record.js";
import { validateOperationToken, validateHandoff } from "../src/shared/reading/lifecycle.js";
import { artifact, handoff, record, request, snapshot, token } from "./fixtures/reading/contract.mjs";

function rejects(fn, code) { assert.throws(fn, (error) => error.code === code); }
for (const method of Object.values(M)) {
  test(`${method}: valid, invalid and oversized request DTOs`, () => {
    const input = request(method);
    assert.deepEqual(validateReadingRequest(input), input);
    rejects(() => validateReadingRequest({ ...input, tabId: 1 }), E.BAD_DTO);
    rejects(() => validateReadingRequest({ ...input, schemaVersion: 2 }), E.UNSUPPORTED_VERSION);
    rejects(() => validateReadingRequest({ ...input, unknown: "x".repeat(L.requestBytes) }), E.LIMIT);
  });
}
const models = [
  ["SourceSnapshot", validateSourceSnapshot, snapshot(), { selectedText: "x".repeat(L.selectionChars + 1) }],
  ["ReadingRecord", validateReadingRecord, record(), { pageTitle: "x".repeat(L.titleChars + 1) }],
  ["OperationToken", validateOperationToken, token(), { expiresAt: 601001 }],
  ["Handoff", validateHandoff, handoff(), { expiresAt: 61001 }]
];
for (const [name, validate, valid, oversized] of models) {
  test(`${name}: valid, invalid and oversized model DTOs`, () => {
    assert.deepEqual(validate(valid), valid);
    rejects(() => validate({ ...valid, secret: "not permitted" }), E.BAD_DTO);
    rejects(() => validate({ ...valid, ...oversized }), E.LIMIT);
  });
}
for (const kind of ["dictionary", "translation", "assistant"]) {
  test(`${kind} artifact: valid, invalid and byte-limited DTOs`, () => {
    const valid = artifact(kind);
    assert.deepEqual(validateResultArtifact(valid), valid);
    rejects(() => validateResultArtifact({ ...valid, provenance: { apiKey: "synthetic" } }), E.BAD_DTO);
    rejects(() => validateResultArtifact({ ...valid, unknown: "字".repeat(L.artifactBytes / 3) }), E.LIMIT);
  });
}
test("Record detail and export preserve independently readable question, answer and source", () => {
  const detail = { record: record(), snapshots: [snapshot()], artifacts: [artifact(), artifact("translation"), artifact("assistant")] };
  assert.deepEqual(validateRecordDetail(detail), detail);
  assert.equal(validateRecordDetail(detail).artifacts[2].payload.userQuestion, artifact("assistant").payload.userQuestion);
  rejects(() => validateRecordDetail({ ...detail, snapshots: [] }), E.BAD_DTO);
  rejects(() => validateRecordDetail({ ...detail, artifacts: Array.from({ length: L.artifactsPerRecord + 1 }, () => artifact()) }), E.LIMIT);
  const bundle = { format: "translateflow-reading", schemaVersion: 1, exportedAt: 2000, records: [detail] };
  assert.deepEqual(validateReadingExport(bundle), bundle);
  rejects(() => validateReadingExport({ ...bundle, format: "cache" }), E.BAD_DTO);
  rejects(() => validateReadingExport({ ...bundle, records: Array(L.records + 1).fill(detail) }), E.LIMIT);
});
test("No-hit is an actual dictionary result; failures and partial AI are not completed artifacts", () => {
  const noHit = artifact("dictionary", { payload: { ...artifact().payload, outcome: "no-hit", definitions: [] }, provenance: [] });
  assert.equal(validateResultArtifact(noHit).payload.outcome, "no-hit");
  rejects(() => validateResultArtifact(artifact("dictionary", { payload: { ...noHit.payload, outcome: "error" } })), E.BAD_DTO);
  rejects(() => validateResultArtifact(artifact("assistant", { payload: { ...artifact("assistant").payload, completionStatus: "partial" } })), E.BAD_DTO);
  rejects(() => validateResultArtifact(artifact("assistant", { payload: { ...artifact("assistant").payload, userQuestion: "" } })), E.BAD_DTO);
  rejects(() => validateResultArtifact(artifact("dictionary", { provenance: [] })), E.BAD_DTO);
});
test("Field bounds, source consistency and operation purpose reject unsafe DTOs", () => {
  rejects(() => validateReadingRequest(request(M.LIST_RECORDS, { limit: L.pageSize + 1 })), E.LIMIT);
  rejects(() => validateReadingRequest(request(M.LIST_RECORDS, { query: "x".repeat(L.searchChars + 1) })), E.LIMIT);
  rejects(() => validateSourceSnapshot(snapshot({ contextText: "x".repeat(L.contextChars + 1) })), E.LIMIT);
  rejects(() => validateSourceSnapshot(snapshot({ contextMode: "selection-only" })), E.BAD_DTO);
  rejects(() => validateSourceSnapshot(snapshot({ projectionVersion: "w3c-codepoint" })), E.UNSUPPORTED_VERSION);
  rejects(() => validateReadingRequest(request(M.BEGIN_QUERY, { itemText: "different source" })), E.BAD_DTO);
  rejects(() => validateReadingRequest(request(M.APPEND_ASSISTANT, { token: token() })), E.BAD_DTO);
  rejects(() => validateReadingRequest(request(M.SAVE_QUERY_RESULT, { artifact: artifact("translation", { operationId: "op-2" }) })), E.BAD_DTO);
  rejects(() => validateReadingRecord(record({ itemKey: "case-folded" })), E.BAD_DTO);
});
test("Provider and dictionary payloads never admit raw HTML, resources or credentials", () => {
  for (const extra of ["html", "css", "resourceUrl", "apiKey", "endpoint"]) {
    rejects(() => validateResultArtifact(artifact("dictionary", { payload: { ...artifact().payload, [extra]: "synthetic" } })), E.BAD_DTO);
  }
  rejects(() => validateReadingRequest({ schemaVersion: 1, method: M.EXPORT_JSON, callerScope: "extension" }), E.BAD_DTO);
  rejects(() => validateReadingRequest(undefined), E.BAD_DTO);
  const cyclic = {}; cyclic.self = cyclic;
  rejects(() => validateReadingRequest(cyclic), E.BAD_DTO);
});
test("Artifact UTF-8 byte boundary is exact independently of answer character count", () => {
  const base = artifact("assistant", { payload: { ...artifact("assistant").payload, assistantAnswer: "字".repeat(21000) } });
  const currentBytes = new TextEncoder().encode(JSON.stringify(base)).length;
  const padding = L.artifactBytes - currentBytes;
  assert.ok(padding > 0);
  const exact = { ...base, payload: { ...base.payload, assistantAnswer: `${base.payload.assistantAnswer}${"x".repeat(padding)}` } };
  assert.equal(new TextEncoder().encode(JSON.stringify(exact)).length, L.artifactBytes);
  assert.equal(validateResultArtifact(exact).payload.assistantAnswer.length, 21000 + padding);
  rejects(() => validateResultArtifact({ ...exact, payload: { ...exact.payload, assistantAnswer: `${exact.payload.assistantAnswer}x` } }), E.LIMIT);
});

test("ReadingRecord and source anchors both reject spans inconsistent with UTF-16 quote length", () => {
  const wrong = { ...snapshot().anchor, position: { start: 0, end: 1 } };
  rejects(() => validateReadingRecord(record({ anchor: wrong })), E.BAD_DTO);
  rejects(() => validateSourceSnapshot(snapshot({ anchor: wrong })), E.BAD_DTO);
  const itemText = "😀e\u0301";
  const anchor = { ...snapshot().anchor, quote: { exact: itemText, prefix: "", suffix: "" },
    position: { start: 10, end: 10 + itemText.length } };
  const value = record({ itemText, itemKey: `ri1:${JSON.stringify(["en", itemText.normalize("NFC")])}`, anchor });
  assert.equal(validateReadingRecord(value).anchor.position.end, 14);
  rejects(() => validateReadingRecord({ ...value, anchor: { ...anchor, position: { start: 10, end: 13 } } }), E.BAD_DTO);
});
