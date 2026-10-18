import { test, expect } from './support/extension-fixture.mjs';

// Runs ONLY on an actual production WXT extension using the repository's harness.
// Core Node tests do not substitute for these browser integration checks.
test.beforeEach(async ({ harness }) => { await harness.reset(); });
const pageUrl = 'https://cache-contract.invalid/article';
const source = text => [{ id: 'source', text, format: 'plain' }];
async function read(harness, text, url = pageUrl, configSnapshotId) {
  const result = await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl: url, segments: source(text), configSnapshotId });
  expect(result.ok).toBe(true); return result;
}
async function write(harness, text, lookup, translation, url = pageUrl) {
  return harness.runtime({ type: 'CACHE_STORE', pageUrl: url, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: text, translation, format: 'plain', cacheToken: lookup.writeTokens[0].token }] });
}

test('compiled facade uses one current entry format and remaps IDs without Provider calls', async ({ harness }) => {
  const text = 'An exact public cache contract fixture.', lookup = await read(harness, text);
  expect(lookup.hits).toHaveLength(0);
  expect(await write(harness, text, lookup, '明确的公开缓存测试文本。')).toMatchObject({ ok: true, stored: 1 });
  const found = await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl, configSnapshotId: lookup.configSnapshotId,
    segments: [{ id: 'selection', text, format: 'plain' }], cacheOnly: true });
  expect(found.hits).toEqual([{ id: 'selection', text: '明确的公开缓存测试文本。' }]);
  expect(harness.server.calls).toHaveLength(0);
  const db = await harness.serviceWorker.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ai_bilingual_translator'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const entries = await new Promise((resolve, reject) => {
      const request = database.transaction('entries').objectStore('entries').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const result = { version: database.version, stores: [...database.objectStoreNames], entries }; database.close(); return result;
  });
  expect(db.version).toBe(4); expect(db.stores.sort()).toEqual(['entries', 'epochs']);
  expect(db.entries.every(item => item.recordVersion === 1)).toBe(true);
});

test('page invalidation rejects an in-flight stale cache write without touching another page', async ({ harness }) => {
  const text = 'Clear does not allow old writes to resurrect.', a = await read(harness, text), otherUrl = 'https://cache-contract.invalid/other';
  const b = await read(harness, text, otherUrl);
  expect(await write(harness, text, b, '其它页面有效译文', otherUrl)).toMatchObject({ ok: true, stored: 1 });
  expect(await harness.runtime({ type: 'CACHE_CLEAR_PAGE', pageUrl })).toMatchObject({ ok: true });
  expect(await write(harness, text, a, '不应保存')).toMatchObject({ ok: true, stored: 0, skipped: 1 });
  expect((await read(harness, text, otherUrl)).hits).toHaveLength(1);
  expect((await read(harness, text)).hits).toHaveLength(0);
  expect(harness.server.calls).toHaveLength(0);
});

test('invalid structured translation never enters cache and no legacy write is accepted', async ({ harness }) => {
  const text = 'Read ⟦TF:0:S⟧useMemo⟦TF:0:E⟧ carefully.', segments = [{ id: 'rich', text, format: 'tf-markers', protectedIds: [0] }];
  const lookup = await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl, segments }); expect(lookup.ok).toBe(true);
  const result = await harness.runtime({ type: 'CACHE_STORE', pageUrl, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: text, format: 'tf-markers', protectedIds: [0], translation: 'Missing the technical span.', cacheToken: lookup.writeTokens[0].token }] });
  expect(result.ok).toBe(false);
  const missingToken = await harness.runtime({ type: 'CACHE_STORE', pageUrl, configSnapshotId: lookup.configSnapshotId,
    items: [{ sourceText: 'No read token', translation: 'Must not silently use a legacy path' }] });
  expect(missingToken).toMatchObject({ ok: false, errorCode: 'CACHE_INVALID_TOKEN' });
  expect((await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl, segments, cacheOnly: true })).hits).toHaveLength(0);
  expect(harness.server.calls).toHaveLength(0);
});
