import test from 'node:test';
import assert from 'node:assert/strict';
import { openAICompatibleProvider } from '../src/background/providers/openai-compatible.js';
const config = { provider: 'openai-chat', apiBaseUrl: 'http://localhost:1234/v1', model: 'hy-mt2-7b',
  apiKey: '', prompt: 'Keep the source meaning.', targetLanguage: 'Chinese' };
const segments = [{ id: '11', text: 'First complete sentence.' }, { id: '12', text: 'Second complete sentence.' }];
const response = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
for (const invalid of [false, true]) test(`single recovery removes response-ID transport without weakening validation: invalid=${invalid}`, async t => {
  const previous = globalThis.chrome;
  globalThis.chrome = { permissions: { contains: async () => true } }; t.after(() => { globalThis.chrome = previous; });
  let calls = 0, plainCalls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body), prompt = body.messages[0].content;
    assert.ok(prompt.includes(config.prompt));
    if (prompt.includes('Input JSON:\n')) return response(JSON.stringify({ translations: { 11: '第一句。”},{', 12: '第二句。' } }));
    plainCalls++;
    assert.equal(body.response_format, undefined);
    assert.ok(!prompt.includes('"id":'));
    const source = prompt.split('Source text:\n').at(-1);
    assert.ok(segments.some(segment => segment.text === source));
    return response(source === segments[0].text ? '第一句。' : invalid ? '第二句。“12' : '第二句。');
  });
  if (invalid) {
    // A segment whose recovery keeps emitting protocol garbage is dropped, and the
    // rest of the batch still returns; nothing polluted reaches the page.
    assert.deepEqual(await openAICompatibleProvider.translateBatch(segments, config), [{ id: '11', text: '第一句。' }]);
    assert.equal(calls, 5); assert.equal(plainCalls, 3, 'the malformed single segment gets only its existing two attempts');
  } else {
    assert.deepEqual(await openAICompatibleProvider.translateBatch(segments, config), [{ id: '11', text: '第一句。' }, { id: '12', text: '第二句。' }]);
    assert.equal(calls, 4); assert.equal(plainCalls, 2);
  }
});
