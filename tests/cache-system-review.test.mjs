import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCacheService } from '../src/background/cache/service.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createCacheIdentity, byteLength } from '../src/shared/cache/identity.js';
import { createTranslationCoordinator } from '../src/background/cache/translation-coordinator.js';
import { configFingerprint } from '../src/shared/translation-cache-identity.js';
import { expectedTranslationCacheDatabases, assertRecoveredDatabases } from '../e2e/support/upgrade-expectations.mjs';
const next = () => new Promise(resolve => setImmediate(resolve));
const id = namespace => createCacheIdentity({ namespace, scope: 'page', revision: 'version', input: 'fixture' });

test('a narrow namespace client cannot delete another domain while inspecting stats', async () => {
  const store = createMemoryCacheStore(), first = createCacheService({ store }).register('one'), second = createCacheService({ store }).register('two');
  const key = await id('two'), { token } = await second.read(key); await second.write(key, 'preserved', { token });
  assert.equal((await first.list()).length, 0); assert.equal((await second.read(key)).value, 'preserved');
});
test('rejecting asynchronous validators cannot leak an unhandled rejection', async () => {
  const cache = createCacheService({ store: createMemoryCacheStore() }).register('test', { validate: async () => { throw Error('async unsupported'); } });
  const key = await id('test'), { token } = await cache.read(key);
  await assert.rejects(cache.write(key, 'value', { token }), { code: 'CACHE_ASYNC_VALIDATOR' }); await next();
});
for (const now of [NaN, Infinity, -1, 1.2]) test(`invalid clock fails before touching the backend: ${String(now)}`, async () => {
  let reads = 0; const memory = createMemoryCacheStore();
  const cache = createCacheService({ store: { ...memory, lookup: async () => { reads++; return []; } }, clock: () => now }).register('test');
  await assert.rejects(cache.read(await id('test')), { code: 'CACHE_INVALID_TIME' }); assert.equal(reads, 0);
});
test('memory backend preserves accurate envelope byte accounting after timestamp growth', async () => {
  let now = 9; const store = createMemoryCacheStore(), cache = createCacheService({ store, clock: () => now }).register('test');
  const key = await id('test'); let token = (await cache.read(key)).token; await cache.write(key, 'value', { token });
  now = 100000; token = (await cache.read(key)).token; await cache.write(key, 'new', { token });
  const [record] = await store.list(); assert.equal(record.createdAt, 9); assert.equal(record.bytes, byteLength(record));
});
test('namespace byte budget bounds entries even when no separate entry budget was supplied', async () => {
  const cache = createCacheService({ store: createMemoryCacheStore() }).register('test', { maxBytes: 500 });
  const key = await id('test'), { token } = await cache.read(key);
  await assert.rejects(cache.write(key, 'x'.repeat(501), { token }), { code: 'CACHE_ENTRY_TOO_LARGE' });
});
test('invalid coordinator inputs do not retain a ghost requestId', async () => {
  const coordinator = createTranslationCoordinator(async () => []);
  await assert.rejects(coordinator.run({ requestId: 'invalid', segments: [{ id: 'x', text: null }], config: {} }));
  assert.deepEqual(coordinator.cancel('invalid'), { cancelled: false });
});
test('coalesced translation consumers receive separate result objects', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }); let calls = 0;
  const coordinator = createTranslationCoordinator(async ({ segments }) => { calls++; await wait; return segments.map(item => ({ id: item.id, text: '译文' })); });
  const input = { segments: [{ id: 's', text: 'source', format: 'plain' }], config: { provider: 'fixture' }, pageUrl: 'https://fixture.invalid' };
  const a = coordinator.run({ ...input, requestId: 'a' }), b = coordinator.run({ ...input, requestId: 'b' });
  await next(); release(); const [x, y] = await Promise.all([a, b]); x[0].text = 'changed';
  assert.equal(calls, 1); assert.equal(y[0].text, '译文');
});
for (const parameter of ['outputTokens', 'reasoning']) test(`existing connection setting affects semantic identity: ${parameter}`, async () => {
  const base = { provider: 'openai-chat', model: 'fixture', prompt: 'translate', settings: {} };
  assert.notEqual(await configFingerprint(base), await configFingerprint({ ...base, settings: { [parameter]: parameter === 'outputTokens' ? 8192 : 'high' } }));
});
test('Content grouping keeps exact source and captured protection, not normalized lookalikes', async () => {
  const source = await readFile(new URL('../src/content/batch.js', import.meta.url), 'utf8');
  const registry = { modules: { runtime: { constants: {}, normalizeSourceText: s => s.replace(/\s+/g, ' ') }, dom: {} } };
  vm.runInNewContext(source, { globalThis: { __TRANSLATE_FLOW_CONTENT__: registry } });
  const make = (text, protectedIds = [], rich = false) => ({ text, normalizedText: text.replace(/\s+/g, ' '), protectedIds, rich, el: {} });
  const groups = registry.modules.batch.groupEntriesByText([make('A B'), make('A B'), make('A  B'), make('A B', [], true)]);
  assert.equal(groups.length, 3); assert.equal(groups[0].elements.length, 2);
});
test('historical WXT fixture permits only explicit new layout and refuses explanation loss', () => {
  const old = [{ name: 'ai_bilingual_translator', version: 2, stores: { translations: [{ id: 'old' }], pages: [{}], selection_explanations: [] } }];
  const result = expectedTranslationCacheDatabases(old);
  assert.deepEqual(result[0], { name: 'ai_bilingual_translator', version: 4, stores: { entries: [], epochs: [] } });
  assert.equal(old[0].stores.translations.length, 1);
  old[0].stores.selection_explanations.push({ cacheKey: 'must-preserve' });
  assert.throws(() => expectedTranslationCacheDatabases(old));
});
test('recovery snapshots cannot alter durable epoch fences or entry value', () => {
  const before = [{ name: 'ai_bilingual_translator', version: 4, stores: { entries: [{ key: 'a', lastAccessedAt: 1, value: 'fixed' }], epochs: [{ key: '*', value: 1 }] } }];
  const after = structuredClone(before); after[0].stores.entries[0].lastAccessedAt = 2;
  assert.doesNotThrow(() => assertRecoveredDatabases(before, after, 3));
  after[0].stores.epochs[0].value = 0; assert.throws(() => assertRecoveredDatabases(before, after, 3));
});
test('generic cache core contains no translation/Provider or DOM dependencies', async () => {
  for (const path of ['../src/background/cache/service.js', '../src/shared/cache/identity.js', '../src/shared/cache/record.js', '../src/shared/cache/single-flight.js']) {
    const code = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(code, /from\s+['"][^'"]*(?:translation|providers|reading-record)/u);
    assert.doesNotMatch(code, /(?:chrome\.|document\.|fetch\()/u);
  }
});

test('closing one memory client does not invalidate a shared backend owned by another', async () => {
  const store = createMemoryCacheStore(), first = createCacheService({ store }).register('test'), second = createCacheService({ store }).register('test');
  const key = await id('test'), { token } = await second.read(key); await second.write(key, 'retained', { token });
  first.close(); assert.equal((await second.read(key)).value, 'retained');
});

test('tightening TTL policy invalidates older envelopes without changing physical layout', async () => {
  const store = createMemoryCacheStore(), old = createCacheService({ store, clock: () => 100 }).register('test');
  const key = await id('test'), { token } = await old.read(key); await old.write(key, 'old', { token });
  const revised = createCacheService({ store, clock: () => 1000 }).register('test', { ttlMs: 100 });
  assert.equal((await revised.read(key)).hit, false);
});

test('aggregate write budget rejects the entire batch before backend mutation', async () => {
  let writes = 0; const store = createMemoryCacheStore(), cache = createCacheService({ store: { ...store,
    putMany: (...args) => { writes++; return store.putMany(...args); } }, maxBatchBytes: 600 }).register('test');
  const a = await id('test'), b = await createCacheIdentity({ namespace: 'test', scope: 'second', revision: 'v1', input: 'b' });
  const [ra, rb] = await cache.readMany([a, b]);
  await assert.rejects(cache.writeMany([{ identity: a, value: 'a'.repeat(200), token: ra.token },
    { identity: b, value: 'b'.repeat(200), token: rb.token }]), { code: 'CACHE_INPUT_LIMIT' });
  assert.equal(writes, 0); assert.equal((await cache.stats()).entries, 0);
});
