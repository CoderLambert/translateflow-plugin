import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { validateOperationToken } from "../../shared/reading/lifecycle.js";
import { fail } from "../../shared/reading/validation.js";

// Transient backend registration only. Persisted receipts/meta/atomic mutations belong to #233.
export function createOperationRegistry({ now = Date.now } = {}) {
  const entries = new Map();
  const key = (ownerKey, operationId) => JSON.stringify([ownerKey, operationId]);
  function prune() { for (const [name, value] of entries) if (now() >= value.token.expiresAt) entries.delete(name); }
  function get(access, operationId, allowRevoked = false) {
    prune();
    const value = entries.get(key(access.ownerKey, operationId));
    if (!value || (!allowRevoked && value.revoked) || value.access.documentGeneration !== access.documentGeneration ||
        value.access.navigationGeneration !== access.navigationGeneration || value.access.pageKey !== access.pageKey) fail(E.STALE_OPERATION, "operation");
    return value;
  }
  function retry(access, request, fingerprint) {
    prune();
    const value = entries.get(key(access.ownerKey, request.operationId));
    if (!value) return null;
    get(access, request.operationId);
    if (value.fingerprint !== fingerprint) fail(E.STALE_OPERATION, "operation.identity");
    return value;
  }
  function register(access, request, fingerprint, token, sourceSnapshot) {
    const previous = retry(access, request, fingerprint);
    if (previous) return previous;
    const ownerCount = [...entries.values()].filter((item) => item.access.ownerKey === access.ownerKey).length;
    if (ownerCount >= L.operationsPerOwner || entries.size >= L.operationsGlobal) fail(E.CAPACITY, "operations");
    const validated = validateOperationToken(token);
    if (validated.operationId !== request.operationId || validated.purpose !== request.purpose ||
        validated.pageKey !== access.pageKey || validated.documentGeneration !== access.documentGeneration ||
        validated.selectionGeneration !== access.selectionGeneration ||
        (request.recordId !== null && (validated.recordId !== request.recordId || validated.recordRevision !== request.recordRevision)) ||
        (request.recordId === null && validated.recordRevision !== 0) || validated.issuedAt > now() || now() >= validated.expiresAt) fail(E.BAD_DTO, "operation.token");
    const value = { access, token: validated, fingerprint, sourceSnapshot, revoked: false };
    entries.set(key(access.ownerKey, request.operationId), value);
    return value;
  }
  return { get, getForCancellation(access, operationId) { return get(access, operationId, true); }, retry, register,
    assertCurrent(value, access) {
      if (get(access, value.token.operationId) !== value || value.access.selectionGeneration !== access.selectionGeneration) fail(E.STALE_OPERATION, "operation.selection");
    },
    revoke(predicate = () => true) { for (const value of entries.values()) if (predicate(value)) value.revoked = true; },
    get size() { prune(); return entries.size; } };
}
