import {
  RICH_MDICT_MAX_DISPLAY_BYTES,
  RICH_MDICT_MAX_RECORD_BYTES,
  RICH_MDICT_SOURCE_ID,
  clampText,
  isValidSnapshot,
  normalizePackId,
  normalizeQuery,
  normalizeRichMdictLookupRequestId,
  richMdictAbortError,
  richError,
  sanitizeDebugMetrics
} from "./rich-mdict-contract.js";

const CANCEL_TTL_MS = 15_000;
const CANCEL_CACHE_LIMIT = 128;

export function createRichMdictLookupController({
  stateStore,
  lookup,
  assertSourceSize,
  loadIndex,
  sourceReader,
  clampUtf8Text
} = {}) {
  const operationsByRequest = new Map();
  const cancelledRequests = new Map();

  async function lookupText(text, dictionaryId, lookupIdentity = null) {
    const query = normalizeQuery(text);
    const targetId = dictionaryId === undefined ? "" : normalizePackId(dictionaryId);
    const operation = lookupIdentity ? beginOperation(lookupIdentity) : null;
    const signal = operation?.controller.signal;
    try {
      assertNotAborted(signal);
      const state = await stateStore.read();
      assertNotAborted(signal);
      const dictionaries = [];
      const errors = [];
      const targetEntry = targetId ? state.packs?.[targetId] : null;
      if (targetId && targetEntry?.sourceId !== RICH_MDICT_SOURCE_ID) {
        return { found: false, dictionaries: [], errors: [{ id: targetId, title: "", code: "RICH_MDICT_NOT_INSTALLED", message: "Rich dictionary is not installed." }] };
      }
      if (targetId && targetEntry.status !== "healthy") {
        return { found: false, dictionaries: [], errors: [{ id: targetId, title: clampText(targetEntry.active?.title || targetId, 200), code: "RICH_MDICT_UNAVAILABLE", message: "Rich dictionary is not available for lookup." }] };
      }
      const entries = targetId ? [[targetId, targetEntry]] : Object.entries(state.packs || {});
      for (const [packId, entry] of entries) {
        assertNotAborted(signal);
        if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || entry?.status !== "healthy") continue;
        const active = entry.active;
        try {
          if (!isValidSnapshot(packId, active)) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary metadata is malformed.");
          await assertSourceSize(active);
          assertNotAborted(signal);
          const index = await loadIndex(active, signal);
          assertNotAborted(signal);
          const result = await lookup({ source: sourceReader(packId, active, signal), index, text: query, signal });
          assertNotAborted(signal);
          if (result?.found) dictionaries.push({
            id: packId,
            packVersion: active.packVersion,
            title: active.title,
            headword: clampText(result.displayForm, 300),
            text: clampUtf8Text(result.safeTextFallback, RICH_MDICT_MAX_DISPLAY_BYTES),
            richRecord: { rawRecord: clampUtf8Text(result.rawRecord, RICH_MDICT_MAX_RECORD_BYTES), format: clampText(index.header.format, 40), styleSheetRules: index.header.styleSheetRules.map(({ id, begin, end }) => ({ id, begin, end })) },
            ...(result.aliasTarget ? { aliasTarget: clampText(result.aliasTarget, 300) } : {}),
            ...(result.debugMetrics ? { debugMetrics: sanitizeDebugMetrics(result.debugMetrics) } : {})
          });
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw richMdictAbortError();
          errors.push({
            id: packId,
            title: clampText(active?.title || packId, 200),
            code: error?.code || "RICH_MDICT_STORAGE",
            message: clampText(error?.message || String(error), 300)
          });
        }
        if (targetId) break;
      }
      return { found: dictionaries.length > 0, dictionaries, errors };
    } finally {
      if (operation && operationsByRequest.get(operation.requestId) === operation) {
        operationsByRequest.delete(operation.requestId);
      }
    }
  }

  function cancelLookup(requestIdValue, ownerKeyValue) {
    const requestId = normalizeRichMdictLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    pruneCancelled();
    const operation = operationsByRequest.get(requestId);
    if (operation) {
      if (operation.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
      operation.controller.abort();
      return { cancelled: true, phase: "active" };
    }
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled && cancelled.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
    rememberCancelled(requestId, ownerKey);
    return { cancelled: true, phase: "pending" };
  }

  function beginOperation({ requestId: requestIdValue, ownerKey: ownerKeyValue } = {}) {
    const requestId = normalizeRichMdictLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    pruneCancelled();
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled) {
      if (cancelled.ownerKey !== ownerKey) throw richError("RICH_MDICT_INPUT", "Rich MDict lookup request ID belongs to another content sender.");
      cancelledRequests.delete(requestId);
      throw richMdictAbortError();
    }
    if (operationsByRequest.has(requestId)) throw richError("RICH_MDICT_BUSY", "Rich MDict lookup request ID is already active.");
    const operation = { requestId, ownerKey, controller: new AbortController() };
    operationsByRequest.set(requestId, operation);
    return operation;
  }

  function rememberCancelled(requestId, ownerKey) {
    cancelledRequests.delete(requestId);
    cancelledRequests.set(requestId, { ownerKey, expiresAt: Date.now() + CANCEL_TTL_MS });
    while (cancelledRequests.size > CANCEL_CACHE_LIMIT) cancelledRequests.delete(cancelledRequests.keys().next().value);
  }

  function pruneCancelled() {
    const now = Date.now();
    for (const [requestId, operation] of cancelledRequests) {
      if (operation.expiresAt <= now) cancelledRequests.delete(requestId);
    }
  }

  return Object.freeze({ lookupText, cancelLookup });
}

function normalizeOwnerKey(value) {
  const ownerKey = String(value || "");
  if (!ownerKey || ownerKey.length > 512 || /[\u0000-\u001f\u007f]/u.test(ownerKey)) {
    throw richError("RICH_MDICT_INPUT", "Rich MDict lookup owner is invalid.");
  }
  return ownerKey;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw richMdictAbortError();
}
