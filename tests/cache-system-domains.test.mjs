import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, createCacheIdentity } from '../src/shared/cache/identity.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createApplicationCache, getCacheContext, getConfigHash } from '../src/background/cache/application.js';
import { createTranslationIdentity, translationRequestDescriptor, STRUCTURED_PROMPT,
  validateTranslationValue } from '../src/shared/translation-cache-identity.js';
import { createTranslationCoordinator, buildTranslationRequestKey } from '../src/background/cache/translation-coordinator.js';
import { CACHE_DATABASE_VERSION } from '../src/background/cache/storage-indexeddb.js';

const config = { provider: 'deepseek', model: 'fixture-model', targetLanguage: 'zh', prompt: 'Translate accurately.' };
const pageUrl = 'https://fixture.invalid/article';
const plain = { id: 'p', text: 'A complete sentence.', format: 'plain' };
const rich = { id: 'r', text: 'Read ⟦TF:0:S⟧useMemo⟦TF:0:E⟧ carefully.', protectedIds: [0], format: 'tf-markers' };
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const application = () => createApplicationCache({ store: createMemoryCacheStore() });
async function save(app, segment, translation, extra = {}) {
  const lookup = await app.lookupTranslations({ pageUrl, segments: [segment], config, ...extra });
  return app.storeTranslations({ pageUrl, config, items: [{ sourceText: segment.text, providerText: segment.providerText,
    protectedIds: segment.protectedIds, format: segment.format, translation, cacheToken: lookup.writeTokens[0].token }], ...extra });
}

test('same request ignores transport streaming, UI preferences and credential bytes', async () => {
  const base = await getConfigHash(config);
  for (const patch of [{ streaming: true }, { appearance: 'dark' }, { apiKey: 'do-not-hash' }, { glossaryIdentity: [] }])
    assert.equal(await getConfigHash({ ...config, ...patch }), base);
});
for (const [name, patch] of Object.entries({ provider: { provider: 'other' }, model: { model: 'changed' }, source: { sourceLanguage: 'fr' },
  target: { targetLanguage: 'ja' }, prompt: { prompt: 'Another instruction.' }, endpoint: { apiBaseUrl: 'http://localhost:11434/v1' },
  connection: { connectionRevision: 2 }, temperature: { temperature: 0.7 }, topP: { topP: 0.8 }, seed: { seed: 7 },
  inputPolicy: { inputVersion: 'extract-v2' }, strategy: { translationStrategyVersion: 'translation-v2' }, context: { translationContextIdentity: { section: 'another' } } }))
  test(`request semantics change identity: ${name}`, async () => assert.notEqual(await getConfigHash(config), await getConfigHash({ ...config, ...patch })));

test('strategy changes do not depend on or alter the physical database layout', async () => {
  const dbVersion = CACHE_DATABASE_VERSION;
  const first = await createTranslationIdentity(config, plain, 'page');
  const second = await createTranslationIdentity({ ...config, translationStrategyVersion: 'new-extraction' }, plain, 'page');
  assert.notEqual(first.key, second.key); assert.equal(CACHE_DATABASE_VERSION, dbVersion);
  assert.equal(await getConfigHash(config), await getConfigHash({ ...config, databaseVersion: 900 }));
});
test('cache uses final rich instruction identical to execution, not just saved user prompt', async () => {
  const plan = translationRequestDescriptor(config, rich);
  assert.equal(plan.preparedConfig.prompt, config.prompt + '\n' + STRUCTURED_PROMPT);
  assert.equal(plan.semanticRequest.config.prompt, plan.preparedConfig.prompt);
  const again = translationRequestDescriptor(plan.preparedConfig, rich);
  assert.equal(again.preparedConfig.prompt, plan.preparedConfig.prompt);
  assert.notEqual((await createTranslationIdentity(config, plain, 'page')).key, (await createTranslationIdentity(config, rich, 'page')).key);
});
test('MT ignores AI instructions, but isolates source language and endpoint/version', async () => {
  const mt = { engine: 'machine-translation', provider: 'mt-microsoft-web', sourceLanguage: 'en', targetLanguage: 'zh', inputVersion: 'mt-slots-v1' };
  assert.equal(await getConfigHash(mt), await getConfigHash({ ...mt, apiKey: 'private', prompt: 'unused', temperature: 0.8 }));
  assert.notEqual(await getConfigHash(mt), await getConfigHash({ ...mt, sourceLanguage: 'fr' }));
  assert.equal(translationRequestDescriptor(mt, rich).preparedConfig.prompt, undefined);
});
test('plain literal TF text stays data when the caller declares plain format', async () => {
  const segment = { id: 's', text: 'Literal ⟦TF:0:S⟧ characters in documentation.', format: 'plain' };
  const plan = translationRequestDescriptor(config, segment);
  assert.equal(plan.preparedConfig.prompt, config.prompt);
  assert.equal(plan.source.text, segment.text);
});
test('source text identity preserves whitespace, case, Unicode joiners and exact code', async () => {
  const values = ['A B', 'A  B', 'a b', 'A\u00a0B', 'A\nB', 'A\u200dB'];
  const identities = await Promise.all(values.map(text => createTranslationIdentity(config, { text, format: 'plain' }, 'page')));
  assert.equal(new Set(identities.map(x => x.key)).size, values.length);
});
test('normalized URL retains existing tracking and hash-route policy', async () => {
  const a = await getCacheContext('https://example.test/doc?id=1&utm_source=x#anchor', config);
  const b = await getCacheContext('https://example.test/doc?id=1', config);
  const c = await getCacheContext('https://example.test/doc?id=1#/other', config);
  assert.equal(a.pageKey, b.pageKey); assert.notEqual(b.pageKey, c.pageKey);
});
test('UI facade returns exact hits and preserves caller IDs without storing them as identity', async () => {
  const app = application(); assert.equal((await save(app, plain, '完整的句子。')).stored, 1);
  const lookup = await app.lookupTranslations({ pageUrl, config, segments: [{ ...plain, id: 'different-id' }] });
  assert.deepEqual(lookup.hits, [{ id: 'different-id', text: '完整的句子。' }]);
});
test('page/scope, model and engine cache isolation', async () => {
  const app = application(); await save(app, plain, '译文');
  for (const extra of [{ pageUrl: pageUrl + '/other' }, { config: { ...config, model: 'different' } },
    { config: { ...config, engine: 'browser-translator', provider: 'browser-translator', sourceLanguage: 'en' } }])
    assert.deepEqual((await app.lookupTranslations({ pageUrl, config, segments: [plain], ...extra })).hits, []);
});
test('translation and subtitle namespaces never cross-hit', async () => {
  const app = application(); await save(app, plain, 'page');
  assert.deepEqual((await app.lookupTranslations({ pageUrl, config, namespace: 'subtitle-translation', segments: [plain] })).hits, []);
});
test('subtitle location identity is separate from actual provider text', async () => {
  const segment = { id: 'cue', text: 'cue:video:track:time:hello', providerText: 'Hello.', format: 'plain' };
  const app = application(); await save(app, segment, '你好。', { namespace: 'subtitle-translation' });
  const hit = await app.lookupTranslations({ pageUrl, config, namespace: 'subtitle-translation', segments: [segment] });
  assert.equal(hit.hits.length, 1);
  const miss = await app.lookupTranslations({ pageUrl, config, namespace: 'subtitle-translation', segments: [{ ...segment, providerText: 'Changed.' }] });
  assert.equal(miss.hits.length, 0);
});
test('clear page invalidates outstanding write tickets and keeps explanations/other pages', async () => {
  const app = application(), captured = await app.lookupTranslations({ pageUrl, config, segments: [plain] });
  const exp = await app.lookupSelectionExplanation({ cacheKey: 'external-key' });
  await app.storeSelectionExplanation({ cacheKey: 'external-key', result: { answer: 'keep' }, cacheToken: exp.cacheToken });
  await app.clearPageCache({ pageUrl });
  const result = await app.storeTranslations({ pageUrl, config, items: [{ sourceText: plain.text, format: 'plain', translation: 'late', cacheToken: captured.writeTokens[0].token }] });
  assert.equal(result.stored, 0); assert.equal((await app.lookupSelectionExplanation({ cacheKey: 'external-key' })).hit.answer, 'keep');
});
test('full clear removes current caches, without any domain owning Reading storage', async () => {
  const app = application(); await save(app, plain, 'text');
  const exp = await app.lookupSelectionExplanation({ cacheKey: 'key' });
  await app.storeSelectionExplanation({ cacheKey: 'key', result: { answer: 'structured' }, cacheToken: exp.cacheToken });
  assert.equal((await app.getCacheStats()).selectionExplanationCount, 1);
  await app.clearAllCache(); assert.equal((await app.getCacheStats()).segmentCount, 0); assert.equal((await app.getCacheStats()).selectionExplanationCount, 0);
});
test('page status is derived from entries rather than a separately inconsistent page index', async () => {
  const app = application(); await save(app, plain, 'text', { pageTitle: 'Title' });
  const stats = await app.getPageCacheStatus({ pageUrl, config });
  assert.equal(stats.count, 1); assert.equal(stats.totalCount, 1); assert.equal(stats.title, 'Title');
  await app.clearPageCache({ pageUrl }); assert.equal((await app.getCacheStats()).pageCount, 0);
});
for (const [name, translated] of [
  ['missing marker', 'Read useMemo carefully.'],
  ['duplicate pair', '⟦TF:0:S⟧useMemo⟦TF:0:E⟧ ⟦TF:0:S⟧useMemo⟦TF:0:E⟧'],
  ['wrong code', 'Read ⟦TF:0:S⟧usememo⟦TF:0:E⟧ carefully.'],
  ['unknown id', 'Read ⟦TF:2:S⟧useMemo⟦TF:2:E⟧ carefully.'],
]) test(`domain rejects ${name} before storage`, async () => {
  const app = application(); await assert.rejects(save(app, rich, translated), { code: 'CACHE_INVALID_VALUE' });
  assert.equal((await app.getCacheStats()).segmentCount, 0);
});
test('complete sibling pairs may reorder but cannot change the parent link', () => {
  const source = { text: '⟦TF:0:S⟧one⟦TF:0:E⟧ ⟦TF:1:S⟧two⟦TF:1:E⟧', cacheSource: 'source', protectedIds: [], format: 'tf-markers' };
  assert.equal(validateTranslationValue({ sourceText: 'source', source, translation: '⟦TF:1:S⟧二⟦TF:1:E⟧ ⟦TF:0:S⟧一⟦TF:0:E⟧' }), true);
  assert.equal(validateTranslationValue({ sourceText: 'source', source, translation: '⟦TF:1:S⟧⟦TF:0:S⟧一⟦TF:0:E⟧二⟦TF:1:E⟧' }), false);
});
test('multiple future JSON cache scenarios register without schema changes', async () => {
  const app = application(); app.cache.register('capability', { ttlMs: 500, validate: value => ['ready', 'unavailable'].includes(value.state) });
  const key = await createCacheIdentity({ namespace: 'capability', scope: 'local', revision: 'detector-v2', input: { model: 'one' } });
  const result = await app.cache.getOrLoad(key, async () => ({ state: 'ready' }));
  assert.equal(result.stored, true); assert.equal((await app.cache.read(key)).value.state, 'ready');
});
test('coordinator separates mixed plain/rich batches and shares the exact final prompt', async () => {
  const calls = [];
  const coordinator = createTranslationCoordinator(async request => { calls.push(request); return request.segments.map(x => ({ id: x.id, text: x.text })); });
  const output = await coordinator.run({ requestId: 'a', segments: [plain, rich], config, pageUrl });
  assert.equal(calls.length, 2); assert.equal(output.length, 2);
  assert.equal(calls[0].config.prompt, config.prompt); assert.equal(calls[1].config.prompt, config.prompt + '\n' + STRUCTURED_PROMPT);
});
test('coordinator never shares across pages and does not include secrets in the key', async () => {
  let calls = 0;
  const coordinator = createTranslationCoordinator(async request => { calls++; return request.segments.map(x => ({ id: x.id, text: x.text })); });
  await Promise.all([coordinator.run({ requestId: 'a', segments: [plain], config, pageUrl }), coordinator.run({ requestId: 'b', segments: [plain], config, pageUrl: pageUrl + '/2' })]);
  assert.equal(calls, 2); assert.doesNotMatch(buildTranslationRequestKey([plain], { ...config, apiKey: 'hidden-secret' }), /hidden-secret|apiKey/);
});
test('coordinator MT tab cancellation is isolated and cancellation rejects promptly', async () => {
  const started = defer(), finish = defer(); let calls = 0;
  const coordinator = createTranslationCoordinator(async request => { calls++; started.resolve(); await finish.promise; return request.segments.map(x => ({ id: x.id, text: x.text })); });
  const mt = { ...config, engine: 'machine-translation' };
  const a = coordinator.run({ requestId: 'a', segments: [plain], config: mt, pageUrl, ownerTabId: 1 });
  const b = coordinator.run({ requestId: 'b', segments: [plain], config: mt, pageUrl, ownerTabId: 2 });
  const rejection = assert.rejects(a, { code: 'CANCELLED' }); await started.promise; await turn(); coordinator.cancelMachine(1); await rejection;
  finish.resolve(); assert.equal((await b).length, 1); assert.equal(calls, 1);
});
test('invalid/duplicate provider IDs are refused rather than misassigned', async () => {
  const coordinator = createTranslationCoordinator(async () => [{ id: 'not-requested', text: 'wrong' }]);
  await assert.rejects(coordinator.run({ segments: [plain], config, pageUrl }), { code: 'MALFORMED_RESPONSE' });
});
