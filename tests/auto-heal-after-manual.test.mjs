import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createContentI18nStub } from './helpers/content-i18n-stub.mjs';

const source = await readFile(new URL('../src/content/auto.js', import.meta.url), 'utf8');

// A page we do not control can replace the paragraph nodes right after a manual
// translation (React hydration, SPA lists). Those paragraphs must come back from
// the cache alone: no provider request, and no per-site setting left behind.
function harness() {
  let nextTimer = 0;
  const timers = new Map(), observers = [], calls = [];
  const elements = [{ hasAttribute: () => false }, { hasAttribute: () => false }];
  const state = { auto: false, cacheRestore: false, autoDrainRunning: false, manualRunning: false,
    pending: new Set(), autoTimer: null, autoBackoffUntil: 0, lastAutoErrorAt: 0, startupRestorePromise: null };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} unobserve() {} disconnect() {}
    trigger(records) { this.callback(records); }
  }
  const app = { modules: {
    runtime: { state, constants: { AUTO_DEBOUNCE_MS: 180, TRANSLATION_CLASS: 'abt-translation', TRANSLATED_ATTR: 'data-abt-translated',
      CANDIDATE_SELECTOR: 'p', AUTO_ROOT_MARGIN: '200px' },
      messages: { background: { PUBLIC_SETTINGS_GET: 'settings' } },
      getPageIdentity: value => value, getSiteScope: () => 'https://fixture.invalid',
      sendRuntimeMessage: async () => ({ settings: {} }), showToast() {} },
    contentI18n: createContentI18nStub({ messages: {} }),
    tasks: { createTask: options => ({ ...options }), completeTask() {}, failTask() {}, releaseTask() {} },
    dom: { collectElements: () => elements, isCandidateElement: () => true, isTranslationNode: () => false,
      extractSourceText: () => 'Synthetic paragraph.', shouldTranslate: () => true,
      removeTranslationFromElement() {}, clearTranslations() {} },
    batch: { buildEntries: list => list.map(el => ({ el, text: 'synthetic' })),
      groupEntriesByText: entries => entries.map(entry => ({ ...entry, elements: [entry.el] })), makeBatches: groups => [groups] },
    processor: { processPage: async () => ({}), processGroupBatch: async (_groups, options) => { calls.push(options); return { cacheHits: 1, apiTranslated: 0 }; } }
  } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, location: { href: 'https://fixture.invalid/article' },
    document: { contains: () => true, documentElement: {} }, IntersectionObserver: Observer, MutationObserver: Observer,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), Date: { now: () => 10_000 }, queueMicrotask });
  return { state, timers, observers, calls, elements, auto: app.modules.auto };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a manual page translation leaves restore-only healing active', async () => {
  const h = harness();
  assert.equal(h.state.cacheRestore, false);
  h.auto.healAfterManualTranslate();
  assert.equal(h.state.cacheRestore, true, 'healing reuses the restore-only mode');
  assert.equal(h.state.auto, false, 'provider translation stays off');
  assert.equal(h.observers.length, 2, 'both the intersection and mutation observers are installed');
  // The site re-renders a paragraph: its old node is gone, so the observer hands
  // the replacement over to the queue exactly like an incremental auto pass.
  h.observers[0].trigger([{ isIntersecting: true, target: h.elements[0] }]);
  await flush();
  for (const [id, timer] of [...h.timers]) { h.timers.delete(id); timer.fn(); }
  await flush();
  assert(h.calls.length > 0, 'queued paragraphs are processed');
  assert(h.calls.every(options => options.cacheOnly === true && options.auto === false),
    'healing never calls a provider: every re-insert is a cache-only lookup');
});

test('healing is a no-op while automatic translation is already handling the page', () => {
  const h = harness();
  h.state.auto = true;
  h.auto.healAfterManualTranslate();
  assert.equal(h.observers.length, 0, 'auto mode already owns the observers');
});
