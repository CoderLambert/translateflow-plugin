import { normalizeRichMddResourceLookupRequestId } from "./rich-mdd-contract.js";
import { richError, richMdictAbortError } from "./rich-mdict-contract.js";

const CANCEL_TTL_MS = 15_000;
const CANCEL_CACHE_LIMIT = 128;

export function createRichMddLookupCancellation() {
  const operationsByRequest = new Map();
  const cancelledRequests = new Map();

  function begin({ requestId: requestIdValue, ownerKey: ownerKeyValue } = {}) {
    const requestId = normalizeRichMddResourceLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    prune();
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled) {
      if (cancelled.ownerKey !== ownerKey) {
        throw richError("RICH_MDD_INPUT", "MDD resource request ID belongs to another content sender.");
      }
      cancelledRequests.delete(requestId);
      throw richMdictAbortError();
    }
    if (operationsByRequest.has(requestId)) {
      throw richError("RICH_MDD_BUSY", "MDD resource request ID is already active.");
    }
    const operation = { requestId, ownerKey, controller: new AbortController() };
    operationsByRequest.set(requestId, operation);
    return operation;
  }

  function finish(operation) {
    if (operation && operationsByRequest.get(operation.requestId) === operation) {
      operationsByRequest.delete(operation.requestId);
    }
  }

  function cancel(requestIdValue, ownerKeyValue) {
    const requestId = normalizeRichMddResourceLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    prune();
    const operation = operationsByRequest.get(requestId);
    if (operation) {
      if (operation.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
      operation.controller.abort();
      return { cancelled: true, phase: "active" };
    }
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled && cancelled.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
    remember(requestId, ownerKey);
    return { cancelled: true, phase: "pending" };
  }

  function remember(requestId, ownerKey) {
    cancelledRequests.delete(requestId);
    cancelledRequests.set(requestId, { ownerKey, expiresAt: Date.now() + CANCEL_TTL_MS });
    while (cancelledRequests.size > CANCEL_CACHE_LIMIT) {
      cancelledRequests.delete(cancelledRequests.keys().next().value);
    }
  }

  function prune() {
    const now = Date.now();
    for (const [requestId, item] of cancelledRequests) {
      if (item.expiresAt <= now) cancelledRequests.delete(requestId);
    }
  }

  return Object.freeze({ begin, finish, cancel });
}

export function assertRichMddLookupActive(signal) {
  if (signal?.aborted) throw richMdictAbortError();
}

function normalizeOwnerKey(value) {
  const ownerKey = String(value || "");
  if (!ownerKey || ownerKey.length > 512 || /[\u0000-\u001f\u007f]/u.test(ownerKey)) {
    throw richError("RICH_MDD_INPUT", "MDD resource lookup owner is invalid.");
  }
  return ownerKey;
}
