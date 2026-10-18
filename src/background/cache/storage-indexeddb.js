import { cacheError, opaqueCacheIdentity, validateIdentity, byteLength } from '../../shared/cache/identity.js';
import { CACHE_RECORD_VERSION, createCacheRecord, normalizePolicy, epochKeys, validWriteToken,
  validateFilter, matchesFilter, invalidationEpochKey } from '../../shared/cache/record.js';

// Physical layout only. A translation strategy/prompt change MUST NOT increment this.
export const CACHE_DATABASE = 'ai_bilingual_translator';
export const CACHE_DATABASE_VERSION = 4;
const ENTRIES = 'entries', EPOCHS = 'epochs';

/** The only owner of the general cache IndexedDB. Never opens Reading or dictionary storage. */
export function createIndexedDbCacheStore({ indexedDBFactory = globalThis.indexedDB,
  keyRange = globalThis.IDBKeyRange, databaseName = CACHE_DATABASE, openTimeoutMs = 10000 } = {}) {
  let connection = null, opening = null;
  if (!Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1) throw cacheError('CACHE_INVALID_POLICY');
  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening.promise;
    const op = { failed: false, request: null, promise: null, refuse: null };
    op.promise = new Promise((resolve, reject) => {
      let timer;
      const refuse = error => {
        if (op.failed) return;
        op.failed = true; clearTimeout(timer);
        if (opening === op) opening = null;
        reject(error);
      };
      op.refuse = refuse;
      try { op.request = indexedDBFactory.open(databaseName, CACHE_DATABASE_VERSION); }
      catch (error) { refuse(cacheError('CACHE_STORAGE', '无法打开缓存数据库。', error)); return; }
      const request = op.request;
      timer = setTimeout(() => refuse(cacheError('CACHE_STORAGE_TIMEOUT')), openTimeoutMs);
      request.onblocked = () => refuse(cacheError('CACHE_STORAGE_BLOCKED', '缓存升级被旧窗口阻塞，请关闭旧扩展页面后重试。'));
      request.onerror = () => refuse(cacheError('CACHE_STORAGE', '缓存数据库操作失败。', request.error));
      request.onupgradeneeded = () => {
        if (op.failed) { request.transaction.abort(); return; }
        try { upgrade(request.result, request.transaction); }
        catch (error) { refuse(cacheError('CACHE_UPGRADE_FAILED', '缓存升级失败，原事务已撤销。', error)); request.transaction.abort(); }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (op.failed) { db.close(); return; }
        if (opening === op) opening = null;
        connection = db;
        db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        resolve(db);
      };
    });
    // Synchronous factory failure must not leave a rejected opening cached forever.
    if (!op.failed) opening = op;
    return op.promise;
  }

  function upgrade(db, tx) {
    if (!db.objectStoreNames.contains(ENTRIES)) {
      const store = db.createObjectStore(ENTRIES, { keyPath: 'key' });
      store.createIndex('namespace', 'namespace');
      store.createIndex('namespaceScope', ['namespace', 'scope']);
      store.createIndex('lastAccessedAt', 'lastAccessedAt');
    }
    if (!db.objectStoreNames.contains(EPOCHS)) db.createObjectStore(EPOCHS, { keyPath: 'key' });
    // Disposable translations have NO legacy decoder, converter or fallback reader.
    for (const name of ['translations', 'pages']) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
    // The independent explanation cache is not disposable user history. Move its
    // opaque result envelope once; never interpret/retranslate its answer content.
    // There is no old-store reader after this transaction commits.
    if (db.objectStoreNames.contains('selection_explanations')) {
      const request = tx.objectStore('selection_explanations').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { db.deleteObjectStore('selection_explanations'); return; }
        try {
          const old = cursor.value;
          const identity = opaqueCacheIdentity('selection-explanation', old.cacheKey);
          const now = Number.isSafeInteger(old.createdAt) && old.createdAt >= 0 ? old.createdAt : Date.now();
          const record = createCacheRecord(identity, old.result, normalizePolicy(), now);
          record.lastAccessedAt = Number.isSafeInteger(old.lastAccessedAt) && old.lastAccessedAt >= 0 ? old.lastAccessedAt : now;
          record.bytes = measure(record);
          tx.objectStore(ENTRIES).put(record);
          cursor.continue();
        } catch { tx.abort(); }
      };
    }
  }

  async function transact(mode, work, signal) {
    if (signal?.aborted) throw cacheError('CANCELLED');
    const db = await open();
    if (signal?.aborted) throw cacheError('CANCELLED');
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = db.transaction([ENTRIES, EPOCHS], mode); }
      catch (error) { reject(cacheError('CACHE_STORAGE', '缓存事务无法启动。', error)); return; }
      const fail = error => { failure ||= error; try { tx.abort(); } catch {} };
      const then = (request, fn) => {
        request.onsuccess = () => { try { fn(request.result); } catch (error) { fail(error); } };
        // Default request-error propagation aborts the transaction; resolve only on commit.
      };
      const cancel = () => fail(cacheError('CANCELLED'));
      signal?.addEventListener('abort', cancel, { once: true });
      tx.oncomplete = () => { signal?.removeEventListener('abort', cancel); resolve(result); };
      tx.onerror = event => { failure ||= event.target?.error || tx.error; };
      tx.onabort = () => { signal?.removeEventListener('abort', cancel); reject(typeof failure?.code === 'string' ? failure : cacheError(
        failure?.name === 'QuotaExceededError' || tx.error?.name === 'QuotaExceededError' ? 'CACHE_QUOTA' : 'CACHE_STORAGE',
        '缓存事务未提交。', failure || tx.error)); };
      try { work(tx, then, value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  }

  function readEpochs(tx, then, identities, done) {
    const keys = [...new Set(identities.flatMap(epochKeys))], values = new Map();
    if (!keys.length) { done([]); return; }
    for (const key of keys) then(tx.objectStore(EPOCHS).get(key), record => {
      const value = record?.value ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) throw cacheError('CACHE_INVALID_EPOCH');
      values.set(key, value);
      if (values.size === keys.length) done(identities.map(identity => ({ key: identity.key, epochs: epochKeys(identity).map(k => values.get(k)) })));
    });
  }

  function cursorFor(store, filter, order = false) {
    if (filter.key !== undefined) return store.openCursor(keyRange.only(filter.key));
    if (order) return store.index('lastAccessedAt').openCursor();
    if (filter.scope !== undefined) return store.index('namespaceScope').openCursor(keyRange.only([filter.namespace, filter.scope]));
    if (filter.namespace !== undefined) return store.index('namespace').openCursor(keyRange.only(filter.namespace));
    return store.openCursor();
  }

  function walk(request, then, each, done) {
    then(request, cursor => { if (!cursor) { done(); return; } each(cursor); cursor.continue(); });
  }

  const api = {
    async lookup(identities, now) {
      identities.forEach(validateIdentity);
      if (!identities.length) return [];
      return transact('readwrite', (tx, then, finish) => {
        readEpochs(tx, then, identities, tokens => {
          const result = new Array(identities.length); let left = identities.length;
          identities.forEach((identity, index) => then(tx.objectStore(ENTRIES).get(identity.key), record => {
            if (record?.recordVersion === CACHE_RECORD_VERSION && Number.isSafeInteger(record.lastAccessedAt)) {
              record.lastAccessedAt = Math.max(record.lastAccessedAt, now);
              record.bytes = measure(record); tx.objectStore(ENTRIES).put(record);
            }
            result[index] = { record, token: tokens[index] };
            if (--left === 0) finish(result);
          }));
        });
      });
    },
    async putMany(writes, { signal } = {}) {
      for (const { record, token } of writes) if (!validWriteToken(token, validateIdentity(record))) throw cacheError('CACHE_INVALID_TOKEN');
      if (!writes.length) return { written: [], skipped: [] };
      return transact('readwrite', (tx, then, finish) => {
        readEpochs(tx, then, writes.map(item => item.record), tokens => {
          const result = { written: [], skipped: [] };
          writes.forEach(({ record, token }, index) => {
            if (token.epochs.some((epoch, n) => epoch !== tokens[index].epochs[n])) { result.skipped.push(record.key); return; }
            then(tx.objectStore(ENTRIES).get(record.key), existing => {
              const next = structuredClone(record);
              if (existing?.recordVersion === CACHE_RECORD_VERSION && Number.isSafeInteger(existing.createdAt)) next.createdAt = existing.createdAt;
              next.bytes = measure(next); tx.objectStore(ENTRIES).put(next); result.written.push(record.key);
            });
          });
          finish(result);
        });
      }, signal);
    },
    async removeIfUnchanged(key, writeId) {
      return transact('readwrite', (tx, then, finish) => then(tx.objectStore(ENTRIES).get(key), record => {
        const remove = record && record.writeId === writeId;
        if (remove) tx.objectStore(ENTRIES).delete(key);
        finish(Boolean(remove));
      }));
    },
    async list(filter = {}) {
      validateFilter(filter);
      return transact('readonly', (tx, then, finish) => {
        const result = [];
        walk(cursorFor(tx.objectStore(ENTRIES), filter), then, cursor => {
          if (matchesFilter(cursor.value, filter)) result.push(cursor.value);
        }, () => finish(result));
      });
    },
    async invalidate(filter = {}) {
      validateFilter(filter);
      return transact('readwrite', (tx, then, finish) => {
        const epochs = tx.objectStore(EPOCHS), key = invalidationEpochKey(filter);
        then(epochs.get(key), old => {
          const value = (old?.value ?? 0) + 1;
          if (!Number.isSafeInteger(value) || value < 1) throw cacheError('CACHE_INVALID_EPOCH');
          // A global clear subsumes every child epoch, bounding long-term ledger growth.
          if (key === '*') epochs.clear();
          epochs.put({ key, value });
          let deleted = 0;
          walk(cursorFor(tx.objectStore(ENTRIES), filter), then, cursor => {
            if (matchesFilter(cursor.value, filter)) { cursor.delete(); deleted++; }
          }, () => finish({ deleted }));
        });
      });
    },
    async prune({ namespace, namespaces, maxEntries = Number.MAX_SAFE_INTEGER, maxBytes = Number.MAX_SAFE_INTEGER, now = Date.now() } = {}) {
      if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw cacheError('CACHE_INVALID_POLICY');
      if (namespaces !== undefined && (namespace !== undefined || !Array.isArray(namespaces) ||
          namespaces.length < 1 || namespaces.length > 16 || new Set(namespaces).size !== namespaces.length)) {
        throw cacheError('CACHE_INVALID_FILTER');
      }
      if (namespaces) namespaces.forEach(value => validateFilter({ namespace: value }));
      const allowed = namespaces ? new Set(namespaces) : null;
      const filter = namespace === undefined ? {} : { namespace }; validateFilter(filter);
      return transact('readwrite', (tx, then, finish) => {
        let bytes = 0, deleted = 0; const live = [];
        walk(cursorFor(tx.objectStore(ENTRIES), filter), then, cursor => {
          const row = cursor.value;
          if (!matchesFilter(row, filter) || allowed && !allowed.has(row.namespace)) return;
          if (row.recordVersion !== CACHE_RECORD_VERSION || !Number.isSafeInteger(row.bytes) || row.bytes < 1 ||
              !Number.isSafeInteger(row.lastAccessedAt) || row.lastAccessedAt < 0 ||
              !Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0 || (row.expiresAt && row.expiresAt <= now)) {
            cursor.delete(); deleted++; return;
          }
          bytes += row.bytes; live.push({ key: row.key, bytes: row.bytes, lastAccessedAt: row.lastAccessedAt });
        }, () => {
          live.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt || a.key.localeCompare(b.key));
          let removed = 0;
          while (live.length - removed > maxEntries || bytes > maxBytes) {
            const row = live[removed++]; tx.objectStore(ENTRIES).delete(row.key); bytes -= row.bytes; deleted++;
          }
          finish({ deleted, entries: live.length - removed, bytes });
        });
      });
    },
    close() {
      connection?.close(); connection = null;
      const active = opening; opening = null;
      active?.refuse(cacheError('CACHE_CLOSED'));
    }
  };
  return Object.freeze(api);
}

function measure(record) {
  for (let i = 0; i < 4; i++) { const bytes = byteLength(record); if (bytes === record.bytes) return bytes; record.bytes = bytes; }
  return record.bytes;
}
