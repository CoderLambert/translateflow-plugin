import { byteLength, canonicalJson, cacheError, validateIdentity } from './identity.js';

// An envelope version describes stored fields, NOT prompts, models or application releases.
export const CACHE_RECORD_VERSION = 1;
export const CACHE_MODES = Object.freeze(['prefer-cache', 'cache-only', 'reload', 'no-store']);

export function normalizePolicy(policy = {}) {
  const result = { ttlMs: 0, maxEntries: 10000, maxBytes: 200 * 1024 * 1024,
    maxEntryBytes: 2 * 1024 * 1024, validate: () => true, ...policy };
  for (const key of ['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < (key === 'ttlMs' ? 0 : 1)) throw cacheError('CACHE_INVALID_POLICY', key);
  }
  if (typeof result.validate !== 'function') throw cacheError('CACHE_INVALID_POLICY');
  result.maxEntryBytes = Math.min(result.maxEntryBytes, result.maxBytes);
  return Object.freeze(result);
}

export function assertCacheValue(value, identity, policy) {
  canonicalJson(value);
  const valid = policy.validate(value, identity);
  if (valid && typeof valid.then === 'function') {
    Promise.resolve(valid).catch(() => {});
    throw cacheError('CACHE_ASYNC_VALIDATOR');
  }
  if (valid !== true) throw cacheError('CACHE_INVALID_VALUE');
}

export function createCacheRecord(identity, value, policy, now, metadata = {}) {
  validateIdentity(identity);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + policy.ttlMs)) throw cacheError('CACHE_INVALID_TIME');
  assertCacheValue(value, identity, policy);
  canonicalJson(metadata);
  const record = { recordVersion: CACHE_RECORD_VERSION,
    namespace: identity.namespace, scope: identity.scope, revision: identity.revision, key: identity.key,
    value: structuredClone(value),
    metadata: structuredClone(metadata), createdAt: now, updatedAt: now, lastAccessedAt: now,
    expiresAt: policy.ttlMs ? now + policy.ttlMs : 0, writeId: crypto.randomUUID(), bytes: 0 };
  for (let i = 0; i < 4; i++) { const bytes = byteLength(record); if (bytes === record.bytes) break; record.bytes = bytes; }
  if (record.bytes > policy.maxEntryBytes) throw cacheError('CACHE_ENTRY_TOO_LARGE');
  return record;
}

export function isCurrentRecord(record, identity, policy, now) {
  if (!record || record.recordVersion !== CACHE_RECORD_VERSION || record.key !== identity.key ||
      record.namespace !== identity.namespace || record.scope !== identity.scope || record.revision !== identity.revision ||
      typeof record.writeId !== 'string' || !record.writeId || !Number.isSafeInteger(record.bytes) || record.bytes < 1 ||
      !Number.isSafeInteger(record.expiresAt) || record.expiresAt < 0 || (record.expiresAt !== 0 && record.expiresAt <= now)) return false;
  for (const field of ['createdAt', 'updatedAt', 'lastAccessedAt']) if (!Number.isSafeInteger(record[field]) || record[field] < 0) return false;
  if (policy.ttlMs && record.updatedAt + policy.ttlMs <= now) return false;
  try {
    validateIdentity(identity); canonicalJson(record.metadata);
    assertCacheValue(record.value, identity, policy);
    return record.bytes <= policy.maxEntryBytes && byteLength(record) <= policy.maxEntryBytes;
  } catch { return false; }
}

export function epochKeys(identity) {
  return ['*', JSON.stringify(['namespace', identity.namespace]),
    JSON.stringify(['scope', identity.namespace, identity.scope]), JSON.stringify(['key', identity.key])];
}

export function validWriteToken(token, identity) {
  return token?.key === identity.key && Array.isArray(token.epochs) && token.epochs.length === 4 &&
    token.epochs.every(number => Number.isSafeInteger(number) && number >= 0);
}

export function matchesFilter(record, filter = {}) {
  return ['key', 'namespace', 'scope', 'revision'].every(field => filter[field] === undefined || record[field] === filter[field]);
}

export function validateFilter(filter = {}) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter) ||
      Object.keys(filter).some(key => !['key', 'namespace', 'scope', 'revision'].includes(key))) throw cacheError('CACHE_INVALID_FILTER');
  for (const value of Object.values(filter)) if (typeof value !== 'string' || value.length > 2048) throw cacheError('CACHE_INVALID_FILTER');
  if (filter.scope !== undefined && !filter.namespace) throw cacheError('CACHE_INVALID_FILTER');
  return filter;
}

export function invalidationEpochKey(filter) {
  if (filter.key !== undefined) return JSON.stringify(['key', filter.key]);
  if (filter.scope !== undefined) return JSON.stringify(['scope', filter.namespace, filter.scope]);
  if (filter.namespace !== undefined) return JSON.stringify(['namespace', filter.namespace]);
  return '*';
}
