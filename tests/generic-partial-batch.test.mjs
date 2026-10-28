import test from 'node:test';
import assert from 'node:assert/strict';
import { openAICompatibleProvider } from '../src/background/providers/openai-compatible.js';

// A cloud model name must not match the local translation model hints.
const config = { provider: 'openai-chat', apiBaseUrl: 'https://api.example.test/v1', model: 'deepseek-chat',
  apiKey: 'synthetic', prompt: 'Keep the source meaning.', targetLanguage: 'Chinese', streaming: false };
const reply = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const segments = [
  { id: '1', text: 'First paragraph.' },
  { id: '2', text: 'Second paragraph.' },
  { id: '3', text: 'Third paragraph.' },
  { id: '4', text: 'Fourth paragraph.' }
];
const asJson = items => JSON.stringify({ translations: items.map(([id, text]) => ({ id, text })) });

function stub(handler) {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const ids = JSON.parse(body.messages[1].content).segments.map(segment => String(segment.id));
    return reply(handler(ids, bodies.length));
  };
  return bodies;
}

test('a single unrecoverable segment no longer discards the rest of a cloud batch', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  // Every request that contains id 3 loses it (the provider then looks truncated);
  // requests made only of id 3 stay broken so that segment is finally dropped.
  // Requests containing id 3 come back without it (so they look truncated);
  // requests for id 3 alone stay broken, which finally drops that one segment.
  const bodies = stub(ids => asJson(ids.filter(id => id !== '3').map(id => [id, `译文${id}`])));

  const out = await openAICompatibleProvider.translateBatch(segments, config);
  assert.deepEqual(out.map(item => item.id), ['1', '2', '4']);
  assert(bodies.length >= 3, 'the failing batch is bisected instead of failing the page');
});

test('a batch where nothing can be parsed still fails loudly', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  stub(() => 'not json at all');
  await assert.rejects(openAICompatibleProvider.translateBatch(segments, config), { code: 'MALFORMED_RESPONSE' });
});

test('a dropped segment stays bounded: once four segments fail the call aborts', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  const five = [...segments, { id: '5', text: 'Fifth paragraph.' }];
  stub(ids => ids.length === 1 && ids[0] === '1' ? asJson([['1', '第一段。']]) : asJson([]));
  await assert.rejects(openAICompatibleProvider.translateBatch(five, config), { code: 'MALFORMED_RESPONSE' });
});
