import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/content/batch.js', import.meta.url), 'utf8');
function load() {
  const app = { modules: { runtime: { constants: { TRANSLATED_ATTR: 'data-abt-translated', BATCH_MAX_ITEMS: 18, BATCH_MAX_CHARS: 7000 },
    normalizeSourceText: value => String(value || '').trim() },
    dom: { extractSourceSegment: () => ({ text: '' }), shouldTranslate: () => true } } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, document: { contains: () => true } });
  return app.modules.batch;
}
const groups = count => Array.from({ length: count }, (_, index) => ({ id: String(index + 1), text: 'x'.repeat(40) }));

test('the head batch is small so the first provider round trip lands quickly', () => {
  const batch = load();
  const batches = Array.from(batch.makeBatchesHeadFirst(groups(115), 4), item => Array.from(item));
  assert.equal(batches[0].length, 4, 'first batch is capped at four paragraphs');
  assert(batches.length > 1);
  assert.deepEqual(batches.flat().map(group => group.id), groups(115).map(group => group.id),
    'no group is lost and the reading order is preserved');
  assert(batches.slice(1).some(item => item.length > 8), 'later batches keep the normal limits');
});

test('a short page stays a single batch', () => {
  const batch = load();
  assert.deepEqual(Array.from(batch.makeBatchesHeadFirst(groups(5)), item => item.length), [5]);
});

test('work is ordered by what is on screen, then by document order', () => {
  const batch = load();
  const groups = [0, 1, 2, 3, 4].map(index => ({ id: String(index), text: 'x', elements: [{ index }] }));
  const rects = { 0: -3000, 1: 420, 3: 120, 4: 2400 };   // 2 unspecified = far away
  const measure = element => ({ top: rects[element.index] ?? -9000, bottom: (rects[element.index] ?? -9000) + 40 });
  const ordered = Array.from(batch.prioritizeVisibleGroups(groups, { viewportHeight: 800, measure }), group => group.id);
  // group 4 sits at 2400px, beyond the 1.5-viewport window, so it keeps document order.
  assert.deepEqual(ordered, ['3', '1', '0', '2', '4'], 'nearest visible first, then document order');
});

test('without a viewport the order is untouched', () => {
  const batch = load();
  const groups = [{ id: 'a', elements: [] }, { id: 'b', elements: [] }];
  assert.deepEqual(Array.from(batch.prioritizeVisibleGroups(groups), group => group.id), ['a', 'b']);
});
