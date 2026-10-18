import { cacheError } from './identity.js';

/** In-flight sharing only: no cache storage, business logic, retries or network access. */
export function createSingleFlight({ maxEntries = 128, maxConsumers = 1024 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxConsumers) || maxConsumers < 1) throw cacheError('CACHE_INVALID_POLICY');
  const entries = new Map();
  let closed = false, consumers = 0;
  function detach(entry, consumer) {
    if (!entry.consumers.delete(consumer)) return;
    consumers--;
    consumer.signal?.removeEventListener('abort', consumer.abort);
  }
  function settle(entry, failed, value) {
    if (entry.settled) return;
    entry.settled = true;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    for (const consumer of [...entry.consumers]) {
      detach(entry, consumer);
      failed ? consumer.reject(value) : consumer.resolve(value);
    }
  }
  function abortEntry(entry, reason = cacheError('CANCELLED', '缓存请求已取消。')) {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    entry.controller.abort(reason);
    settle(entry, true, reason);
  }
  function run(key, loader, { signal, metadata = null } = {}) {
    if (closed) return Promise.reject(cacheError('CACHE_CLOSED'));
    if (signal?.aborted) return Promise.reject(cacheError('CANCELLED'));
    if (typeof key !== 'string' || typeof loader !== 'function') return Promise.reject(cacheError('CACHE_INVALID_INPUT'));
    if (consumers >= maxConsumers) return Promise.reject(cacheError('CACHE_BUSY'));
    let entry = entries.get(key);
    let fresh = false;
    if (!entry) {
      if (entries.size >= maxEntries) return Promise.reject(cacheError('CACHE_BUSY'));
      entry = { key, controller: new AbortController(), consumers: new Set(), metadata, settled: false };
      entries.set(key, entry); fresh = true;
    }
    const promise = new Promise((resolve, reject) => {
      const consumer = { signal, resolve, reject, abort: null };
      consumer.abort = () => {
        detach(entry, consumer); reject(cacheError('CANCELLED'));
        // Evict before aborting; abort-ignoring producers cannot capture a retry.
        if (!entry.consumers.size && !entry.settled) abortEntry(entry);
      };
      entry.consumers.add(consumer); consumers++;
      signal?.addEventListener('abort', consumer.abort, { once: true });
      if (signal?.aborted) consumer.abort();
    });
    if (fresh) {
      Promise.resolve().then(() => {
        if (entry.controller.signal.aborted) throw cacheError('CANCELLED');
        return loader(entry.controller.signal);
      }).then(value => settle(entry, false, value), error => settle(entry, true, error));
    }
    return promise;
  }
  return Object.freeze({ run,
    cancelWhere(predicate, reason) { for (const entry of [...entries.values()]) if (predicate(entry.metadata, entry.key)) abortEntry(entry, reason); },
    close() { closed = true; for (const entry of [...entries.values()]) abortEntry(entry); },
    get size() { return entries.size; }, get consumers() { return consumers; }
  });
}
