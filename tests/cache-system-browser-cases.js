import { createIndexedDbCacheStore, CACHE_DATABASE_VERSION } from '../src/background/cache/storage-indexeddb.js';
import { createApplicationCache } from '../src/background/cache/application.js';
import { createCacheService } from '../src/background/cache/service.js';
import { createCacheIdentity } from '../src/shared/cache/identity.js';
import { createCacheRecord, normalizePolicy } from '../src/shared/cache/record.js';

const checks = [];
function equal(a, b, message) { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${message}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(value, message) { if (!value) throw Error(message); }
async function rejects(action, code) { let error; try { await action(); } catch (cause) { error = cause; } ok(error, 'expected rejection'); if (code) equal(error.code, code, 'error code'); }
async function check(name, body) { const start = performance.now(); await body(); checks.push({ name, status: 'PASS', durationMs: performance.now() - start }); }
function nativeOpen(name, version, upgrade) { return new Promise((resolve, reject) => { const request = indexedDB.open(name, version); request.onupgradeneeded = () => upgrade?.(request.result, request.transaction); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function nativeWrite(db, store, value) { return new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); }
function nativeRows(db, name) { return new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function inspect(name) { const db = await nativeOpen(name); const result = { version: db.version, stores: {} }; for (const name of db.objectStoreNames) result.stores[name] = await nativeRows(db, name); db.close(); return result; }
const database = suffix => `tf-cache-contract-${suffix}-${crypto.randomUUID()}`;
const makeIdentity = (text = 'hello', overrides = {}) => createCacheIdentity({ namespace: 'test', scope: 'scope', revision: 'strategy-1', input: text, ...overrides });
function make(name, policy = {}, clock = Date.now) { const store = createIndexedDbCacheStore({ databaseName: name }); const service = createCacheService({ store, clock }); service.register('test', policy); return { store, service }; }
async function seed(service, identity, value) { const { token } = await service.read(identity); return service.write(identity, value, { token }); }

export async function runBrowserCacheTests() {
  await check('fresh layout uses one general entry envelope and a separate epoch ledger', async () => {
    const name = database('fresh'), { service } = make(name); const id = await makeIdentity();
    await seed(service, id, { ready: true }); const state = await inspect(name);
    equal(state.version, CACHE_DATABASE_VERSION, 'physical version'); equal(Object.keys(state.stores).sort(), ['entries', 'epochs'], 'stores');
    equal(state.stores.entries[0].recordVersion, 1, 'envelope'); equal(state.stores.entries[0].value, { ready: true }, 'JSON value'); service.close();
  });
  for (const version of [2, 3]) await check(`upgrade v${version} discards only translation cache, preserves opaque explanation values and Reading DB`, async () => {
    const name = database(`upgrade-${version}`), readingName = name + '-reading';
    const old = await nativeOpen(name, version, db => {
      db.createObjectStore('translations', { keyPath: 'cacheKey' }); db.createObjectStore('pages', { keyPath: 'pageKey' }); db.createObjectStore('selection_explanations', { keyPath: 'cacheKey' });
    });
    await nativeWrite(old, 'translations', { cacheKey: 'old', sourceText: 'obsolete', translation: 'obsolete translation' });
    await nativeWrite(old, 'pages', { pageKey: 'page' });
    const result = { selectedCandidateIds: ['term'], explanation: '原始解释', translation: '释义' };
    await nativeWrite(old, 'selection_explanations', { cacheKey: 'opaque-explanation-id', result, createdAt: 123, lastAccessedAt: 456 }); old.close();
    const reading = await nativeOpen(readingName, 1, db => db.createObjectStore('records', { keyPath: 'id' }));
    await nativeWrite(reading, 'records', { id: 'record', history: ['do-not-touch'] }); reading.close();
    const application = createApplicationCache({ store: createIndexedDbCacheStore({ databaseName: name }) });
    const found = await application.lookupSelectionExplanation({ cacheKey: 'opaque-explanation-id' }); equal(found.hit, result, 'explanation opaque content'); equal(found.createdAt, 123, 'creation time');
    const state = await inspect(name); equal(state.version, 4, 'new version'); equal(state.stores.entries.length, 1, 'only preserved explanation');
    ok(!('translations' in state.stores) && !('selection_explanations' in state.stores), 'no runtime legacy stores');
    equal((await inspect(readingName)).stores.records, [{ id: 'record', history: ['do-not-touch'] }], 'Reading untouched'); application.close();
  });
  await check('blocked upgrade rejects, abandoned opener aborts upgrade, explicit retry succeeds', async () => {
    const name = database('blocked'); const held = await nativeOpen(name, 2, db => db.createObjectStore('translations', { keyPath: 'cacheKey' }));
    held.onversionchange = () => {}; const { service } = make(name), id = await makeIdentity();
    await rejects(() => service.read(id), 'CACHE_STORAGE_BLOCKED'); held.close();
    equal((await service.read(id)).hit, false, 'retry'); equal((await inspect(name)).version, 4, 'version after retry'); service.close();
  });
  await check('aborting an upgrade rolls back explanation relocation rather than partially deleting data', async () => {
    const name = database('bad-upgrade'); const db = await nativeOpen(name, 2, value => {
      value.createObjectStore('translations', { keyPath: 'cacheKey' }); value.createObjectStore('selection_explanations', { keyPath: 'cacheKey' });
    });
    await nativeWrite(db, 'translations', { cacheKey: 'keep-until-commit', translation: 'old' });
    await nativeWrite(db, 'selection_explanations', { cacheKey: 'invalid', result: undefined }); db.close();
    const next = make(name); await rejects(async () => next.service.read(await makeIdentity()), 'CACHE_STORAGE'); next.service.close();
    const state = await inspect(name); equal(state.version, 2, 'aborted version'); equal(state.stores.translations.length, 1, 'old data not partially cleared');
  });
  await check('new strategy produces a miss without a DB upgrade or second parser', async () => {
    const name = database('strategy'), { service } = make(name); const old = await makeIdentity(), next = await makeIdentity('hello', { revision: 'strategy-2' });
    await seed(service, old, 'old strategy'); equal((await service.read(next)).hit, false, 'new policy miss');
    await seed(service, next, 'new strategy'); equal((await inspect(name)).version, 4, 'stable physical schema'); equal((await service.read(next)).value, 'new strategy', 'new strategy hit'); service.close();
  });
  await check('two independent clients share durable invalidation fences', async () => {
    const name = database('fences'), first = make(name), second = make(name), id = await makeIdentity();
    const { token } = await first.service.read(id); await second.service.invalidate({ namespace: 'test', scope: 'scope' });
    equal((await first.service.write(id, 'late writer', { token })).stored, false, 'fenced writer'); equal((await first.service.read(id)).hit, false, 'no resurrection'); first.service.close(); second.service.close();
  });
  await check('a failed multi-put transaction rolls back earlier successful requests', async () => {
    const name = database('atomic'), { service, store } = make(name), a = await makeIdentity('a'), b = await makeIdentity('b');
    const slots = await service.readMany([a, b]), policy = normalizePolicy();
    const good = createCacheRecord(a, 'good', policy, Date.now()), bad = createCacheRecord(b, 'bad', policy, Date.now()); bad.value = () => 'uncloneable';
    await rejects(() => store.putMany([{ record: good, token: slots[0].token }, { record: bad, token: slots[1].token }]));
    equal((await service.stats()).entries, 0, 'atomic rollback'); service.close();
  });
  await check('cancellation before storage commit prevents the write', async () => {
    const name = database('cancel-write'), { service } = make(name), id = await makeIdentity(); const { token } = await service.read(id);
    const controller = new AbortController(), write = service.write(id, 'cancelled', { token, signal: controller.signal }); controller.abort();
    await rejects(() => write, 'CANCELLED'); equal((await service.read(id)).hit, false, 'not stored'); service.close();
  });
  await check('expired entries miss and TTL does not slide on access', async () => {
    let now = 1000; const name = database('ttl'), { service } = make(name, { ttlMs: 100 }, () => now), id = await makeIdentity();
    await seed(service, id, 'time-bound'); now = 1099; equal((await service.read(id)).hit, true, 'still fresh');
    now = 1100; equal((await service.read(id)).hit, false, 'expired'); equal((await service.stats()).entries, 0, 'expired deleted'); service.close();
  });
  await check('LRU is scoped and size/count budgets remove the oldest entry', async () => {
    let now = 1000; const name = database('lru'), { service } = make(name, { maxEntries: 2 }, () => now);
    const a = await makeIdentity('a'), b = await makeIdentity('b'), c = await makeIdentity('c');
    await seed(service, a, 'a'); now++; await seed(service, b, 'b'); now++; await service.read(a); now++; await seed(service, c, 'c');
    equal((await service.read(b)).hit, false, 'least recent evicted'); equal((await service.read(a)).hit, true, 'touched entry retained'); service.close();
  });
  await check('translation namespace quota never evicts independent explanation entries', async () => {
    const name = database('quota-isolation');
    let now = 1000;
    const cache = createCacheService({ store: createIndexedDbCacheStore({ databaseName: name }), clock: () => now });
    for (const namespace of ['translation', 'subtitle-translation', 'selection-explanation']) cache.register(namespace);
    const explain = await makeIdentity('explain', { namespace: 'selection-explanation' });
    const page = await makeIdentity('page', { namespace: 'translation' });
    const subtitle = await makeIdentity('subtitle', { namespace: 'subtitle-translation' });
    await seed(cache, explain, { explanation: 'persist independently' }); now++;
    await seed(cache, page, 'A'.repeat(700)); now++;
    await seed(cache, subtitle, 'B'.repeat(700));
    const selected = (await Promise.all(['translation', 'subtitle-translation'].map(namespace =>
      cache.list({ namespace })))).flat();
    const limit = Math.max(...selected.map(row => row.bytes));
    const pruned = await cache.prune({ namespaces: ['translation', 'subtitle-translation'], maxBytes: limit });
    ok(pruned.deleted >= 1, 'translation budget enforced');
    const left = (await Promise.all(['translation', 'subtitle-translation'].map(namespace =>
      cache.list({ namespace })))).flat();
    ok(left.reduce((sum, row) => sum + row.bytes, 0) <= limit, 'combined translation budget');
    equal((await cache.read(explain)).value, { explanation: 'persist independently' }, 'explanation preserved');
    await rejects(() => cache.prune({ namespace: 'translation', namespaces: ['translation'] }), 'CACHE_INVALID_FILTER');
    cache.close();
  });
  await check('invalid record eviction cannot delete a concurrently refreshed value', async () => {
    const name = database('compare-delete'), { service, store } = make(name), id = await makeIdentity();
    await seed(service, id, 'old'); const old = (await store.lookup([id], Date.now()))[0].record;
    await seed(service, id, 'new'); equal(await store.removeIfUnchanged(id.key, old.writeId), false, 'old cleanup ignored');
    equal((await service.read(id)).value, 'new', 'new value retained'); service.close();
  });
  await check('prune handles malformed records missing the LRU index field', async () => {
    const name = database('corrupt'), { service } = make(name); await service.read(await makeIdentity());
    const db = await nativeOpen(name); await nativeWrite(db, 'entries', { key: 'bad', namespace: 'test', scope: 'scope', recordVersion: 999 }); db.close();
    equal((await service.prune()).deleted, 1, 'malformed record removed'); service.close();
  });
  await check('cache-only misses do not access fetch or any loader', async () => {
    const name = database('no-network'), { service } = make(name), id = await makeIdentity(); let calls = 0;
    const value = await service.getOrLoad(id, () => { calls++; throw Error('unexpected load'); }, { mode: 'cache-only' });
    equal(value.cache, 'miss', 'cache miss'); equal(calls, 0, 'loader calls'); service.close();
  });
  await check('close/reopen retains current generic records and releases native handles', async () => {
    const name = database('reopen'), a = make(name), id = await makeIdentity(); await seed(a.service, id, { value: 'persisted' }); a.service.close();
    const b = make(name); equal((await b.service.read(id)).value, { value: 'persisted' }, 'persistent content'); b.service.close();
  });
  await check('future database version is refused without destructive fallback', async () => {
    const name = database('future'), { service } = make(name), id = await makeIdentity(); await seed(service, id, 'stable');
    const future = await nativeOpen(name, 5, db => db.createObjectStore('future-store', { keyPath: 'id' }));
    await nativeWrite(future, 'future-store', { id: 'marker', keep: true }); future.close();
    await rejects(() => service.read(id), 'CACHE_STORAGE'); equal((await inspect(name)).stores['future-store'], [{ id: 'marker', keep: true }], 'future DB not deleted'); service.close();
  });
  return { status: 'PASS', count: checks.length, databaseVersion: CACHE_DATABASE_VERSION,
    execution: 'real Chromium / native IndexedDB / exact source ESM; not a compiled WXT extension', checks };
}
