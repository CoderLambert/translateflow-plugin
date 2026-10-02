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
  return { operationId: "op-1", purpose: "lookup", consentGeneration: 1, dataGeneration: 1, pageGeneration: 1, pageKey: PAGE_KEY,
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
      pageTitle: "Synthetic article", itemText: "React", sourceLanguage: "en", recordId: null, recordRevision: null },
    [M.SAVE_QUERY_RESULT]: { token: token(), artifact: artifact() },
    [M.APPEND_ASSISTANT]: { token: token({ purpose: "assistant" }), artifact: artifact("assistant") },
    [M.GET_PAGE_SUMMARY]: { cursor: null, limit: 20 },
    [M.GET_RECORD]: { recordId: RECORD_ID },
    [M.LIST_RECORDS]: { pageKey: null, query: "React", cursor: null, limit: 20 },
    [M.GET_RECORDING_STATE]: {}, [M.SET_RECORDING]: { enabled: true, expectedConsentGeneration: 1 },
    [M.DELETE_RECORD]: { recordId: RECORD_ID, expectedRevision: 1 }, [M.DELETE_PAGE]: { pageKey: PAGE_KEY },
    [M.CLEAR_RECORDS]: { expectedDataGeneration: 1 }, [M.EXPORT_JSON]: {},
    [M.CREATE_HANDOFF]: { recordId: RECORD_ID, expectedRevision: 1 }, [M.CONSUME_HANDOFF]: { handoffId: "handoff-1" }
  };
  return { schemaVersion: 1, method, ...bodies[method], ...overrides };
}
