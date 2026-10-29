import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createContentI18nStub } from './helpers/content-i18n-stub.mjs';

const source = await readFile(new URL('../src/content/processor.js', import.meta.url), 'utf8');
const pageUrl = 'https://fixture.invalid/article';
const pageText = 'A paragraph that needs translating.';
const settle = () => new Promise(resolve => setImmediate(resolve));

// The real processGroupBatch runs; only the provider round trip is gated so the
// scheduling of batches becomes observable.
function harness(batchCount = 7) {
  const gates = [];
  let current = 0, peak = 0, requests = 0;
  const el = { hasAttribute: () => false };
  const state = { manualRunning: false, autoDrainRunning: false, pending: new Set(), startupRestorePromise: null };
  const entries = Array.from({ length: batchCount }, (_, index) => ({
    id: String(index + 1), el, text: `${pageText} #${index}`, rich: false,
    normalizedText: `${pageText} #${index}`, protectedIds: []
  }));
  const modules = {
    runtime: { constants: { TRANSLATED_ATTR: 'data-abt-translated' },
      messages: { background: { CACHE_LOOKUP: 'CACHE_LOOKUP', TRANSLATE_BATCH: 'TRANSLATE_BATCH', CACHE_STORE: 'CACHE_STORE', CACHE_PRUNE: 'CACHE_PRUNE' } },
      state, getPageIdentity: url => url, normalizeSourceText: value => String(value || '').trim(),
      showToast() {}, isCachePersistenceError: () => false,
      sendRuntimeMessage: async message => {
        if (message.type === 'CACHE_LOOKUP') {
          return { ok: true, configSnapshotId: 'snap-1', engine: 'ai', hits: [], skippedIds: [],
            writeTokens: message.segments.map(segment => ({ id: String(segment.id), token: { test: true } })) };
        }
        if (message.type === 'TRANSLATE_BATCH') {
          requests += 1;
          current += 1; peak = Math.max(peak, current);
          await new Promise(resolve => gates.push(() => { current -= 1; resolve(); }));
          return { ok: true, engine: 'ai', translations: message.segments.map(segment => ({ id: String(segment.id), text: '译文' })) };
        }
        return { ok: true };
      } },
    contentI18n: createContentI18nStub({ messages: {} }),
    tasks: { createTask: () => ({ id: 'task', state: 'queued' }), transition() {}, assertActive() {}, updateProgress() {},
      completeTask() {}, failTask() {}, getTaskStatus: task => ({ state: task.state }), isCancelledError: () => false },
    dom: { collectElements: () => entries.map(entry => entry.el),
      extractSourceSegment: item => ({ text: entries.find(entry => entry.el === item)?.text || pageText }),
      insertTranslation: () => true, clearTranslations() {} },
    batch: { buildEntries: () => entries.map(entry => ({ ...entry })),
      groupEntriesByText: list => list.map(entry => ({ ...entry, elements: [entry.el] })),
      makeBatches: groups => groups.map(group => [group]),
      makeBatchesHeadFirst: groups => groups.map(group => [group]) }
  };
  const app = { modules };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, document: { title: 'page', contains: () => true },
    location: { href: pageUrl }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date, queueMicrotask });
  return { processPage: app.modules.processor.processPage, gates,
    get peak() { return peak; }, get inFlight() { return current; }, get requests() { return requests; } };
}

const drive = async (h, run) => {
  let done = false;
  run.then(() => { done = true; }, () => { done = true; });
  while (!done) {
    if (h.gates.length) h.gates.shift()();
    await settle();
  }
  return run;
};

test('the head batch runs alone, then the rest overlap at most three at a time', async () => {
  const h = harness(7);
  const run = h.processPage({ cacheOnly: false, silent: true });
  await settle();
  assert.equal(h.inFlight, 1, 'only the head batch is in flight first');
  h.gates.shift()();
  await settle();
  assert.equal(h.inFlight, 3, 'three batches overlap once the head batch is done');
  await drive(h, run);
  assert.equal(h.requests, 7, 'every batch asked the provider exactly once');
  assert.equal(h.peak, 3, 'concurrency never exceeds the limit');
});
