import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createI18n } from '../src/i18n/index.js';
const strictI18n = createI18n({ uiLocale: 'zh_CN' });
import { isCachePersistenceError } from '../src/shared/cache/persistence-errors.js';
import { runSubtitleTranslationBatch } from '../src/background/subtitle-requests.js';

const pageUrl = 'https://fixture.invalid/article';
const pageText = 'A reliable translated paragraph.';
const translation = '已经翻译完成的段落。';
const cacheMessages = Object.freeze({
  CACHE_LOOKUP: 'CACHE_LOOKUP', TRANSLATE_BATCH: 'TRANSLATE_BATCH',
  CACHE_STORE: 'CACHE_STORE', CACHE_PRUNE: 'CACHE_PRUNE'
});
const storageError = code => Object.assign(new Error(code), { code });

async function createContentHarness(file, { lookupWarning = '', writeWarning = '', writeErrorCode = '', translateErrorCode = '', cacheOnly = false } = {}) {
  const requests = [], toasts = [], displayed = [], accepted = [], el = { hasAttribute: () => false };
  const state = { manualRunning: false, autoDrainRunning: false, pending: new Set(),
    startupRestorePromise: null, lastAutoPruneAt: Date.now() };
  const runtime = {
    constants: { TRANSLATED_ATTR: 'data-tf-translated' },
    isCachePersistenceError,
    messages: { background: cacheMessages }, state,
    getPageIdentity: url => url,
    normalizeSourceText: value => String(value || '').trim(),
    showToast: (text, kind) => toasts.push({ text, kind }),
    sendRuntimeMessage: async message => {
      requests.push(message);
      if (message.type === cacheMessages.CACHE_LOOKUP) {
        return { ok: true, configSnapshotId: 'config-frozen', engine: 'ai', hits: [], skippedIds: [],
          writeTokens: lookupWarning ? [] : [{ id: file.includes('processor') ? '1' : 'selection', token: { test: true } }],
          ...(lookupWarning ? { cacheWarning: lookupWarning } : {}) };
      }
      if (message.type === cacheMessages.TRANSLATE_BATCH) {
        if (translateErrorCode) return { ok: false, errorCode: translateErrorCode, error: "PRIVATE_UNTRUSTED_UPSTREAM_PAYLOAD" };
        return { ok: true, translations: [{ id: file.includes('processor') ? '1' : 'selection', text: translation }],
          readingResult: { targetLanguage: 'zh', provenance: { provider: 'fixture', model: 'test' } } };
      }
      if (message.type === cacheMessages.CACHE_STORE) {
        if (writeErrorCode) return { ok: false, errorCode: writeErrorCode };
        return writeWarning ? { ok: true, stored: 0, cacheWarning: writeWarning } : { ok: true, stored: 1 };
      }
      return { ok: true };
    }
  };
  const tasks = {
    createTask: () => ({ id: 'test-task', state: 'queued' }),
    transition: (task, next) => { task.state = next; },
    assertActive: () => {},
    updateProgress: () => {},
    completeTask: task => { task.state = 'completed'; },
    failTask: task => { task.state = 'failed'; },
    getTaskStatus: task => ({ state: task.state }),
    isCancelledError: () => false
  };
  const entry = { id: '1', el, text: pageText, rich: false, normalizedText: pageText, protectedIds: [] };
  const heals = [];
  const modules = {
    auto: { healAfterManualTranslate: () => heals.push('heal'), resumeAutoTranslation: () => {}, invalidateAndObserve: () => {},
      scheduleAutoDrain: () => {} },
    runtime, contentI18n: { t: (key, args) => { strictI18n.t(key, args); return key; } }, tasks,
    dom: {
      collectElements: () => [el], extractSourceSegment: () => ({ text: pageText }),
      insertTranslation: (_el, text) => { displayed.push(text); return true; },
      clearTranslations: () => {}
    },
    batch: {
      buildEntries: () => [entry],
      groupEntriesByText: () => [{ id: '1', text: pageText, rich: false,
        normalizedText: pageText, protectedIds: [], elements: [el] }],
      makeBatches: groups => [groups]
    },
    selectionResultModel: {
      buildTranslationResult: text => ({ primaryMeaning: text }),
      readingTranslation: text => ({ text })
    },
    selectionPopover: {
      setLoadingStatus: () => {}, setLoadingCancelable: () => {}, showEmpty: () => {}
    }
  };
  const app = { modules };
  const document = { title: 'Test page', contains: item => item === el };
  const location = { href: pageUrl };
  const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
  const context = vm.createContext({ globalThis: { __TRANSLATE_FLOW_CONTENT__: app }, document, location });
  vm.runInContext(source, context, { filename: file });
  const run = file.includes('processor')
    ? () => modules.processor.processPage({ cacheOnly, silent: false })
    : () => modules.selectionTranslationQuery.create({
      assertCurrent: () => {}, showResult: (_snapshot, card) => displayed.push(card.primaryMeaning),
      onResult: (_query, answer) => accepted.push(answer)
    })({ text: pageText, pageUrl }, { id: 'test-task', state: 'queued' }, 1, pageUrl);
  return { run, requests, toasts, displayed, accepted, heals };
}

test('only transient cache storage failures are recoverable; invalid contracts still fail closed', () => {
  for (const code of ['CACHE_QUOTA', 'CACHE_STORAGE', 'CACHE_STORAGE_BLOCKED', 'CACHE_STORAGE_TIMEOUT']) {
    assert.equal(isCachePersistenceError(storageError(code)), true);
    assert.equal(isCachePersistenceError(code), true);
  }
  for (const code of ['CACHE_INVALID_TOKEN', 'CACHE_INVALID_IDENTITY', 'CACHE_INVALIDATED', 'CONFIG_SNAPSHOT_EXPIRED', 'CANCELLED']) {
    assert.equal(isCachePersistenceError(storageError(code)), false);
  }
});

for (const [code, key] of [["MALFORMED_RESPONSE", "invalidResponse"], ["TIMEOUT", "timeoutError"], ["AUTH", "authError"], ["RATE_LIMIT", "rateLimited"]]) {
  test(`page ${code} feedback is actionable and never exposes upstream text`, async () => {
    const h = await createContentHarness("src/content/processor.js", { translateErrorCode: code });
    await assert.rejects(h.run(), error => error.code === code && error.message === `content.page.${key}`);
    assert.equal(h.displayed.length, 0);
    assert.ok(!JSON.stringify(h.toasts).includes("PRIVATE_UNTRUSTED"));
  });
}

test('Page keeps verified text visible after storage failure, no paid regeneration', async () => {
  const h = await createContentHarness('src/content/processor.js', { writeWarning: 'CACHE_STORAGE' });
  const result = await h.run();
  assert.equal(result.apiTranslated, 1);
  assert.equal(result.cacheWarning, 'CACHE_STORAGE');
  assert.deepEqual(h.displayed, [translation]);
  assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 1);
  assert.equal(h.requests.filter(req => req.type === 'CACHE_STORE').length, 1);
  assert.match(h.toasts.at(-1).text, /cacheNotSaved/u);
});

test('Page can render with unavailable cache read without inventing a write token', async () => {
  const h = await createContentHarness('src/content/processor.js', { lookupWarning: 'CACHE_STORAGE_BLOCKED' });
  const result = await h.run();
  assert.equal(result.cacheWarning, 'CACHE_STORAGE_BLOCKED');
  assert.deepEqual(h.displayed, [translation]);
  assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 1);
  assert.equal(h.requests.filter(req => req.type === 'CACHE_STORE').length, 0);
});

test('cache-only restore never invokes a Provider when IndexedDB is unavailable', async () => {
  const h = await createContentHarness('src/content/processor.js',
    { lookupWarning: 'CACHE_STORAGE', cacheOnly: true });
  const result = await h.run();
  assert.equal(result.cacheWarning, 'CACHE_STORAGE');
  assert.equal(result.apiTranslated, 0);
  assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 0);
  assert.equal(h.requests.filter(req => req.type === 'CACHE_STORE').length, 0);
});

test('Selection displays translated card and Reading draft when CACHE_STORE fails', async () => {
  const h = await createContentHarness('src/content/selection/translation-query.js',
    { writeWarning: 'CACHE_QUOTA' });
  const result = await h.run();
  assert.equal(result.cacheWarning, 'CACHE_QUOTA');
  assert.deepEqual(h.displayed, [translation]);
  assert.equal(h.accepted.length, 1);
  assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 1);
  assert.match(h.toasts.at(-1).text, /cacheNotSaved/u);
});

test('Selection skips impossible writes after a failed lookup but retains generated answer', async () => {
  const h = await createContentHarness('src/content/selection/translation-query.js',
    { lookupWarning: 'CACHE_STORAGE_TIMEOUT' });
  const result = await h.run();
  assert.equal(result.cacheWarning, 'CACHE_STORAGE_TIMEOUT');
  assert.deepEqual(h.displayed, [translation]);
  assert.equal(h.requests.filter(req => req.type === 'CACHE_STORE').length, 0);
});

test('classic Content storage-error classifier matches the shared background contract', async () => {
  const source = await readFile(new URL('../src/content/runtime.js', import.meta.url), 'utf8');
  const modules = { contentI18n: { t: key => key } };
  const context = vm.createContext({
    globalThis: { __TRANSLATE_FLOW_CONTENT__: { modules } },
    location: { href: pageUrl }, URL
  });
  vm.runInContext(source, context, { filename: 'src/content/runtime.js' });
  const codes = ['CACHE_QUOTA', 'CACHE_STORAGE', 'CACHE_STORAGE_BLOCKED', 'CACHE_STORAGE_TIMEOUT',
    'CACHE_INVALID_TOKEN', 'CACHE_INVALIDATED', 'CONFIG_SNAPSHOT_EXPIRED', 'CANCELLED', 'CACHE_UPGRADE_FAILED', ''];
  for (const code of codes) {
    assert.equal(modules.runtime.isCachePersistenceError({ errorCode: code }), isCachePersistenceError(code), code);
  }
});

for (const [surface, file] of [
  ['Page', 'src/content/processor.js'],
  ['Selection', 'src/content/selection/translation-query.js']
]) {
  test(`${surface} displays verified translation when CACHE_STORE explicitly returns a persistence error`, async () => {
    for (const code of ['CACHE_QUOTA', 'CACHE_STORAGE', 'CACHE_STORAGE_BLOCKED', 'CACHE_STORAGE_TIMEOUT']) {
      const h = await createContentHarness(file, { writeErrorCode: code });
      const result = await h.run();
      assert.equal(result.cacheWarning, code);
      assert.deepEqual(h.displayed, [translation]);
      assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 1);
      assert.equal(h.requests.filter(req => req.type === 'CACHE_STORE').length, 1);
      assert.match(h.toasts.at(-1).text, /cacheNotSaved/u);
      if (surface === 'Selection') assert.equal(h.accepted.length, 1);
    }
  });

  test(`${surface} refuses to swallow stale config, invalid token or cancellation errors`, async () => {
    for (const code of ['CONFIG_SNAPSHOT_EXPIRED', 'CACHE_INVALID_TOKEN', 'CANCELLED']) {
      const h = await createContentHarness(file, { writeErrorCode: code });
      await assert.rejects(h.run(), error => error.code === code);
      assert.equal(h.requests.filter(req => req.type === 'TRANSLATE_BATCH').length, 1);
      if (surface === 'Selection') assert.deepEqual(h.displayed, []);
    }
  });
}

const subtitleInput = { requestId: 'subtitle-test', pageUrl, units: [{
  id: 'subtitle-1', mediaId: 'public-video', source: 'youtube',
  track: { id: 'en', language: 'en' }, cue: { id: 'cue-1', startTime: 1, endTime: 3 },
  text: pageText
}] };
function subtitleDeps({ lookupError, storeError } = {}) {
  const calls = { providers: 0, stores: 0 };
  const deps = {
    getEffectiveConfig: async () => ({ provider: 'test', targetLanguage: 'zh' }),
    lookupTranslations: async () => {
      if (lookupError) throw storageError(lookupError);
      return { hits: [], writeTokens: [{ id: 'subtitle-1', token: { test: true } }] };
    },
    runTranslationRequest: async input => {
      calls.providers++;
      return input.segments.map(segment => ({ id: segment.id, text: translation }));
    },
    storeTranslations: async () => {
      calls.stores++;
      if (storeError) throw storageError(storeError);
      return { stored: 1 };
    }
  };
  return { calls, deps };
}
test('Subtitle keeps translation when write fails and does not retranslate to retry storage', async () => {
  const h = subtitleDeps({ storeError: 'CACHE_QUOTA' });
  const result = await runSubtitleTranslationBatch(subtitleInput, h.deps);
  assert.equal(result.cacheWarning, 'CACHE_QUOTA');
  assert.equal(result.translations[0].text, translation);
  assert.deepEqual(h.calls, { providers: 1, stores: 1 });
});
test('Subtitle ignores a broken read cache without attempting a tokenless write', async () => {
  const h = subtitleDeps({ lookupError: 'CACHE_STORAGE' });
  const result = await runSubtitleTranslationBatch(subtitleInput, h.deps);
  assert.equal(result.cacheWarning, 'CACHE_STORAGE');
  assert.equal(result.translations[0].text, translation);
  assert.deepEqual(h.calls, { providers: 1, stores: 0 });
});
test('Subtitle never swallows identity/token failures as persistence problems', async () => {
  const h = subtitleDeps({ storeError: 'CACHE_INVALID_TOKEN' });
  await assert.rejects(runSubtitleTranslationBatch(subtitleInput, h.deps), { code: 'CACHE_INVALID_TOKEN' });
  assert.equal(h.calls.providers, 1);
});

test('a successful manual page translation hands the page to restore-only healing', async () => {
  const h = await createContentHarness('src/content/processor.js');
  const result = await h.run();
  assert.equal(result.apiTranslated, 1);
  assert.deepEqual(h.heals, ['heal'], 'the inserted translations are protected against a later re-render');
});

test('a failed manual page translation does not start healing', async () => {
  const h = await createContentHarness('src/content/processor.js', { translateErrorCode: 'MALFORMED_RESPONSE' });
  await assert.rejects(h.run(), error => error.code === 'MALFORMED_RESPONSE');
  assert.deepEqual(h.heals, []);
});
