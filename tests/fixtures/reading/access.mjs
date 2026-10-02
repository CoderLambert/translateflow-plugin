import { artifact, record, response, snapshot, token } from "./contract.mjs";
import { READING_METHOD as M } from "../../../src/shared/reading/constants.js";
export const EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const NATIVE_DOCUMENT = "22222222-2222-4222-8222-222222222222";
export function nativeBrowser(overrides = {}) {
  const context = { contextId: "33333333-3333-4333-8333-333333333333", documentId: NATIVE_DOCUMENT,
    documentUrl: `chrome-extension://${EXTENSION_ID}/learning-center.html`, contextType: "TAB", incognito: false, tabId: 9 };
  return { runtime: { id: EXTENSION_ID, getURL: (path) => `chrome-extension://${EXTENSION_ID}/${path.replace(/^\//u, "")}`,
    getContexts: async () => [context] }, tabs: { create: async (value) => value }, ...overrides };
}
export function extensionSender(overrides = {}) {
  return { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/learning-center.html`, documentId: NATIVE_DOCUMENT,
    frameId: 0, ...overrides };
}
export function contentSender(overrides = {}) {
  return { id: EXTENSION_ID, url: "https://example.test/article?id=1#section-2", frameId: 0, documentId: NATIVE_DOCUMENT,
    documentLifecycle: "active", tab: { id: 7, incognito: false, url: "https://example.test/article?id=1#section-2" }, ...overrides };
}
export function collector(proof = {}) {
  return async (_browser, _sender, challenge) => ({ nonce: challenge.nonce, documentGeneration: "doc-1", selectionGeneration: 1,
    captureSafety: { selection: "safe", context: "safe", root: "light-dom" }, sourceSnapshot: snapshot(),
    intent: ["inspect", "register"].includes(challenge.action) ? null : { action: challenge.action, recordId: challenge.recordId, operationId: challenge.operationId }, ...proof });
}
// Explicit synthetic repository double, NOT persisted save/export acceptance. Each callback invokes the guard.
export function repositoryDouble(overrides = {}) {
  return {
    async readPolicy({ assertCurrent }) { assertCurrent(); return { siteExcluded: false }; },
    async read({ request, access, assertCurrent }) {
      assertCurrent(); const data = response(request.method, access.scope).data;
      if (request.method === M.GET_RECORD) data.record = record({ pageKey: access.pageKey || record().pageKey });
      return data;
    },
    async prepareOperation({ request, access, sourceSnapshot, issuedAt, expiresAt, previous, assertCurrent }) {
      assertCurrent(); return { state: "ready", token: previous || token({ operationId: request.operationId, purpose: request.purpose,
        pageKey: access.pageKey, documentGeneration: sourceSnapshot.documentGeneration, selectionGeneration: sourceSnapshot.selectionGeneration,
        issuedAt, expiresAt, recordRevision: request.recordRevision ?? 0, recordId: request.recordId ?? record().recordId }) };
    },
    async mutate({ request, access, assertCurrent }) { assertCurrent(); return response(request.method, access.scope).data; },
    async cancelOperation({ request, assertCurrent }) { assertCurrent(); return { operationId: request.operationId, state: "cancelled", recordId: null, revision: null }; },
    async openExport({ assertCurrent }) { assertCurrent(); return { exportRevision: 1, exportedAt: 1000, position: 0 }; },
    async checkExport({ assertCurrent }) { assertCurrent(); },
    async readExportChunk({ position, exportRevision, assertCurrent }) { assertCurrent(); return { exportRevision, position: position + 1, jsonChunk: position === 0 ? '{"records":[' : ']}' , done: position === 1 }; },
    async finishExport({ assertCurrent }) { assertCurrent(); }, async cancelExport({ assertCurrent }) { assertCurrent(); },
    ...overrides
  };
}
