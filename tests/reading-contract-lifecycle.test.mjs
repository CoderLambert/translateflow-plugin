import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "../src/shared/reading/constants.js";
import { applicationBytes, authorizeReadingMethod, checkCapacity, checkHandoff, checkOperationScope, checkWriteEligibility } from "../src/shared/reading/lifecycle.js";
import { assertArtifactSource, createReadingItemKey, createSourceDigest, sameProvenLocation, sameSelectionIdentity } from "../src/shared/reading/identity.js";
import { validateSourceSnapshot, projectSourceSegments } from "../src/shared/reading/source.js";
import { validateRecordDetail } from "../src/shared/reading/record.js";
import { safeReturnUrl } from "../src/shared/reading/validation.js";
import { artifact, handoff, PAGE_KEY, record, snapshot, token } from "./fixtures/reading/contract.mjs";

const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);
function writeState(overrides = {}) { return { ...token(), enabled: true, deleted: false, ...overrides }; }
function access(overrides = {}) { return { scope: "content", incognito: false, senderVerified: true,
  documentGeneration: "doc-1", pageKey: PAGE_KEY, sensitive: false, editable: false, accountPage: false, siteExcluded: false, ...overrides }; }

test("Clear, page delete, pause, selection change and record delete defeat late writes", () => {
  assert.equal(checkWriteEligibility(token(), writeState(), 1001), true);
  for (const key of ["consentGeneration", "dataGeneration", "pageGeneration", "documentGeneration", "selectionGeneration"]) {
    rejects(() => checkWriteEligibility(token(), writeState({ [key]: key === "documentGeneration" ? "doc-2" : 2 }), 1001), E.STALE_OPERATION);
  }
  rejects(() => checkWriteEligibility(token({ purpose: "assistant" }), writeState(), 1001), E.STALE_OPERATION);
  rejects(() => checkWriteEligibility(token({ expiresAt: 600999 }), writeState(), 1001), E.STALE_OPERATION);
  rejects(() => checkWriteEligibility(token(), writeState({ enabled: false }), 1001), E.DISABLED);
  rejects(() => checkWriteEligibility(token(), writeState({ deleted: true }), 1001), E.STALE_OPERATION);
  rejects(() => checkWriteEligibility(token(), writeState(), 601000), E.STALE_OPERATION);
  rejects(() => checkWriteEligibility(token(), writeState(), 999), E.STALE_OPERATION);
  rejects(() => checkWriteEligibility(token(), writeState({ recordRevision: 1 }), 1001), E.REVISION_CONFLICT);
  // A persisted matching receipt may be returned after scope checks, without a second lookup increment.
  assert.equal(checkOperationScope(token(), writeState({ recordRevision: 1 }), 1001).operationId, "op-1");
  // A newly explicit operation after clear has a new generation; retrying the old token is still rejected.
  assert.equal(checkWriteEligibility(token({ dataGeneration: 2, operationId: "op-2" }), writeState({ dataGeneration: 2, operationId: "op-2" }), 1001), true);
});
test("Content is page-scoped; only a precise trusted extension page may list/export/control", () => {
  assert.equal(authorizeReadingMethod(M.GET_PAGE_SUMMARY, access()), true);
  assert.equal(authorizeReadingMethod(M.GET_RECORD, access(), PAGE_KEY), true);
  rejects(() => authorizeReadingMethod(M.GET_RECORD, access()), E.FORBIDDEN);
  rejects(() => authorizeReadingMethod(M.GET_RECORD, access(), `rp1:${"d".repeat(64)}`), E.FORBIDDEN);
  for (const method of [M.EXPORT_JSON, M.LIST_RECORDS, M.CLEAR_RECORDS, M.DELETE_PAGE, M.DELETE_RECORD, M.SET_RECORDING]) {
    rejects(() => authorizeReadingMethod(method, access(), PAGE_KEY), E.FORBIDDEN);
    assert.equal(authorizeReadingMethod(method, { scope: "extension", incognito: false, allowlisted: true }), true);
    rejects(() => authorizeReadingMethod(method, { scope: "extension", incognito: true, allowlisted: true }), E.FORBIDDEN);
    rejects(() => authorizeReadingMethod(method, { scope: "extension", incognito: false, allowlisted: false }), E.FORBIDDEN);
  }
  for (const flag of ["sensitive", "editable", "accountPage", "incognito"]) {
    rejects(() => authorizeReadingMethod(M.GET_PAGE_SUMMARY, access({ [flag]: true })), E.FORBIDDEN);
  }
  rejects(() => authorizeReadingMethod(M.SAVE_QUERY_RESULT, access({ siteExcluded: true }), PAGE_KEY), E.FORBIDDEN);
  rejects(() => authorizeReadingMethod(M.GET_RECORD, access({ senderVerified: false }), PAGE_KEY), E.FORBIDDEN);
});
test("Capacity is byte-accounted UTF-8 JSON, accepts an exact boundary and never evicts", () => {
  assert.deepEqual(checkCapacity({ recordCount: L.records - 1, totalBytes: L.totalBytes - 1, addedRecords: 1, addedBytes: 1 }),
    { recordCount: L.records, totalBytes: L.totalBytes });
  rejects(() => checkCapacity({ recordCount: L.records, totalBytes: 0, addedRecords: 1 }), E.CAPACITY);
  rejects(() => checkCapacity({ recordCount: 1, totalBytes: L.totalBytes, addedBytes: 1 }), E.CAPACITY);
  assert.equal(applicationBytes([{ text: "字" }]), new TextEncoder().encode('{"text":"字"}').length);
  rejects(() => checkCapacity({ recordCount: -1, totalBytes: 0 }), E.BAD_DTO);
});
test("One-shot handoff is bound to record, tab, document, page, generation, permission and expiry", () => {
  const current = { ...handoff(), deleted: false, incognito: false, permissionGranted: true };
  assert.equal(checkHandoff(handoff(), current, 1001), true);
  for (const key of ["recordId", "recordRevision", "tabId", "pageKey", "documentGeneration", "generation"]) {
    rejects(() => checkHandoff(handoff(), { ...current, [key]: "changed" }, 1001), E.STALE_OPERATION);
  }
  rejects(() => checkHandoff(handoff(), current, 61000), E.HANDOFF_EXPIRED);
  rejects(() => checkHandoff(handoff({ consumed: true }), current, 1001), E.HANDOFF_EXPIRED);
  rejects(() => checkHandoff(handoff(), { ...current, permissionGranted: false }, 1001), E.FORBIDDEN);
  rejects(() => checkHandoff(handoff(), { ...current, deleted: true }, 1001), E.FORBIDDEN);
});
test("Case-preserving grouping and explicit selection generations prevent same-word context reuse", async () => {
  assert.notEqual(createReadingItemKey("US", "en"), createReadingItemKey("us", "en"));
  assert.notEqual(createReadingItemKey("React", "en"), createReadingItemKey("react", "en"));
  assert.equal(createReadingItemKey("  e\u0301  text ", "en"), createReadingItemKey("é text", "en"));
  const first = snapshot(), second = snapshot({ selectionGeneration: 2, sourceSnapshotId: "source-2" });
  assert.equal(sameSelectionIdentity(first, second), false);
  assert.equal(sameSelectionIdentity({}, {}), false);
  const a = { ...first, pageKey: PAGE_KEY }, b = { ...second, pageKey: PAGE_KEY,
    anchor: { ...first.anchor, position: { start: 50, end: 55 } } };
  assert.equal(sameProvenLocation(a, b), false);
  assert.equal(sameProvenLocation(a, { ...a }), true);
  assert.equal(sameProvenLocation(record(), record()), false);
  assert.notEqual(await createSourceDigest(first), await createSourceDigest(snapshot({ contextText: "Different surrounding paragraph." })));
  assert.equal(assertArtifactSource(artifact(), first, token()), true);
  rejects(() => assertArtifactSource(artifact(), second, token()), E.STALE_OPERATION);
});
test("Projection preserves inline joining, UTF-16 offsets and collapsed whitespace mapping", () => {
  const segments = [
    { text: "  Re", blockStart: true, excluded: false, nodeKey: "n1" },
    { text: "act \t", blockStart: false, excluded: false, nodeKey: "n2" },
    { text: " \n😀e\u0301", blockStart: false, excluded: false, nodeKey: "n3" },
    { text: "hidden translation", blockStart: false, excluded: true, nodeKey: "tf" },
    { text: "Next", blockStart: true, excluded: false, nodeKey: "n4" }
  ];
  const result = projectSourceSegments(segments);
  assert.equal(result.text, "React 😀e\u0301\nNext");
  assert.equal(result.offsetUnit, "utf-16");
  assert.equal(result.mapping.length, result.text.length);
  assert.deepEqual(result.mapping[5], { start: { nodeKey: "n2", offset: 3 }, end: { nodeKey: "n3", offset: 2 } });
  assert.equal(result.mapping[6].start.offset, 2);
  assert.equal(result.mapping[7].start.offset, 3);
  assert.equal(result.mapping[10], null);
  const full = "x".repeat(L.scanTotalChars);
  assert.equal(projectSourceSegments([{ text: full, blockStart: true, excluded: false, nodeKey: "n" }]).text.length, L.scanTotalChars);
  rejects(() => projectSourceSegments([{ text: `${full}x`, blockStart: true, excluded: false, nodeKey: "n" }]), E.LIMIT);
  rejects(() => validateSourceSnapshot(snapshot({ anchor: { ...snapshot().anchor, position: { start: 0, end: 4 } } })), E.BAD_DTO);
});
test("Unsafe return addresses fail closed while meaningful article query and hash survive", () => {
  assert.equal(safeReturnUrl("https://example.test/article?id=1#section-2", "url"), "https://example.test/article?id=1#section-2");
  for (const url of ["javascript:alert(1)", "https://user:pass@example.test/a", "https://example.test/a?token=synthetic",
    "https://example.test/a?email=name%40example.test", "https://example.test/a#access_token=synthetic", "https://example.test/a#%zz"]) {
    rejects(() => safeReturnUrl(url, "url"), E.UNSAFE_URL);
  }
});
test("Follow-ups retain old source/branch; regeneration cannot steal the old thread", () => {
  const first = artifact("assistant"), follow = artifact("assistant", { artifactId: "follow", operationId: "op-2", createdAt: 1002,
    payload: { ...first.payload, action: "follow-up", turnId: "turn-2", parentTurnId: "turn-1" } });
  const base = { record: record(), snapshots: [snapshot()], artifacts: [first, follow] };
  assert.equal(validateRecordDetail(base).artifacts.length, 2);
  rejects(() => validateRecordDetail({ ...base, artifacts: [first, { ...follow, sourceSnapshotId: "missing" }] }), E.BAD_DTO);
  rejects(() => validateRecordDetail({ ...base, artifacts: [first, { ...follow, payload: { ...follow.payload, branchId: "different" } }] }), E.BAD_DTO);
});
test("Regeneration is a distinct branch, and cyclic turn references fail", () => {
  const first = artifact("assistant");
  const regenerated = artifact("assistant", { artifactId: "regenerated", createdAt: 1002, operationId: "op-2",
    payload: { ...first.payload, turnId: "turn-2", regenerationOf: "turn-1", branchId: "branch-2" } });
  const base = { record: record(), snapshots: [snapshot()], artifacts: [first, regenerated] };
  assert.equal(validateRecordDetail(base).artifacts.length, 2);
  rejects(() => validateRecordDetail({ ...base, artifacts: [first, { ...regenerated, payload: { ...regenerated.payload, branchId: "branch-1" } }] }), E.BAD_DTO);
  const a = { ...first, payload: { ...first.payload, regenerationOf: "turn-2" } };
  const b = { ...regenerated, createdAt: first.createdAt };
  rejects(() => validateRecordDetail({ ...base, artifacts: [a, b] }), E.BAD_DTO);
});

test("Independent assistant roots still bind every turn in a thread to one source snapshot", () => {
  const first = artifact("assistant"), otherSource = snapshot({ sourceSnapshotId: "source-2", contextText: "Another synthetic paragraph." });
  const second = artifact("assistant", { artifactId: "root-2", operationId: "op-2", sourceSnapshotId: "source-2",
    payload: { ...first.payload, turnId: "turn-2" } });
  const detail = { record: record(), snapshots: [snapshot(), otherSource], artifacts: [first, second] };
  rejects(() => validateRecordDetail(detail), E.BAD_DTO);
  rejects(() => validateRecordDetail({ ...detail, artifacts: [first, { ...second, payload: { ...second.payload, branchId: "branch-2" } }] }), E.BAD_DTO);
  assert.equal(validateRecordDetail({ ...detail, artifacts: [first,
    { ...second, payload: { ...second.payload, threadId: "thread-2", branchId: "branch-2" } }] }).artifacts.length, 2);
  assert.equal(validateRecordDetail({ ...detail, artifacts: [artifact(), artifact("translation", { sourceSnapshotId: "source-2" })] }).artifacts.length, 2);
});

test("Projection alone accepts and maps form-feed; source DTOs retain the control-character boundary", () => {
  const result = projectSourceSegments([
    { text: "a\f", nodeKey: "first", blockStart: true, excluded: false },
    { text: "\f b", nodeKey: "second", blockStart: false, excluded: false }
  ]);
  assert.equal(result.text, "a b");
  assert.deepEqual(result.mapping[1], { start: { nodeKey: "first", offset: 1 }, end: { nodeKey: "second", offset: 2 } });
  rejects(() => projectSourceSegments([{ text: "a\u000bb", nodeKey: "first", blockStart: true, excluded: false }]), E.BAD_DTO);
  rejects(() => validateSourceSnapshot(snapshot({ contextText: "a\fb" })), E.BAD_DTO);
});

test("Proven-location equality fails closed for missing or malformed evidence on both sides", () => {
  const valid = { ...snapshot(), pageKey: PAGE_KEY };
  const malformed = [
    { ...valid, pageKey: undefined }, { ...valid, documentGeneration: undefined },
    { ...valid, anchor: { ...valid.anchor, position: undefined } },
    { ...valid, anchor: { ...valid.anchor, position: null } },
    { ...valid, anchor: { ...valid.anchor, position: { start: 0, end: 1 } } },
    { ...valid, anchor: { ...valid.anchor, position: { start: NaN, end: 5 } } },
    { ...valid, anchor: { ...valid.anchor, quote: { exact: "React" } } },
    { ...valid, anchor: { ...valid.anchor, blockDigest: "not-a-sha256" } },
    { ...valid, anchor: { ...valid.anchor, status: "missing" } }
  ];
  for (const value of malformed) assert.equal(sameProvenLocation(value, value), false);
  assert.equal(sameProvenLocation(valid, { ...valid, anchor: { ...valid.anchor } }), true);
});
