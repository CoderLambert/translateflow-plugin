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
  const batches = Array.from(batch.makeBatchesHeadFirst(groups(115)), item => Array.from(item));
  assert.equal(batches[0].length, 8, 'first batch is capped at eight paragraphs');
  assert(batches.length > 1);
  assert.deepEqual(batches.flat().map(group => group.id), groups(115).map(group => group.id),
    'no group is lost and the reading order is preserved');
  assert(batches.slice(1).some(item => item.length > 8), 'later batches keep the normal limits');
});

test('a short page stays a single batch', () => {
  const batch = load();
  assert.deepEqual(Array.from(batch.makeBatchesHeadFirst(groups(5)), item => item.length), [5]);
});
