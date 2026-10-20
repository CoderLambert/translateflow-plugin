import { test, expect } from './support/extension-fixture.mjs';

// Runs ONLY on an actual production WXT extension using the repository's harness.
// Core Node tests do not substitute for these browser integration checks.
test.beforeEach(async ({ harness }) => { await harness.reset(); });
const pageUrl = 'https://cache-contract.invalid/article';
const source = text => [{ id: 'source', text, format: 'plain' }];
async function read(harness, text, url = pageUrl, configSnapshotId) {
  const result = await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl: url, segments: source(text), configSnapshotId });
  if (!result.ok) {
    const second = await harness.runtime({ type: 'CACHE_LOOKUP', pageUrl: url, segments: source(text), configSnapshotId });
    const diagnostic = { initial: { ok: result.ok, errorCode: result.errorCode }, second: { ok: second.ok, errorCode: second.errorCode || '' }, providerCalls: harness.server.calls.length };
    console.log('[COLD_CACHE_DIAGNOSTIC]', JSON.stringify(diagnostic));
    await test.info().attach('cold-cache-diagnostic', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
  }
  // The diagnostic never replaces the initial result or retries an assertion.
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true }); return result;
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

async function failEntryWrites(harness, fail) {
  await harness.serviceWorker.evaluate(fail => {
    if (fail) {
      globalThis.__tfOriginalCachePut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === 'entries') throw new DOMException('Synthetic cache quota failure', 'QuotaExceededError');
        return globalThis.__tfOriginalCachePut.apply(this, args);
      };
    } else if (globalThis.__tfOriginalCachePut) {
      IDBObjectStore.prototype.put = globalThis.__tfOriginalCachePut;
      delete globalThis.__tfOriginalCachePut;
    }
  }, fail);
}

test('compiled Content keeps generated Page text visible after an actual IDB write failure', async ({ harness }) => {
  const page = await harness.open('/article'); await harness.inject(page);
  await failEntryWrites(harness, true);
  try {
    const translated = await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'quota-page' });
    expect(translated, JSON.stringify(translated)).toMatchObject({ ok: true, apiTranslated: 3, cacheWarning: 'CACHE_QUOTA' });
    await expect(page.locator('.abt-translation')).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(2);
    expect(await harness.runtime({ type: 'CACHE_STATS' })).toMatchObject({ ok: true, segmentCount: 0 });
    await page.screenshot({ path: test.info().outputPath('page-cache-write-failure.png') });
  } finally { await failEntryWrites(harness, false); }
  await harness.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  expect(await harness.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: 0 });
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  expect(harness.server.calls).toHaveLength(2);
});

test('compiled Selection displays the verified translation after an actual IDB write failure', async ({ harness }) => {
  await harness.setStorage({ translationPreferences: { version: 1, wordMethod: 'ai', textMethod: 'ai' } });
  const page = await harness.open('/selection'); await harness.inject(page);
  await failEntryWrites(harness, true);
  try {
    await page.locator('#unknown-phrase').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.locator('.tf-selection-chip').click();
    await expect(page.locator('.tf-selection-primary')).not.toBeEmpty();
    await expect(page.locator('.tf-toast-message')).toContainText('缓存');
    expect(harness.server.calls).toHaveLength(1);
    expect(await harness.runtime({ type: 'CACHE_STATS' })).toMatchObject({ ok: true, segmentCount: 0 });
    await page.screenshot({ path: test.info().outputPath('selection-cache-write-failure.png') });
  } finally { await failEntryWrites(harness, false); }
});

test('compiled explanation cache hits independently and survives translation quota pruning', async ({ harness }) => {
  const message = { type: 'SELECTION_EXPLAIN', text: 'persistent', pageUrl, depth: 'standard' };
  const first = await harness.runtime({ ...message, requestId: 'explain-seed' });
  expect(first).toMatchObject({ ok: true, cacheHit: false });
  expect(harness.server.calls).toHaveLength(1);
  expect(await harness.runtime({ ...message, requestId: 'explain-hit' })).toMatchObject({ ok: true, cacheHit: true, generated: first.generated });
  expect(harness.server.calls).toHaveLength(1);
  for (let n = 0; n < 7; n++) {
    const text = `Synthetic large translation ${n}`, lookup = await read(harness, text);
    expect(await write(harness, text, lookup, '合'.repeat(350000))).toMatchObject({ ok: true, stored: 1 });
  }
  const before = await harness.runtime({ type: 'CACHE_STATS' });
  expect(before).toMatchObject({ segmentCount: 7, selectionExplanationCount: 1 });
  await harness.setStorage({ cacheMaxMB: 5 });
  const after = await harness.runtime({ type: 'CACHE_PRUNE' });
  expect(after.deleted).toBeGreaterThan(0);
  expect(after.segmentCount).toBeLessThan(7);
  expect(after.selectionExplanationCount).toBe(1);
  expect(await harness.runtime({ ...message, requestId: 'explain-after-prune' })).toMatchObject({ ok: true, cacheHit: true, generated: first.generated });
  expect(harness.server.calls).toHaveLength(1);
});
