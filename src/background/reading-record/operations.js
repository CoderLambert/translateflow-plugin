import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { validateOperationToken } from "../../shared/reading/lifecycle.js";
import { fail, text } from "../../shared/reading/validation.js";

// Transient backend registration only. Persisted receipts/meta/atomic mutations belong to #233.
export function createOperationRegistry({ now = Date.now } = {}) {
  const entries = new Map(), pending = new Map();
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
  function usage(ownerKey, ignored = null) {
    let total = entries.size, owner = [...entries.values()].filter((item) => item.access.ownerKey === ownerKey).length;
    for (const [name, value] of pending) if (name !== ignored && !entries.has(name)) { total++; if (value.access.ownerKey === ownerKey) owner++; }
    return { total, owner };
  }
  function checkCapacity(access, ignored = null) {
    const count = usage(access.ownerKey, ignored);
    if (count.owner >= L.operationsPerOwner || count.total >= L.operationsGlobal) fail(E.CAPACITY, "operations");
  }
  function register(access, request, fingerprint, token, sourceSnapshot, reservation = null) {
    const previous = retry(access, request, fingerprint);
    if (previous) return previous;
    const name = key(access.ownerKey, request.operationId);
    if (pending.has(name) && pending.get(name) !== reservation) fail(E.STALE_OPERATION, "operation.pending");
    checkCapacity(access, reservation ? name : null);
    const validated = validateOperationToken(token);
    if (validated.operationId !== request.operationId || validated.purpose !== request.purpose ||
        validated.pageKey !== access.pageKey || validated.documentGeneration !== access.documentGeneration ||
        validated.selectionGeneration !== access.selectionGeneration ||
        (request.recordId !== null && (validated.recordId !== request.recordId || validated.recordRevision !== request.recordRevision)) ||
        (request.recordId === null && validated.recordRevision !== 0) || validated.issuedAt > now() || now() >= validated.expiresAt) fail(E.BAD_DTO, "operation.token");
    const value = { access, token: validated, fingerprint, sourceSnapshot, revoked: false };
    // Validated BEGIN metadata is retained once, within the existing operation budget.
    // SAVE has no source language field and must not infer one from provider output.
    Object.defineProperty(value, "sourceLanguage", { value: text(request.sourceLanguage, L.languageChars, "operation.sourceLanguage"), enumerable: true });
    entries.set(key(access.ownerKey, request.operationId), value);
    return value;
  }
  function prepare(access, request, fingerprint, sourceSnapshot, load, assertAccess) {
    const previous = retry(access, request, fingerprint), name = key(access.ownerKey, request.operationId);
    const existing = pending.get(name);
    if (existing) {
      if (existing.revoked || now() >= existing.expiresAt || existing.fingerprint !== fingerprint ||
          existing.access.documentGeneration !== access.documentGeneration || existing.access.navigationGeneration !== access.navigationGeneration ||
          existing.access.pageKey !== access.pageKey) fail(E.STALE_OPERATION, "operation.pending");
      return existing.promise;
    }
    if (!previous) checkCapacity(access);
    const issuedAt = previous?.token.issuedAt ?? now(), expiresAt = previous?.token.expiresAt ?? issuedAt + L.operationTtlMs;
    const reservation = { access, request, fingerprint, previous, issuedAt, expiresAt, revoked: false, promise: null };
    pending.set(name, reservation); // Reserve before calling or awaiting the repository; identical retries share one preparation.
    const assertCurrent = () => {
      assertAccess();
      if (pending.get(name) !== reservation || reservation.revoked || now() >= expiresAt ||
          (previous && get(access, request.operationId) !== previous)) fail(E.STALE_OPERATION, "operation.prepare");
    };
    reservation.promise = Promise.resolve().then(async () => {
      assertCurrent();
      const prepared = await load({ previous: previous?.token ?? null, sourceSnapshot, issuedAt, expiresAt, assertCurrent });
      assertCurrent();
      if (prepared?.state === "disabled") return { state: "disabled" };
      if (prepared?.state !== "ready") fail(E.BAD_DTO, "operation.prepared");
      if (previous) {
        if (JSON.stringify(prepared.token) !== JSON.stringify(previous.token)) fail(E.STALE_OPERATION, "operation.retry");
        return { state: "ready", token: previous.token };
      }
      if (prepared.token?.issuedAt !== issuedAt || prepared.token?.expiresAt !== expiresAt) fail(E.BAD_DTO, "operation.ttl");
      const registered = register(access, request, fingerprint, prepared.token, sourceSnapshot, reservation);
      return { state: "ready", token: registered.token };
    }).finally(() => { if (pending.get(name) === reservation) pending.delete(name); });
    return reservation.promise;
  }
  return { get, getForCancellation(access, operationId) { return get(access, operationId, true); }, retry, register, prepare,
    assertCurrent(value, access) {
      if (get(access, value.token.operationId) !== value || value.access.selectionGeneration !== access.selectionGeneration) fail(E.STALE_OPERATION, "operation.selection");
    },
    revoke(predicate = () => true) { for (const value of [...entries.values(), ...pending.values()]) if (predicate(value)) value.revoked = true; },
    get size() { prune(); return usage().total; } };
}
