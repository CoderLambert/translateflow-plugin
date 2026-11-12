import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationCoordinator } from '../src/background/cache/translation-coordinator.js';

const input = (id, requestId = 'page') => ({ requestId, pageUrl: 'https://example.test/article',
  segments: [{ id, text: `Documentation paragraph ${id}.` }], config: { provider: 'test' } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('parallel batches sharing one page task all finish without cancelling one another', async () => {
  const gates = Array.from({ length: 6 }, () => Promise.withResolvers());
  const coordinator = createTranslationCoordinator(async ({ segments }) => {
    await gates[Number(segments[0].id)].promise;
    return segments.map(item => ({ id: item.id, text: `译文 ${item.id}` }));
  });
  const results = Promise.allSettled(gates.map((_, i) => coordinator.run(input(String(i)))));
  try {
    await tick();
    // A completed sibling must not unregister other batches from cancellation.
    gates[0].resolve(); await tick();
    for (const gate of gates) gate.resolve();
    const settled = await results;
    assert.deepEqual(settled.map(item => item.status), Array(6).fill('fulfilled'));
    assert.deepEqual(settled.map(item => item.value[0].text), gates.map((_, i) => `译文 ${i}`));
    assert.equal(coordinator.cancel('page').cancelled, false);
  } finally { gates.forEach(gate => gate.resolve()); coordinator.close(); }
});

test('task cancellation aborts every remaining batch while preserving another task sharing its producer', async () => {
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers()), signals = [];
  const coordinator = createTranslationCoordinator(async ({ segments, signal }) => {
    signals[Number(segments[0].id)] = signal;
    await gates[Number(segments[0].id)].promise;
    return segments.map(item => ({ id: item.id, text: `译文 ${item.id}` }));
  });
  const jobs = gates.map((_, i) => coordinator.run(input(String(i))));
  const settled = Promise.allSettled(jobs);
  const other = coordinator.run(input('1', 'other-page-task'));
  try {
    await tick(); gates[0].resolve(); await jobs[0];
    assert.equal(coordinator.cancel('page').cancelled, true);
    assert.equal(signals[1].aborted, false);
    assert.equal(signals[2].aborted, true);
    const results = await settled;
    assert.equal(results[0].status, 'fulfilled');
    for (const result of results.slice(1)) assert.equal(result.reason.code, 'CANCELLED');
    gates[1].resolve();
    assert.equal((await other)[0].text, '译文 1');
    assert.equal(coordinator.cancel('page').cancelled, false);
  } finally { gates.forEach(gate => gate.resolve()); coordinator.close(); await other.catch(() => {}); }
});
