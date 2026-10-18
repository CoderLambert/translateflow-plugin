import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationCoordinator } from '../src/background/cache/translation-coordinator.js';
import { createCacheService } from '../src/background/cache/service.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createCacheIdentity } from '../src/shared/cache/identity.js';
import { createCacheRecord, normalizePolicy, CACHE_RECORD_VERSION } from '../src/shared/cache/record.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const identity = () => createCacheIdentity({ namespace: 'test', scope: 'page', revision: 'one', input: 'hello' });

test('effective providerText is what the translation coordinator actually sends', async () => {
  let received;
  const coordinator = createTranslationCoordinator(async input => {
    received = input.segments[0].text;
    return [{ id: 's', text: '翻译' }];
  });
  await coordinator.run({ requestId: 'provider-text', segments: [{ id: 's', text: 'cache locator', providerText: 'Actual sentence', format: 'plain' }], config: { provider: 'test' } });
  assert.equal(received, 'Actual sentence');
  coordinator.close();
});

test('request input mutations after run do not change the keyed execution', async () => {
  let received;
  const coordinator = createTranslationCoordinator(async input => {
    received = { text: input.segments[0].text, prompt: input.config.prompt };
    return [{ id: 's', text: '翻译' }];
  });
  const segments = [{ id: 's', text: 'Original', format: 'plain' }];
  const config = { provider: 'test', prompt: 'Original prompt' };
  const pending = coordinator.run({ requestId: 'pinned', segments, config });
  segments[0].text = 'Mutated'; config.prompt = 'Changed';
  await pending;
  assert.deepEqual(received, { text: 'Original', prompt: 'Original prompt' });
  coordinator.close();
});

test('identity extra properties cannot override the single stored envelope version', async () => {
  const key = await identity();
  const record = createCacheRecord({ ...key, recordVersion: 999, injected: 'not identity' }, 'value', normalizePolicy(), 1);
  assert.equal(record.recordVersion, CACHE_RECORD_VERSION);
  assert.equal(Object.hasOwn(record, 'injected'), false);
});

test('invalidation through a second client cannot make a new read join the stale producer', async () => {
  const store = createMemoryCacheStore();
  const cache = createCacheService({ store }).register('test');
  const other = createCacheService({ store }).register('test');
  const key = await identity();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const first = cache.getOrLoad(key, async () => { await wait; return 'obsolete'; });
  const rejected = assert.rejects(first, { code: 'CACHE_INVALIDATED' });
  await tick();
  await other.invalidate({ key: key.key });
  const second = cache.getOrLoad(key, async () => 'new');
  await tick(); release();
  await rejected;
  const result = await second;
  assert.equal(result.value, 'new');
  assert.equal((await cache.read(key)).value, 'new');
  cache.close(); other.close();
});
