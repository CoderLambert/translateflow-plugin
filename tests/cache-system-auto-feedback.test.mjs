import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const autoSource = await readFile(new URL('../src/content/auto.js', import.meta.url), 'utf8');
const pageUrl = 'https://fixture.invalid/article';

async function executeAutoDrain({ auto = false, cacheWarning = '', lastAutoErrorAt = 0 } = {}) {
  const element = { hasAttribute: () => false };
  const events = { toasts: [], batches: [], completed: 0, failed: 0 };
  const timers = [];
  const state = {
    auto, cacheRestore: !auto, pending: new Set([element]), currentPageIdentity: pageUrl,
    autoDrainRunning: false, manualRunning: false, autoBackoffUntil: 0, lastAutoErrorAt, autoTimer: null
  };
  const modules = {
    runtime: {
      constants: { TRANSLATION_CLASS: 'abt-translation', TRANSLATED_ATTR: 'data-abt-translated',
        CANDIDATE_SELECTOR: 'p', AUTO_DEBOUNCE_MS: 1 },
      messages: { background: {} }, state,
      getPageIdentity: value => value, getSiteScope: () => pageUrl,
      sendRuntimeMessage: async () => ({ ok: true }),
      showToast: (message, kind) => events.toasts.push({ message, kind })
    },
    contentI18n: { t: key => key },
    tasks: {
      createTask: config => ({ ...config, id: 'auto-fixture' }),
      completeTask: () => { events.completed++; },
      failTask: () => { events.failed++; },
      releaseTask: () => {}
    },
    dom: {
      collectElements: () => [], isCandidateElement: () => true, extractSourceText: () => 'English content',
      shouldTranslate: () => true, isTranslationNode: () => false,
      removeTranslationFromElement: () => {}, clearTranslations: () => {}
    },
    batch: {
      buildEntries: elements => elements.map(el => ({ el, text: 'English content' })),
      groupEntriesByText: entries => [{ id: 'paragraph', text: 'English content',
        elements: entries.map(entry => entry.el) }],
      makeBatches: groups => [groups]
    },
    processor: {
      processGroupBatch: async (_groups, options) => {
        events.batches.push(options);
        return { cacheHits: 0, apiTranslated: auto ? 1 : 0, cacheWarning };
      }
    }
  };
  vm.runInNewContext(autoSource, {
    globalThis: { __TRANSLATE_FLOW_CONTENT__: { modules } },
    document: { contains: node => node === element },
    location: { href: pageUrl },
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    Date
  }, { filename: 'src/content/auto.js' });
  modules.auto.scheduleAutoDrain(0);
  assert.equal(timers.length, 1);
  timers.shift()();
  // Drain the asynchronous queue without real timers or network calls.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.pending.size, 0);
  assert.equal(state.autoDrainRunning, false);
  assert.equal(events.batches.length, 1);
  assert.equal(events.batches[0].cacheOnly, !auto);
  assert.equal(events.failed, 0);
  return events;
}

test('incremental auto translation surfaces one cache-not-saved warning and retains task success', async () => {
  const result = await executeAutoDrain({ auto: true, cacheWarning: 'CACHE_QUOTA' });
  assert.deepEqual(result.toasts, [{ message: 'content.page.cacheNotSaved', kind: 'error' }]);
  assert.equal(result.completed, 1);
});

test('incremental cache-only recovery reports unavailable storage without invoking Provider mode', async () => {
  const result = await executeAutoDrain({ auto: false, cacheWarning: 'CACHE_STORAGE' });
  assert.deepEqual(result.toasts, [{ message: 'content.page.cacheLookupFailed', kind: 'error' }]);
  assert.equal(result.completed, 0);
});

test('successful incremental or restore-only tasks stay silent', async () => {
  for (const auto of [false, true]) {
    const result = await executeAutoDrain({ auto });
    assert.deepEqual(result.toasts, []);
  }
});

test('repeated cache warnings share the existing 5-second auto-error throttle', async () => {
  const result = await executeAutoDrain({ auto: true, cacheWarning: 'CACHE_STORAGE',
    lastAutoErrorAt: Date.now() });
  assert.deepEqual(result.toasts, []);
  assert.equal(result.completed, 1);
});
