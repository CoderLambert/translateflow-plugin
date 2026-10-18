import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, createCacheIdentity, opaqueCacheIdentity } from '../src/shared/cache/identity.js';
import { normalizePolicy } from '../src/shared/cache/record.js';
import { createSingleFlight } from '../src/shared/cache/single-flight.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createCacheService } from '../src/background/cache/service.js';

const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const identity = (input = 'same', extra = {}) => createCacheIdentity({ namespace: 'test', scope: 'page-a', revision: 'r1', input, ...extra });
function setup(policy = {}, store = createMemoryCacheStore()) {
  let now = 1000; const events = [];
  const cache = createCacheService({ store, clock: () => now, onEvent: event => events.push(event) });
  cache.register('test', policy);
  return { cache, store, events, time(value) { now = value; } };
}
async function seed(cache, key, value) { const { token } = await cache.read(key); return cache.write(key, value, { token }); }

for (const [name, left, right] of [
  ['property order', { z: 1, a: { b: 2, a: 3 } }, { a: { a: 3, b: 2 }, z: 1 }],
  ['empty object order', { x: [], y: {} }, { y: {}, x: [] }],
]) test(`canonical identity stable for ${name}`, async () => { assert.equal((await identity(left)).key, (await identity(right)).key); });
for (const [name, value] of [['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['function', () => {}], ['BigInt', 1n],
  ['Date', new Date()], ['Map', new Map()], ['sparse array', Array(2)], ['symbol', Symbol('x')]])
  test(`reject non-JSON ${name} rather than collide`, () => assert.throws(() => canonicalJson(value)));
test('reject cycles and accessor properties without running getter', () => {
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => canonicalJson(cyclic));
  let touched = false; const accessor = { get secret() { touched = true; return 1; } };
  assert.throws(() => canonicalJson(accessor)); assert.equal(touched, false);
});
test('object/array order, types, null and missing remain distinct', async () => {
  const inputs = [null, {}, { a: null }, [], [1, 2], [2, 1], 1, '1', false, 'false'];
  const keys = await Promise.all(inputs.map(x => identity(x).then(i => i.key)));
  assert.equal(new Set(keys).size, inputs.length);
});
test('reject overly deep and large identity inputs', () => {
  assert.throws(() => canonicalJson({ a: { b: 1 } }, { maxDepth: 1 }));
  assert.throws(() => canonicalJson('abc', { maxChars: 2 }));
});
for (const patch of [{ namespace: 'other' }, { scope: 'page-b' }, { revision: 'r2' }])
  test(`isolate identity ${JSON.stringify(patch)}`, async () => assert.notEqual((await identity()).key, (await identity('same', patch)).key));
test('opaque IDs namespace and strategy cannot collide', () => {
  assert.notEqual(opaqueCacheIdentity('one', 'key').key, opaqueCacheIdentity('two', 'key').key);
  assert.notEqual(opaqueCacheIdentity('one', 'key').key, opaqueCacheIdentity('one', 'key', 'r2').key);
});

for (const invalid of [{ ttlMs: -1 }, { maxEntries: 0 }, { ttlMs: Infinity }, { maxBytes: 1.5 }, { validate: false }])
  test(`reject bad policy ${JSON.stringify(invalid)}`, () => assert.throws(() => normalizePolicy(invalid)));

test('cache-only miss never calls loader or network', async () => {
  const { cache } = setup(); let calls = 0;
  assert.deepEqual(await cache.getOrLoad(await identity(), () => { calls++; throw Error('must not call'); }, { mode: 'cache-only' }),
    { hit: false, cache: 'miss', stored: false });
  assert.equal(calls, 0);
});
test('prefer-cache invokes loader once, returns deep copies on later hits', async () => {
  const { cache } = setup(); let calls = 0; const key = await identity();
  const first = await cache.getOrLoad(key, async () => { calls++; return { nested: ['value'] }; });
  first.value.nested[0] = 'mutated';
  const next = await cache.getOrLoad(key, async () => { calls++; return null; });
  assert.deepEqual(next.value, { nested: ['value'] }); assert.equal(next.cache, 'hit'); assert.equal(calls, 1);
});
test('empty strings, zero, false and null are valid hits when policy permits', async () => {
  const { cache } = setup();
  for (const value of ['', 0, false, null]) {
    const key = await identity({ value }); await seed(cache, key, value);
    const result = await cache.read(key); assert.equal(result.hit, true); assert.equal(result.value, value);
  }
});
test('TTL is absolute; reads do not renew it', async () => {
  const env = setup({ ttlMs: 50 }); const key = await identity(); await seed(env.cache, key, 'original');
  env.time(1049); assert.equal((await env.cache.read(key)).hit, true);
  env.time(1050); assert.equal((await env.cache.read(key)).hit, false); assert.equal((await env.cache.stats()).entries, 0);
});
test('zero TTL is nonexpiring rather than an immediate miss', async () => {
  const env = setup(); const key = await identity(); await seed(env.cache, key, 'stable');
  env.time(1000000); assert.equal((await env.cache.read(key)).value, 'stable');
});
test('namespace, scope and revision invalidation isolation', async () => {
  const env = setup(); env.cache.register('other');
  const a = await identity('a'), b = await identity('b', { scope: 'page-b' }), c = await identity('c', { namespace: 'other' });
  for (const key of [a, b, c]) await seed(env.cache, key, key.key);
  assert.equal((await env.cache.invalidate({ namespace: 'test', scope: 'page-a' })).deleted, 1);
  assert.equal((await env.cache.read(a)).hit, false); assert.equal((await env.cache.read(b)).hit, true); assert.equal((await env.cache.read(c)).hit, true);
  await env.cache.invalidate({ namespace: 'test' }); assert.equal((await env.cache.read(c)).hit, true);
});
test('write token required; old lookup cannot resurrect data after clear', async () => {
  const { cache } = setup(); const key = await identity(), { token } = await cache.read(key);
  await assert.rejects(cache.write(key, 'missing-token'), { code: 'CACHE_INVALID_TOKEN' });
  await cache.invalidate({ key: key.key });
  assert.equal((await cache.write(key, 'late', { token })).stored, false);
  assert.equal((await cache.read(key)).hit, false);
});
test('tokens cannot be substituted across keys', async () => {
  const { cache } = setup(); const a = await identity('a'), b = await identity('b');
  const { token } = await cache.read(a);
  await assert.rejects(cache.write(b, 'wrong', { token }), { code: 'CACHE_INVALID_TOKEN' });
});
test('global invalidation fences old writes across multiple cache service instances', async () => {
  const store = createMemoryCacheStore(), first = setup({}, store).cache, second = setup({}, store).cache;
  const key = await identity(), { token } = await first.read(key);
  await second.invalidate(); assert.equal((await first.write(key, 'stale', { token })).stored, false);
});
test('invalid values and rejected promises are not cached', async () => {
  const { cache } = setup({ validate: value => typeof value === 'string' && value !== 'bad' });
  const key = await identity();
  await assert.rejects(cache.getOrLoad(key, async () => 'bad'), { code: 'CACHE_INVALID_VALUE' });
  await assert.rejects(cache.getOrLoad(key, async () => { throw Error('provider failed'); }), /provider failed/);
  assert.equal((await cache.read(key)).hit, false);
});
test('async validators are rejected rather than always truthy', async () => {
  const { cache } = setup({ validate: async () => false }); const key = await identity();
  await assert.rejects(cache.getOrLoad(key, async () => 'value'), { code: 'CACHE_ASYNC_VALIDATOR' });
});
test('oversized entries fail without writing', async () => {
  const { cache } = setup({ maxEntryBytes: 100 });
  await assert.rejects(cache.getOrLoad(await identity(), async () => 'x'.repeat(101)), { code: 'CACHE_ENTRY_TOO_LARGE' });
  assert.equal((await cache.stats()).entries, 0);
});
test('LRU pruning obeys namespace count budget and touch order', async () => {
  const env = setup({ maxEntries: 2 });
  const a = await identity('a'), b = await identity('b'), c = await identity('c');
  await seed(env.cache, a, 'a'); env.time(1001); await seed(env.cache, b, 'b');
  env.time(1002); await env.cache.read(a); env.time(1003); await seed(env.cache, c, 'c');
  assert.equal((await env.cache.read(a)).hit, true); assert.equal((await env.cache.read(b)).hit, false); assert.equal((await env.cache.read(c)).hit, true);
});
test('no-store bypass neither reads nor writes storage', async () => {
  const base = createMemoryCacheStore(); let accesses = 0;
  const store = { ...base, lookup: (...args) => { accesses++; return base.lookup(...args); }, putMany: (...args) => { accesses++; return base.putMany(...args); } };
  const { cache } = setup({}, store); const result = await cache.getOrLoad(await identity(), async () => 'private', { mode: 'no-store' });
  assert.equal(result.cache, 'bypass'); assert.equal(result.value, 'private'); assert.equal(accesses, 0);
});
test('reload replaces only the requested key', async () => {
  const { cache } = setup(); const a = await identity('a'), b = await identity('b');
  await seed(cache, a, 'old'); await seed(cache, b, 'untouched');
  const result = await cache.getOrLoad(a, async () => 'new', { mode: 'reload' });
  assert.equal(result.value, 'new'); assert.equal((await cache.read(b)).value, 'untouched');
});
test('same-key concurrent misses coalesce into a single loader', async () => {
  const { cache } = setup(); const key = await identity(), started = defer(), finish = defer(); let calls = 0;
  const load = async () => { calls++; started.resolve(); return finish.promise; };
  const a = cache.getOrLoad(key, load), b = cache.getOrLoad(key, load);
  await started.promise; await turn(); finish.resolve('one');
  assert.equal((await a).value, 'one'); assert.equal((await b).value, 'one'); assert.equal(calls, 1);
});
test('cache invalidation cancels an in-flight load and prevents a late result store', async () => {
  const { cache } = setup(); const key = await identity(), started = defer(), finish = defer();
  const pending = cache.getOrLoad(key, async () => { started.resolve(); return finish.promise; });
  const rejected = assert.rejects(pending, { code: 'CACHE_INVALIDATED' });
  await started.promise; await cache.invalidate({ key: key.key }); await rejected; finish.resolve('late'); await turn();
  assert.equal((await cache.read(key)).hit, false);
});
test('quota retries storage only once without recomputing the loaded value', async () => {
  const base = createMemoryCacheStore(); let writes = 0, loads = 0;
  const store = { ...base, async putMany(...args) { if (++writes === 1) throw Object.assign(Error('quota'), { code: 'CACHE_QUOTA' }); return base.putMany(...args); } };
  const { cache } = setup({}, store);
  const result = await cache.getOrLoad(await identity(), async () => { loads++; return 'ready'; });
  assert.equal(result.stored, true); assert.equal(writes, 2); assert.equal(loads, 1);
});
test('storage failure after successful loader returns value with an explicit warning', async () => {
  const base = createMemoryCacheStore(); let loads = 0;
  const { cache } = setup({}, { ...base, async putMany() { throw Object.assign(Error('disk'), { code: 'CACHE_STORAGE' }); } });
  const result = await cache.getOrLoad(await identity(), async () => { loads++; return 'available'; });
  assert.equal(result.value, 'available'); assert.equal(result.stored, false); assert.equal(result.warning, 'CACHE_STORAGE'); assert.equal(loads, 1);
});
test('telemetry contains no source, key, URL or value', async () => {
  const env = setup(); await env.cache.getOrLoad(await identity('private-source'), async () => 'private-answer');
  const events = JSON.stringify(env.events); assert.doesNotMatch(events, /private-|page-a|https|key/);
});
test('close prevents new work and aborts current consumers', async () => {
  const { cache } = setup(); cache.close();
  await assert.rejects(cache.read(await identity()), { code: 'CACHE_CLOSED' });
});

test('single-flight cancellation is prompt even if loader ignores abort', async () => {
  const f = createSingleFlight(), a = new AbortController(), finish = defer(); let underlying;
  const promise = f.run('same', signal => { underlying = signal; return finish.promise; }, { signal: a.signal });
  const rejection = assert.rejects(promise, { code: 'CANCELLED' }); await turn(); a.abort(); await rejection;
  assert.equal(underlying.aborted, true); assert.equal(f.size, 0); finish.resolve('ignored'); await turn();
});
test('single-flight one consumer cannot cancel another', async () => {
  const f = createSingleFlight(), a = new AbortController(), finish = defer(); let underlying;
  const first = f.run('same', signal => { underlying = signal; return finish.promise; }, { signal: a.signal });
  const second = f.run('same', () => { throw Error('must share'); }); const rejection = assert.rejects(first, { code: 'CANCELLED' });
  await turn(); a.abort(); await rejection; assert.equal(underlying.aborted, false);
  finish.resolve('ok'); assert.equal(await second, 'ok'); assert.equal(f.size, 0);
});
test('aborted old entry/finally cannot delete or join an immediate retry', async () => {
  const f = createSingleFlight(), a = new AbortController(), old = defer(), fresh = defer(); let count = 0;
  const first = f.run('key', () => { count++; return old.promise; }, { signal: a.signal });
  const rejection = assert.rejects(first, { code: 'CANCELLED' }); await turn(); a.abort(); await rejection;
  const second = f.run('key', () => { count++; return fresh.promise; }); await turn();
  old.reject(Error('late failure')); await turn(); assert.equal(f.size, 1);
  const third = f.run('key', () => { throw Error('new entry lost'); }); fresh.resolve('current');
  assert.equal(await second, 'current'); assert.equal(await third, 'current'); assert.equal(count, 2); assert.equal(f.size, 0);
});
test('single-flight rejects overload and duplicate namespace registration', async () => {
  const f = createSingleFlight({ maxEntries: 1 }), finish = defer(); const pending = f.run('a', () => finish.promise);
  await assert.rejects(f.run('b', () => 1), { code: 'CACHE_BUSY' }); finish.resolve('a'); await pending;
  const { cache } = setup(); assert.throws(() => cache.register('test'), { code: 'CACHE_DUPLICATE_NAMESPACE' });
});
