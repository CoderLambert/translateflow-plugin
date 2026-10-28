import test from 'node:test';
import assert from 'node:assert/strict';
import { openAICompatibleProvider } from '../src/background/providers/openai-compatible.js';

const config = { provider: 'openai-chat', apiBaseUrl: 'http://localhost:1234/v1', model: 'hy-mt2-7b',
  apiKey: '', prompt: 'Keep the source meaning.', targetLanguage: 'Chinese' };
const reply = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

function stub({ batch, plain, markers }) {
  const calls = { batch: 0, plain: 0 };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body), prompt = body.messages[0].content;
    if (prompt.includes('Input JSON:')) { calls.batch++; return reply(batch); }
    calls.plain++;
    const source = prompt.split('Source text:\n').at(-1);
    return reply(plain(source));
  };
  return calls;
}
test('an unrecoverable segment no longer discards the rest of the batch', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  // The model answers the batch malformed, translates "First." on recovery and
  // returns nothing for "Second.".
  const segments = [{ id: '1', text: 'First paragraph.' }, { id: '2', text: 'Second paragraph.' }];
  stub({ batch: '{"translations":{"1":"第一段。"}}', plain: source => source === 'First paragraph.' ? '第一段。' : '' });

  const out = await openAICompatibleProvider.translateBatch(segments, config);
  assert.deepEqual(out, [{ id: '1', text: '第一段。' }], 'the translated segment survives, the failed one is reported as missing');
});

test('a batch where every segment fails still fails loudly', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  const segments = [{ id: '1', text: 'First paragraph.' }, { id: '2', text: 'Second paragraph.' }];
  stub({ batch: '{"translations":{}}', plain: () => '' });
  await assert.rejects(openAICompatibleProvider.translateBatch(segments, config), { code: 'MALFORMED_RESPONSE' });
});

test('a rich segment keeps its markers and survives a neighbour that cannot be recovered', async t => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = { permissions: { contains: async () => true } };
  t.after(() => { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; });

  const rich = { id: '9', format: 'tf-markers', protectedIds: [1],
    text: 'Install ⟦TF:1:S⟧npm⟦TF:1:E⟧ globally, then run ⟦TF:2:S⟧create-next-app⟦TF:2:E⟧ to start.' };
  const broken = { id: '10', text: 'A paragraph the model keeps mangling.' };
  stub({
    batch: '{"translations":{"9":"全局安装 [[TF_1_S]]npm[[TF_1_E]]，然后运行 [[TF_2_S]]create-next-app[[TF_2_E]]。"}}',
    plain: source => source === broken.text ? '' : '译文'
  });
  const out = await openAICompatibleProvider.translateBatch([rich, broken], config);
  assert.deepEqual(out.map(item => item.id), ['9'], 'the marker segment is kept, the broken plain segment is dropped');
  assert.equal(out[0].text.includes('⟦TF:1:S⟧npm⟦TF:1:E⟧'), true);
});
