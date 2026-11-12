import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup() {
  const events = {}, location = { href: 'https://example.test/article' };
  const app = { modules: {
    contentI18n: { t: key => key },
    browserTranslationContract: {},
    browserTranslation: { error: code => Object.assign(new Error(code), { code }), dispose() {} },
    browserTranslationView: { close() {} }
  } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, location, URL, crypto, AbortController,
    window: { addEventListener: (type, fn) => { events[type] = fn; },
      navigation: { addEventListener: (type, fn) => { events[`navigation:${type}`] = fn; } } },
    chrome: { runtime: { onMessage: { addListener() {} } } } });
  for (const name of ['runtime', 'translation-client'])
    vm.runInContext(await readFile(new URL(`../src/content/${name}.js`, import.meta.url), 'utf8'), context);
  return { client: app.modules.translationClient, events, location };
}

for (const [name, next, event, shouldCancel] of [
  ['chapter anchor via history', '/article#register', 'navigation:navigate', false],
  ['chapter anchor via hashchange', '/article#submit', 'hashchange', false],
  ['anchor history traversal', '/article#errors', 'popstate', false],
  ['same URL history traversal', '/article', 'popstate', false],
  ['tracking-only history update', '/article?utm_source=docs#register', 'navigation:navigate', false],
  ['URL update without Navigation API', '/article#register', null, false],
  ['different path', '/other', 'navigation:navigate', true],
  ['different query', '/article?lang=fr', 'popstate', true],
  ['hash router', '/article#/other', 'hashchange', true],
  ['hashbang router', '/article#!/other', 'navigation:navigate', true],
  ['route update without Navigation API', '/other', null, true],
  ['leaving document', '/article', 'pagehide', true],
  ['new document at same URL', '/article', 'new-document', true],
  ['explicit cancellation', '/article', 'cancel', true]
]) test(`translation lifecycle: ${name}`, async () => {
  const { client, events, location } = await setup();
  const payload = { type: 'TRANSLATE_BATCH', requestId: 'page-task', pageUrl: location.href,
    configSnapshotId: 'ai-snapshot', segments: [{ id: '1', text: 'Original paragraph.' }] };
  const { promise, resolve } = Promise.withResolvers();
  const pending = client.send(payload, () => promise);
  const url = new URL(next, location.href).href;
  if (event === 'navigation:navigate' || event === 'new-document')
    events['navigation:navigate']({ destination: { url, sameDocument: event !== 'new-document' } });
  location.href = url;
  if (['hashchange', 'popstate', 'pagehide'].includes(event)) events[event]({});
  if (event === 'cancel') await client.send({ type: 'CANCEL_TRANSLATION', requestId: 'page-task' }, async () => ({ cancelled: true }));
  resolve({ ok: true, translations: [{ id: '1', text: '译文' }] });
  if (shouldCancel) await assert.rejects(pending, { code: 'CANCELLED' });
  else {
    assert.equal((await pending).translations[0].text, '译文');
    // A page task freezes its original URL across every later batch/cache write.
    assert.equal((await client.send(payload, async () => ({ ok: true, translations: [{ id: '1', text: '下一批' }] }))).translations[0].text, '下一批');
  }
});
