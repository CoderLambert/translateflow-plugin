// Shared classification only; no background, DOM, storage or Provider side effects.
// A structurally invalid record, stale configuration or invalid write token is not
// a storage outage and must never be silently accepted as a successful result.
const PERSISTENCE_ERRORS = new Set([
  'CACHE_QUOTA', 'CACHE_STORAGE', 'CACHE_STORAGE_BLOCKED', 'CACHE_STORAGE_TIMEOUT'
]);

export function isCachePersistenceError(value) {
  const code = typeof value === 'string' ? value : value?.code || value?.errorCode;
  return PERSISTENCE_ERRORS.has(code);
}
