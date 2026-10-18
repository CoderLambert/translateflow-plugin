import { cacheError, validateIdentity, byteLength } from '../../shared/cache/identity.js';
import { CACHE_RECORD_VERSION, epochKeys, validWriteToken, validateFilter, matchesFilter, invalidationEpochKey } from '../../shared/cache/record.js';

/** Alternative backend for short-lived, nonpersistent cache policies and deterministic tests. */
export function createMemoryCacheStore() {
  const rows = new Map(), epochs = new Map();
  function measure(record) {
    for (let i = 0; i < 4; i++) { const bytes = byteLength(record); if (bytes === record.bytes) break; record.bytes = bytes; }
  }
  const tokenFor = identity => ({ key: identity.key, epochs: epochKeys(identity).map(key => epochs.get(key) || 0) });
  return Object.freeze({
    async lookup(identities, now) {
      return identities.map(identity => {
        validateIdentity(identity); const record = rows.get(identity.key);
        if (record?.recordVersion === CACHE_RECORD_VERSION && Number.isSafeInteger(record.lastAccessedAt)) {
          record.lastAccessedAt = Math.max(record.lastAccessedAt, now); measure(record);
        }
        return { record: record ? structuredClone(record) : undefined, token: tokenFor(identity) };
      });
    },
    async putMany(writes, { signal } = {}) {
      if (signal?.aborted) throw cacheError('CANCELLED');
      for (const { record, token } of writes) if (!validWriteToken(token, validateIdentity(record))) throw cacheError('CACHE_INVALID_TOKEN');
      const result = { written: [], skipped: [] };
      for (const { record, token } of writes) {
        const current = tokenFor(record);
        if (current.epochs.some((value, i) => value !== token.epochs[i])) { result.skipped.push(record.key); continue; }
        const next = structuredClone(record), old = rows.get(record.key);
        if (old?.recordVersion === CACHE_RECORD_VERSION) next.createdAt = old.createdAt;
        measure(next); rows.set(record.key, next); result.written.push(record.key);
      }
      return result;
    },
    async removeIfUnchanged(key, writeId) {
      const row = rows.get(key); return row && row.writeId === writeId ? rows.delete(key) : false;
    },
    async list(filter = {}) {
      validateFilter(filter); return [...rows.values()].filter(row => matchesFilter(row, filter)).map(row => structuredClone(row));
    },
    async invalidate(filter = {}) {
      validateFilter(filter); const key = invalidationEpochKey(filter), value = (epochs.get(key) || 0) + 1;
      if (!Number.isSafeInteger(value)) throw cacheError('CACHE_INVALID_EPOCH');
      if (key === '*') epochs.clear(); epochs.set(key, value);
      let deleted = 0;
      for (const [k, row] of rows) if (matchesFilter(row, filter)) { rows.delete(k); deleted++; }
      return { deleted };
    },
    async prune({ namespace, maxEntries = Number.MAX_SAFE_INTEGER, maxBytes = Number.MAX_SAFE_INTEGER, now = Date.now() } = {}) {
      if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw cacheError('CACHE_INVALID_POLICY');
      let deleted = 0, bytes = 0; const live = [];
      for (const [key, row] of rows) {
        if (namespace !== undefined && row.namespace !== namespace) continue;
        if (row.recordVersion !== CACHE_RECORD_VERSION || !Number.isSafeInteger(row.bytes) || row.bytes < 1 ||
            !Number.isSafeInteger(row.lastAccessedAt) || row.lastAccessedAt < 0 ||
            !Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0 || (row.expiresAt && row.expiresAt <= now)) { rows.delete(key); deleted++; continue; }
        live.push(row); bytes += row.bytes;
      }
      live.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.key.localeCompare(b.key));
      let removed = 0;
      while (live.length - removed > maxEntries || bytes > maxBytes) { const row = live[removed++]; rows.delete(row.key); bytes -= row.bytes; deleted++; }
      return { deleted, entries: live.length - removed, bytes };
    },
    // Closing a client is not an invalidation of the shared backend.
    close() {}
  });
}
