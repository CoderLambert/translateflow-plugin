import { cacheError, validateIdentity } from '../../shared/cache/identity.js';
import { isCachePersistenceError } from '../../shared/cache/persistence-errors.js';
import { CACHE_MODES, normalizePolicy, createCacheRecord, isCurrentRecord, matchesFilter,
  validateFilter, validWriteToken } from '../../shared/cache/record.js';
import { createSingleFlight } from '../../shared/cache/single-flight.js';

/** Business-free cache service. Callers own request identity, validation and loaders. */
export function createCacheService({ store, clock = Date.now, onEvent = () => {}, maxInFlight = 128, maxBatchBytes = 8 * 1024 * 1024 } = {}) {
  for (const method of ['lookup', 'putMany', 'removeIfUnchanged', 'list', 'invalidate', 'prune', 'close'])
    if (typeof store?.[method] !== 'function') throw cacheError('CACHE_INVALID_STORE', method);
  if (!Number.isSafeInteger(maxBatchBytes) || maxBatchBytes < 1) throw cacheError('CACHE_INVALID_POLICY');
  const policies = new Map(), flight = createSingleFlight({ maxEntries: maxInFlight });
  const counters = { hits: 0, misses: 0, writes: 0, rejected: 0, invalidations: 0, storageErrors: 0 };
  let closed = false;
  function live(signal) { if (closed) throw cacheError('CACHE_CLOSED'); if (signal?.aborted) throw cacheError('CANCELLED'); }
  function currentTime() {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw cacheError('CACHE_INVALID_TIME');
    return now;
  }
  function policyFor(identity) {
    validateIdentity(identity);
    const policy = policies.get(identity.namespace);
    if (!policy) throw cacheError('CACHE_UNKNOWN_NAMESPACE', identity.namespace);
    return policy;
  }
  function emit(type, namespace, reason) {
    if (Object.hasOwn(counters, type)) counters[type]++;
    // No URLs, keys, text, values, prompts or credentials in telemetry.
    try { onEvent(Object.freeze({ type, namespace, ...(reason ? { reason } : {}) })); } catch {}
  }
  const api = {
    register(namespace, policy = {}) {
      live();
      validateIdentity({ namespace, scope: '', revision: 'registration', key: namespace });
      if (policies.has(namespace)) throw cacheError('CACHE_DUPLICATE_NAMESPACE');
      policies.set(namespace, normalizePolicy(policy)); return api;
    },
    async readMany(identities, { signal } = {}) {
      live(signal);
      if (!Array.isArray(identities) || identities.length > 1024) throw cacheError('CACHE_INPUT_LIMIT');
      identities.forEach(policyFor);
      const now = currentTime(), records = await store.lookup(identities, now); live(signal);
      const result = [];
      for (let i = 0; i < identities.length; i++) {
        const identity = identities[i], policy = policyFor(identity), { record, token } = records[i];
        if (!validWriteToken(token, identity)) throw cacheError('CACHE_INVALID_TOKEN');
        if (isCurrentRecord(record, identity, policy, now)) {
          emit('hits', identity.namespace);
          result.push({ hit: true, value: structuredClone(record.value), token, metadata: structuredClone(record.metadata),
            createdAt: record.createdAt, expiresAt: record.expiresAt });
        } else {
          if (record) await store.removeIfUnchanged(identity.key, record.writeId);
          emit('misses', identity.namespace, record ? 'expired-or-invalid' : 'absent');
          result.push({ hit: false, token, reason: record ? 'expired-or-invalid' : 'absent' });
        }
      }
      live(signal); return result;
    },
    async read(identity, options) { return (await api.readMany([identity], options))[0]; },
    async writeMany(items, { signal } = {}) {
      live(signal);
      if (!Array.isArray(items) || items.length > 1024) throw cacheError('CACHE_INPUT_LIMIT');
      const now = currentTime();
      let batchBytes = 0;
      const writes = items.map(({ identity, value, token, metadata }) => {
        if (!validWriteToken(token, identity)) throw cacheError('CACHE_INVALID_TOKEN');
        const record = createCacheRecord(identity, value, policyFor(identity), now, metadata);
        batchBytes += record.bytes;
        if (batchBytes > maxBatchBytes) throw cacheError('CACHE_INPUT_LIMIT');
        return { record, token };
      });
      live(signal);
      let result;
      try { result = await store.putMany(writes, { signal }); }
      catch (error) {
        emit('storageErrors', '', error.code || 'CACHE_STORAGE');
        if (error.code !== 'CACHE_QUOTA' || signal?.aborted) throw error;
        // Retry storage once, never rerun a provider. Evict affected namespaces only.
        for (const namespace of new Set(items.map(item => item.identity.namespace))) {
          const policy = policies.get(namespace);
          await store.prune({ namespace, maxBytes: Math.floor(policy.maxBytes * 0.75),
            maxEntries: Math.floor(policy.maxEntries * 0.75), now });
        }
        live(signal); result = await store.putMany(writes, { signal });
      }
      for (const key of result.written) emit('writes', writes.find(write => write.record.key === key).record.namespace);
      for (const key of result.skipped) emit('rejected', writes.find(write => write.record.key === key).record.namespace, 'invalidated');
      let maintenanceError;
      try {
        for (const namespace of new Set(items.map(item => item.identity.namespace))) {
          const policy = policies.get(namespace);
          await store.prune({ namespace, maxBytes: policy.maxBytes, maxEntries: policy.maxEntries, now });
        }
      } catch (error) { maintenanceError = error.code || 'CACHE_STORAGE'; emit('storageErrors', '', maintenanceError); }
      return { ...result, ...(maintenanceError ? { maintenanceError } : {}) };
    },
    async write(identity, value, options = {}) {
      const result = await api.writeMany([{ identity, value, token: options.token, metadata: options.metadata }], options);
      return { stored: result.written.includes(identity.key), ...(result.maintenanceError ? { maintenanceError: result.maintenanceError } : {}) };
    },
    async getOrLoad(identity, loader, { mode = 'prefer-cache', signal, metadata = {} } = {}) {
      live(signal); const policy = policyFor(identity);
      if (!CACHE_MODES.includes(mode)) throw cacheError('CACHE_INVALID_MODE');
      if (mode !== 'cache-only' && typeof loader !== 'function') throw cacheError('CACHE_INVALID_LOADER');
      if (mode === 'reload') await api.invalidate({ key: identity.key });
      live(signal);
      const initial = mode === 'no-store' ? null : await api.read(identity, { signal });
      if (initial?.hit && mode !== 'reload') return { ...initial, cache: 'hit', stored: true };
      if (mode === 'cache-only') return { hit: false, cache: 'miss', stored: false };
      // Another client can invalidate shared storage without owning this map.
      const flightKey = JSON.stringify([mode === 'no-store' ? 'no-store' : 'stored', identity.key, initial?.token.epochs ?? null]);
      const result = await flight.run(flightKey, async producerSignal => {
        live(producerSignal);
        let token = initial?.token;
        if (mode !== 'no-store') {
          const current = await api.read(identity, { signal: producerSignal });
          if (current.token.epochs.some((epoch, i) => epoch !== token.epochs[i])) throw cacheError('CACHE_INVALIDATED');
          if (current.hit && mode !== 'reload') return { ...current, cache: 'hit', stored: true };
          token = current.token;
        }
        const value = await loader(producerSignal); live(producerSignal);
        createCacheRecord(identity, value, policy, currentTime(), metadata);
        if (mode === 'no-store') return { hit: false, cache: 'bypass', stored: false, value };
        try {
          const written = await api.write(identity, value, { token, metadata, signal: producerSignal });
          if (!written.stored) throw cacheError('CACHE_INVALIDATED');
          return { hit: false, cache: 'miss', stored: true, value, ...written };
        } catch (error) {
          if (error.code === 'CANCELLED' || error.code === 'CACHE_INVALIDATED' || producerSignal.aborted) throw error;
          if (!isCachePersistenceError(error)) throw error;
          return { hit: false, cache: 'miss', stored: false, value, warning: error.code };
        }
      }, { signal, metadata: identity });
      live(signal); return structuredClone(result);
    },
    async invalidate(filter = {}) {
      live(); validateFilter(filter);
      flight.cancelWhere(identity => matchesFilter(identity, filter), cacheError('CACHE_INVALIDATED'));
      const result = await store.invalidate(filter); emit('invalidations', filter.namespace || '*'); return result;
    },
    async list(filter = {}) {
      live(); validateFilter(filter);
      const rows = await store.list(filter), now = currentTime(), result = [];
      for (const row of rows) {
        const policy = policies.get(row.namespace);
        if (!policy) continue;
        if (isCurrentRecord(row, row, policy, now)) result.push(structuredClone(row));
        else await store.removeIfUnchanged(row.key, row.writeId);
      }
      return result;
    },
    async stats(filter = {}) {
      const rows = await api.list(filter), namespaces = {};
      for (const row of rows) {
        const item = namespaces[row.namespace] ||= { entries: 0, bytes: 0 }; item.entries++; item.bytes += row.bytes;
      }
      return { entries: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), namespaces, counters: { ...counters }, inFlight: flight.size };
    },
    async prune(options = {}) { live(); return store.prune({ ...options, now: currentTime() }); },
    close() { if (closed) return; closed = true; flight.close(); store.close(); },
    get inFlight() { return flight.size; }
  };
  return Object.freeze(api);
}
