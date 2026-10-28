import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalTranslationResult } from '../src/background/providers/local-translation.js';
import { parseTranslationResult } from '../src/background/providers/shared.js';
import { parseTranslationText } from '../src/background/providers/native-protocol-shared.js';
import { createApplicationCache, getCacheContext } from '../src/background/cache/application.js';
import { createCacheService } from '../src/background/cache/service.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createTranslationIdentity, translationSource, validateTranslationValue } from '../src/shared/translation-cache-identity.js';

const config = { provider: 'openai-chat', model: 'fixture', targetLanguage: 'zh', prompt: 'Translate.' };
const source = 'Participation is optional and you may opt out of sharing information.';
const value = (text, translation) => ({ sourceText: text, source: translationSource({ text }), translation });
const damages = [
  '参与是可选的，也可以选择退出。”},{',
  '参与是可选的。"},{"id":"6","text":"其它段落"}',
  '参与是可选的。“5”、“6”、“8”、“10”、“11”、“12”、“14”',
  '参与是可选的。”}}',
  '需要经过手工流程。”“5”、“6”、“8',
  '帮助衡量需求。“6',
  '帮助衡量需求。“6”',
  '参与是可选的。```json',
  '参与是可选的。"translations":{"5":"别的段落"}',
];
for (const translation of damages) test(`all translation paths reject introduced envelope ${translation}`, () => {
  const segments = [{ id: '5', text: source }];
  const raw = JSON.stringify({ translations: [{ id: '5', text: translation }] });
  const response = { choices: [{ message: { content: raw } }] };
  assert.throws(() => parseLocalTranslationResult(response, segments), { code: 'MALFORMED_RESPONSE' });
  assert.throws(() => parseTranslationResult(response, segments), { code: 'MALFORMED_RESPONSE' });
  assert.throws(() => parseTranslationText(raw, segments, 'Fixture'), { code: 'MALFORMED_RESPONSE' });
  assert.equal(validateTranslationValue(value(source, translation)), false);
});

for (const [text, translation] of [
  ['The example contains "},{ between objects.', '示例在对象之间包含 ”},{。'],
  ['Literal ```json and "translations": examples.', '原文的 ```json 和 "translations": 示例。'],
  ['JSON uses {"id":"5","text":"hello"}.', 'JSON 使用 {"id":"5","text":"你好"}。'],
  ['List the versions 5, 6 and 8.', '列出版本。“5”、“6”、“8”'],
  ['He said hello.', '他说：“你好。”'],
  ['The values are 1, 2 and 3.', '值分别为 1、2 和 3。'],
  ['Use braces {x} in expressions.', '在表达式中使用花括号 {x}。'],
  ['Literal ⟦TF:0:S⟧ syntax is documented.', '文档记录 ⟦TF:0:S⟧ 字面语法。'],
]) test(`literal source syntax remains valid: ${text}`, () => {
  const segments = [{ id: '5', text }];
  const response = { choices: [{ message: { content: JSON.stringify({ translations: { 5: translation } }) } }] };
  assert.deepEqual(parseLocalTranslationResult(response, segments), [{ id: '5', text: translation }]);
  assert.equal(validateTranslationValue(value(text, translation)), true);
});

test('an unrelated source brace cannot authorize an introduced object boundary', () => {
  assert.equal(validateTranslationValue(value('Use {x} in an expression.', '在表达式中使用 {x}。”},{')), false);
});
test('rich marker correctness does not excuse contaminated prose', () => {
  const text = 'Read ⟦TF:0:S⟧sample()⟦TF:0:E⟧ carefully.';
  const rich = { sourceText: text, source: translationSource({ text, format: 'tf-markers', protectedIds: [0] }),
    translation: '仔细阅读 ⟦TF:0:S⟧sample()⟦TF:0:E⟧。”},{' };
  assert.equal(validateTranslationValue(rich), false);
});

for (const namespace of ['translation', 'subtitle-translation']) test(`${namespace} lazily rejects old polluted cache and retains valid entries`, async t => {
  const store = createMemoryCacheStore();
  const legacy = createCacheService({ store }).register(namespace, { validate: () => true });
  const app = createApplicationCache({ store }); t.after(() => app.close());
  const pageUrl = 'https://fixture.invalid/quality';
  const { pageKey } = await getCacheContext(pageUrl, config);
  const entries = [
    { id: 'bad', text: 'old:bad', providerText: source, translation: damages[0] },
    { id: 'numeric', text: 'old:numeric', providerText: source, translation: damages[2] },
    { id: 'good', text: 'old:good', providerText: 'Another valid sentence.', translation: '另一句有效译文。' },
    { id: 'literal', text: 'old:literal', providerText: 'Example: "},{', translation: '示例："},{' },
  ];
  for (const item of entries) {
    const identity = await createTranslationIdentity(config, item, pageKey, namespace);
    const { token } = await legacy.read(identity);
    await legacy.write(identity, { sourceText: item.text, source: translationSource(item), translation: item.translation }, { token });
  }
  const result = await app.lookupTranslations({ pageUrl, config, namespace, segments: entries });
  assert.deepEqual(result.hits, entries.slice(2).map(item => ({ id: item.id, text: item.translation })));
  assert.equal((await store.list({ namespace })).length, 2, 'only invalid legacy entries are removed');
  const bad = entries[0];
  await assert.rejects(app.storeTranslations({ pageUrl, config, namespace, items: [{ sourceText: bad.text,
    providerText: bad.providerText, translation: bad.translation, cacheToken: result.writeTokens[0].token }] }), { code: 'CACHE_INVALID_VALUE' });
});
