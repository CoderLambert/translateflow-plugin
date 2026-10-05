import { READING_METHOD as M } from "../../../src/shared/reading/constants.js";
import { createReadingItemKey } from "../../../src/shared/reading/identity.js";

export const RECORD_ID = "11111111-1111-4111-8111-111111111111";
export const PAGE_KEY = `rp1:${"a".repeat(64)}`;
export function snapshot(overrides = {}) {
  return { schemaVersion: 1, sourceSnapshotId: "source-1", selectedText: "React", contextText: "React renders the first paragraph.",
    contextMode: "bounded-context", sourceDigest: "b".repeat(64), projectionVersion: "tf-source-utf16-v1",
    documentGeneration: "doc-1", selectionGeneration: 1,
    anchor: { status: "resolved", quote: { exact: "React", prefix: "", suffix: " renders the first paragraph." },
      position: { start: 0, end: 5 }, blockDigest: "c".repeat(64) }, capturedAt: 1000, ...overrides };
}
export function record(overrides = {}) {
  return { schemaVersion: 1, recordId: RECORD_ID, revision: 1, itemKey: createReadingItemKey("React", "en"), itemText: "React",
    sourceLanguage: "en", pageKey: PAGE_KEY, safeReturnUrl: "https://example.test/article?id=1#section-2", pageTitle: "Synthetic article",
    anchor: snapshot().anchor, firstSeenAt: 1000, lastLookupAt: 1000, lastViewedAt: null, lookupCount: 1, ...overrides };
}
export function artifact(kind = "dictionary", overrides = {}) {
  const payload = kind === "dictionary" ? { outcome: "hit", headword: "React", phonetic: "", partOfSpeech: "proper noun", definitions: ["合成测试摘要"] }
    : kind === "translation" ? { text: "合成测试译文" }
      : { userQuestion: "What does React refer to here?", assistantAnswer: "This synthetic passage refers to a UI library.",
        action: "understand", threadId: "thread-1", turnId: "turn-1", parentTurnId: null, branchId: "branch-1",
        regenerationOf: null, completionStatus: "completed" };
  const provenance = kind === "dictionary" ? [{ sourceId: "synthetic", packId: "fixture", packVersion: "v1", sourceEntryId: "react" }]
    : { provider: "mock", model: "mock-model", promptVersion: "prompt-v1", providerConfigFingerprint: "opaque-fingerprint" };
  return { schemaVersion: 1, artifactId: `artifact-${kind}`, recordId: RECORD_ID, operationId: "op-1", sourceSnapshotId: "source-1", kind,
    targetLanguage: "zh-Hans", createdAt: 1001, payload, provenance, ...overrides };
}
export function token(overrides = {}) {
  return { operationId: "op-1", purpose: "lookup", consentGeneration: 1, sitePolicyRevision: 1, dataGeneration: 1, pageGeneration: 1, pageKey: PAGE_KEY,
    documentGeneration: "doc-1", selectionGeneration: 1, recordId: RECORD_ID, recordRevision: 0,
    issuedAt: 1000, expiresAt: 601000, ...overrides };
}
export function handoff(overrides = {}) {
  return { handoffId: "handoff-1", recordId: RECORD_ID, recordRevision: 1, tabId: 7, pageKey: PAGE_KEY,
    documentGeneration: "doc-1", generation: 1, issuedAt: 1000, expiresAt: 61000, consumed: false, ...overrides };
}
export function request(method, overrides = {}) {
  const bodies = {
    [M.BEGIN_QUERY]: { operationId: "op-1", purpose: "lookup", sourceSnapshot: snapshot(), pageKey: PAGE_KEY, safeReturnUrl: record().safeReturnUrl,
      pageTitle: "Synthetic article", itemText: "React", sourceLanguage: "en", recordId: null, recordRevision: null, captureSafety: { selection: "safe", context: "safe", root: "light-dom" } },
    [M.SAVE_QUERY_RESULT]: { token: token(), artifact: artifact() },
    [M.APPEND_ASSISTANT]: { token: token({ purpose: "assistant" }), artifact: artifact("assistant") },
    [M.GET_PAGE_SUMMARY]: { cursor: null, limit: 20 },
    [M.GET_RECORD]: { recordId: RECORD_ID }, [M.GET_RECORD_SITE_KEY]: { recordId: RECORD_ID },
    [M.LIST_RECORDS]: { pageKey: null, query: "React", cursor: null, limit: 20 },
    [M.GET_RECORDING_STATE]: {}, [M.SET_RECORDING]: { enabled: true, expectedConsentGeneration: 1 },
    [M.DELETE_RECORD]: { recordId: RECORD_ID, expectedRevision: 1 }, [M.DELETE_PAGE]: { pageKey: PAGE_KEY },
    [M.CLEAR_RECORDS]: { expectedDataGeneration: 1 }, [M.EXPORT_START]: {},
    [M.EXPORT_NEXT]: { exportId: "export-1", cursor: "cursor-1" }, [M.EXPORT_FINISH]: { exportId: "export-1", sequence: 0 },
    [M.EXPORT_CANCEL]: { exportId: "export-1" }, [M.OPEN_LEARNING_CENTER]: {},
    [M.LIST_PAGES]: { query: "", cursor: null, limit: 20 }, [M.GET_SITE_RECORDING]: {},
    [M.SET_SITE_RECORDING]: { siteKey: "https://example.test", excluded: true, expectedSitePolicyRevision: 1 },
    [M.GET_SITE_MARKERS]: {}, [M.SET_SITE_MARKERS]: { siteKey: "https://example.test", enabled: true },
    [M.LIST_RECORDING_EXCLUSIONS]: { cursor: null, limit: 20 }, [M.CANCEL_OPERATION]: { operationId: "op-1" },
    [M.REGISTER_DOCUMENT]: { documentGeneration: "doc-1" },
    [M.CREATE_HANDOFF]: { recordId: RECORD_ID, expectedRevision: 1 }, [M.CONSUME_HANDOFF]: { handoffId: "handoff-1" }
  };
  return { protocolVersion: 2, method, ...bodies[method], ...overrides };
}

export function pageSummaryItem(overrides = {}) {
  return { recordId: RECORD_ID, revision: 1, anchor: snapshot().anchor, hasCompletedAssistant: false, ...overrides };
}
export function recordingState(scope = "extension", overrides = {}) {
  const minimal = { enabled: true, consentGeneration: 1, capacityReached: false };
  return { ...minimal, ...(scope === "extension" ? { dataGeneration: 1, recordCount: 1, totalBytes: 1024 } : {}), ...overrides };
}
export function response(method, scope = "extension", overrides = {}) {
  const detail = { record: record(), snapshots: [snapshot()], artifacts: [artifact()] };
  const saved = { state: "saved", recordId: RECORD_ID, revision: 1, artifactId: artifact().artifactId, duplicate: false };
  const values = {
    [M.BEGIN_QUERY]: { state: "ready", token: token() },
    [M.SAVE_QUERY_RESULT]: saved, [M.APPEND_ASSISTANT]: saved,
    [M.GET_PAGE_SUMMARY]: { items: [pageSummaryItem()], nextCursor: null, pageRecordCount: 1, pageRevision: 1 },
    [M.GET_RECORD]: detail,
    [M.GET_RECORD_SITE_KEY]: { siteKey: "https://example.test" },
    [M.LIST_RECORDS]: { items: [recordListItem()], nextCursor: null, catalogRevision: 1 },
    [M.GET_RECORDING_STATE]: recordingState(scope), [M.SET_RECORDING]: recordingState(scope),
    [M.DELETE_RECORD]: { deleted: true }, [M.DELETE_PAGE]: { deletedCount: 1, pageGeneration: 2 },
    [M.CLEAR_RECORDS]: { deletedCount: 1, dataGeneration: 2 },
    [M.LIST_PAGES]: { items: [pageListItem()], nextCursor: null, catalogRevision: 1 },
    [M.EXPORT_START]: { exportId: "export-1", exportRevision: 1, expiresAt: 601000, nextCursor: "cursor-1" },
    [M.EXPORT_NEXT]: { sequence: 0, jsonChunk: '{"format":"translateflow-reading",', nextCursor: "cursor-2", done: false, exportRevision: 1 },
    [M.EXPORT_FINISH]: { exportId: "export-1", sequence: 0, exportRevision: 1, state: "finished" },
    [M.EXPORT_CANCEL]: { exportId: "export-1", state: "cancelled" }, [M.OPEN_LEARNING_CENTER]: { opened: true },
    [M.GET_SITE_RECORDING]: { excluded: false, sitePolicyRevision: 1 }, [M.SET_SITE_RECORDING]: { excluded: true, sitePolicyRevision: 2 },
    [M.GET_SITE_MARKERS]: { state: "ready", enabled: false, permissionGranted: true }, [M.SET_SITE_MARKERS]: { state: "ready", enabled: true, permissionGranted: true },
    [M.LIST_RECORDING_EXCLUSIONS]: { items: [{ siteKey: "https://example.test", excluded: true, sitePolicyRevision: 2 }], nextCursor: null },
    [M.CANCEL_OPERATION]: { operationId: "op-1", state: "cancelled", recordId: null, revision: null },
    [M.REGISTER_DOCUMENT]: { documentGeneration: "doc-1", navigationGeneration: 1, pageKey: PAGE_KEY, siteKey: "https://example.test" },
    [M.CREATE_HANDOFF]: { state: "ready", handoff: handoff() }, [M.CONSUME_HANDOFF]: pageSummaryItem()
  };
  return { protocolVersion: 2, ok: true, data: values[method], ...overrides };
}

export function recordListItem(overrides = {}) {
  const { schemaVersion, itemKey, anchor, ...fields } = record();
  return { ...fields, siteKey: "https://example.test", resultPreview: { kind: "dictionary", artifactId: "artifact-dictionary",
    sourceSnapshotId: "source-1", targetLanguage: "zh-Hans", text: "合成测试摘要", truncated: false },
    contextPreview: snapshot().contextText, assistantTurnCount: 0, hasCompletedAssistant: false, locationCapability: "quote-and-position", ...overrides };
}
export function pageListItem(overrides = {}) {
  const { pageKey, pageTitle, safeReturnUrl, lastLookupAt } = record();
  return { pageKey, siteKey: "https://example.test", pageTitle, safeReturnUrl, recordCount: 1, lastLookupAt, ...overrides };
}
