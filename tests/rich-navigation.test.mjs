import { zh_CN as contentMessages } from "../src/i18n/catalog.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { makeTinyTrueType } from './helpers/ttf-fixture.mjs';
import { createContentI18nStub } from './helpers/content-i18n-stub.mjs';

const id = 'rich-mdict-123e4567-e89b-42d3-a456-426614174000';
const version = 'import-navigation-123e4567';
const dictionary = { id, packVersion: version, packageVersion: version, preferred: true, status: 'ready', title: 'Synthetic navigation dictionary' };
const hit = (query, html = `<p id="sense.1">${query.toUpperCase()} DEFINITION</p><a href="entry://come#sense.1">COME LINK</a><a href="entry://go">GO LINK</a><a href="#sense.1">LOCAL LINK</a>`) => ({ ok: true, found: true, errors: [], dictionaries: [{ ...dictionary, text: `${query.toUpperCase()} DEFINITION`, headword: query, richRecord: { rawRecord: html, format: 'HTML' } }] });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(list = [dictionary], resources = false, messages = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid/selection' });
  const document = dom.window.document;
  const fontSet = new Set(); Object.defineProperty(document, 'fonts', { value: fontSet });
  for (const method of ['play', 'pause', 'load']) dom.window.HTMLMediaElement.prototype[method] = method === 'play' ? () => Promise.resolve() : () => {};
  class FakeFontFace { constructor(family) { this.family = family; } async load() { this.status = 'loaded'; return this; } }
  const container = document.createElement('div'); document.body.append(container);
  const calls = [], pending = [], outcomes = [], displayed = [], closed = [], navigations = [];
  let generation = 1;
  const app = { modules: { contentI18n: createContentI18nStub({ messages }),
    richResourceResolver: { close(host) { closed.push(host); } },
    runtime: { messages: { background: { RICH_MDICT_VIEWER_LIST: 'list', RICH_MDICT_LOOKUP: 'lookup', RICH_MDICT_LOOKUP_CANCEL: 'cancel', RICH_MDD_RESOURCE: 'asset', RICH_MDD_RESOURCE_READ_CANCEL: 'assetCancel' } },
      sendRuntimeMessage(message) { calls.push(message); if (message.type === 'list') return Promise.resolve({ ok: true, dictionaries: list });
        if (message.type === 'cancel' || message.type === 'assetCancel') return Promise.resolve({ ok: true, cancelled: true });
        if (message.type === 'asset') {
          const font = message.path.endsWith('.ttf');
          const bytes = font ? makeTinyTrueType() : Buffer.from('x');
          return Promise.resolve({ ok: true, found: true, packageVersion: version, kind: font ? 'font' : message.path.endsWith('.css') ? 'stylesheet' : 'audio',
            mime: font ? 'font/ttf' : message.path.endsWith('.css') ? 'text/css' : 'audio/wav', size: bytes.length, base64: bytes.toString('base64'),
            ...(message.path.endsWith('.css') ? { safeCss: '.font{font-family:tffamily0,serif}', assetSlots: [], fontFaces: [{ familyToken: 'tffamily0', path: 'fonts/static.ttf', style: 'normal', weight: '400', display: 'swap' }] } : {}) });
        }
        return new Promise((resolve) => pending.push({ message, resolve, finished: false })); }
    }, selectionPopover: { updateRichDictionarySummary(_, summary) { outcomes.push(summary); },
      appendRichDictionaryCards(rows, onLookup) { const cards = app.modules.selectionRichResultRenderer.appendRichDictionaryCards(container, rows, onLookup); app.cards = cards; }
    } } };
  if (resources) delete app.modules.richResourceResolver;
  const context = vm.createContext({ Blob, URL, Uint8Array, TextDecoder, atob, FontFace: FakeFontFace, __TRANSLATE_FLOW_CONTENT__: app, document, window: dom.window, location: dom.window.location, crypto: webcrypto, TextEncoder });
  for (const file of ['rich-controls', 'rich-sanitizer-tags', 'rich-sanitizer-style', 'rich-resource-path', 'rich-navigation-actions', 'rich-sanitizer-tokenizer', 'rich-sanitizer',
    'rich-navigation', ...(resources ? ['rich-resource-media', 'rich-resource-fonts', 'rich-resource-encoding', 'rich-resource-resolver'] : []), 'rich-viewer', 'rich-result-renderer', 'rich-lookup-identity', 'rich-details']) {
    vm.runInContext(readFileSync(new URL(`../src/content/selection/${file}.js`, import.meta.url), 'utf8'), context);
  }
  const factory = app.modules.richNavigation;
  app.modules.richNavigation = { create(options) { const runtime = factory.create(options); navigations.push(runtime); return runtime; } };
  return { app, document, container, dom, calls, pending, outcomes, displayed, closed, fontSet, navigation: () => navigations.at(-1),
    async start(query = 'go') { const current = generation; await app.modules.selectionRichDetails.load({ text: query }, current, dom.window.location.href, () => generation === current, (value) => displayed.push(value)); await flush(); },
    async complete(query, result = hit(query)) { const request = pending.find((item) => !item.finished && item.message.text === query); assert.ok(request, `pending ${query}`); request.finished = true; request.resolve(result); await flush(); },
    nextGeneration() { generation += 1; },
    viewer() { return container.querySelector('.tf-selection-rich-text')?.shadowRoot?.querySelector('.tf-rich-viewer'); },
    click(text) { const link = [...this.viewer().querySelectorAll('button')].find((node) => node.textContent === text); assert.ok(link, text); link.click(); },
    button(key) { return [...container.querySelectorAll('.tf-rich-navigation button')].find((node) => node.textContent === `content.rich.${key}`); },
    status() { return container.querySelector('.tf-rich-navigation [role="status"]')?.textContent; },
    async stop() { await app.modules.selectionRichDetails.cancel(); dom.window.close(); }
  };
}

test('entry headword decodes once, dot fragments stay literal, and malformed/remote/forged actions are inert', () => {
  const h = harness(); const api = h.app.modules.richNavigationActions;
  assert.deepEqual(JSON.parse(JSON.stringify(api.parse('entry://caf%C3%A9#sense.1'))), { kind: 'entry', headword: 'café', fragment: 'sense.1' });
  assert.equal(api.parse('#sense.1').fragment, 'sense.1');
  for (const value of ['https://attacker.invalid', 'javascript:alert(1)', 'entry:come', 'entry://', 'entry://come?dictionaryId=x', 'entry://%252fsecret', 'entry://%2f%2fhost', 'entry://a%00b', 'entry://%E0%A4', 'entry://come#a#b', 'entry://come#x[foo]', 'entry://' + 'x'.repeat(257)]) assert.equal(api.parse(value), null, value);
  assert.equal(api.validate({ kind: 'entry', headword: 'come', fragment: '', dictionaryId: 'forged' }), null);
  const invalid = h.app.modules.selectionRichSanitizer.sanitizeRichDictionaryRecord({ rawRecord: '<a href="https://attacker.invalid">REMOTE TEXT</a><a href="entry://come#sense.1">VALID</a>', format: 'HTML' });
  h.app.modules.selectionRichViewer.render(h.document.createElement('div'), invalid, 'BODY');
  h.dom.window.close();
});

test('go → come + dot fragment → Back → Forward stays same dictionary, versions and owner without recording again', async () => {
  const h = harness(); await h.start(); await h.complete('go');
  const summary = h.outcomes.at(-1); assert.equal(summary.counts.hit, 1); assert.equal(h.displayed.length, 1);
  h.click('COME LINK'); await flush(); assert.equal(h.status(), 'content.rich.navigationPending'); assert.ok(h.closed.length > 0);
  await h.complete('come'); assert.match(h.viewer().textContent, /COME DEFINITION/u);
  assert.equal(h.viewer().getRootNode().activeElement.dataset.richTargetId, 'sense.1');
  assert.equal(h.button('back').disabled, false); assert.equal(h.button('forward').disabled, true);
  h.button('back').click(); await flush(); await h.complete('go'); assert.match(h.viewer().textContent, /GO DEFINITION/u);
  h.button('forward').click(); await flush(); await h.complete('come'); assert.match(h.viewer().textContent, /COME DEFINITION/u);
  const lookups = h.calls.filter((item) => item.type === 'lookup');
  assert.equal(lookups.length, 4); assert.equal(new Set(lookups.map((item) => item.ownerToken)).size, 1);
  for (const request of lookups.slice(1)) { assert.equal(request.dictionaryId, id); assert.equal(request.expectedPackVersion, version); assert.equal(request.expectedPackageVersion, version); }
  assert.equal(h.outcomes.at(-1), summary); assert.equal(h.displayed.length, 1); await h.stop();
});

for (const kind of ['miss', 'error', 'forged', 'stale']) test(`navigation ${kind} restores current result without advancing cursor`, async () => {
  const h = harness(); await h.start(); await h.complete('go'); h.click('COME LINK'); await flush();
  const result = hit('come');
  if (kind === 'miss') { result.found = false; result.dictionaries = []; }
  if (kind === 'error') result.errors = [{ code: 'UNAVAILABLE' }];
  if (kind === 'forged') result.dictionaries[0].id = 'forged';
  if (kind === 'stale') result.dictionaries[0].packageVersion = 'changed';
  await h.complete('come', result);
  assert.match(h.viewer().textContent, /GO DEFINITION/u); assert.equal(h.button('back').disabled, true);
  assert.equal(h.status(), kind === 'miss' ? 'content.rich.navigationMiss' : 'content.rich.navigationUnavailable');
  assert.equal(h.displayed.length, 1); await h.stop();
});

test('duplicate current entry and local fragment only locate, and multi-record duplicate fragments use stable first with diagnostic', async () => {
  const h = harness(); await h.start(); const result = hit('go');
  result.dictionaries[0].records = [0, 1].map((index) => ({ headword: 'go', text: `RECORD ${index}`, richRecord: { rawRecord: `<p id="sense.1">RECORD ${index}</p><a href="entry://go#sense.1">SAME LINK</a>`, format: 'HTML' } }));
  await h.complete('go', result); h.click('SAME LINK'); await flush();
  const rendered = h.closed.length;
  assert.equal(h.calls.filter((item) => item.type === 'lookup').length, 1);
  assert.equal(h.closed.length, rendered);
  assert.equal(h.status(), 'content.rich.fragmentFirst');
  const hosts = [...h.container.querySelectorAll('.tf-selection-rich-text')];
  assert.equal(hosts[0].shadowRoot.activeElement.dataset.richTargetId, 'sense.1');
  assert.notEqual(hosts[1].shadowRoot.activeElement?.dataset.richTargetId, 'sense.1'); await h.stop();
});

test('local fragment clicks stay in their own terminal record even when entry navigation is bound', async () => {
  const h = harness(); await h.start(); const result = hit('go');
  result.dictionaries[0].records = [0, 1].map((index) => ({ headword: 'go', text: `RECORD ${index}`, richRecord: {
    rawRecord: `<p id="sense.1">RECORD ${index}</p>${index === 0 ? '<p id="first.only">FIRST ONLY</p>' : ''}<a href="#sense.1">LOCAL LINK</a><a href="#first.only">MISSING HERE</a>`, format: 'HTML'
  } }));
  await h.complete('go', result);
  const hosts = [...h.container.querySelectorAll('.tf-selection-rich-text')];
  const localFocus = () => hosts.map(host => host.shadowRoot.activeElement?.dataset.richTargetId === 'sense.1');
  hosts[1].shadowRoot.querySelector('[data-rich-fragment-target="sense.1"]').click();
  assert.deepEqual(localFocus(), [false, true]);
  hosts[1].shadowRoot.querySelector('[data-rich-fragment-target="first.only"]').click();
  assert.deepEqual(localFocus(), [false, true]);
  hosts[0].shadowRoot.querySelector('[data-rich-fragment-target="sense.1"]').click();
  assert.deepEqual(localFocus(), [true, false]);
  assert.equal(h.calls.filter(item => item.type === 'lookup').length, 1);
  assert.equal(h.navigation().snapshot.history.length, 1);
  assert.equal(h.displayed.length, 1);
  await h.stop();
});

test('Back and Forward restore the originating record of a local fragment without retaining its DOM', async () => {
  const h = harness(); await h.start(); const result = hit('go');
  result.dictionaries[0].records = [0, 1].map(index => ({ headword: 'go', text: `RECORD ${index}`, richRecord: {
    rawRecord: `<p id="sense.1">RECORD ${index}</p><a href="#sense.1">LOCAL LINK</a><a href="entry://come#sense.1">COME LINK</a>`, format: 'HTML'
  } }));
  await h.complete('go', result);
  const initialHosts = [...h.container.querySelectorAll('.tf-selection-rich-text')];
  initialHosts[1].shadowRoot.querySelector('[data-rich-fragment-target="sense.1"]').click();
  const nav = h.navigation();
  assert.equal(nav.snapshot.history[0].fragment, 'sense.1');
  initialHosts[1].shadowRoot.querySelector('[data-rich-action="entry"]').click();
  await flush(); await h.complete('come');
  h.button('back').click(); await flush(); await h.complete('go', result);
  const restoredHosts = [...h.container.querySelectorAll('.tf-selection-rich-text')];
  const focused = () => restoredHosts.map(host => host.shadowRoot.activeElement?.dataset.richTargetId === 'sense.1');
  assert.deepEqual(focused(), [false, true]);
  assert.notEqual(restoredHosts[1], initialHosts[1]);
  await nav.navigate({ kind: 'fragment', fragment: 'sense.1' }, null, initialHosts[0]);
  assert.deepEqual(focused(), [false, true]);
  h.button('forward').click(); await flush(); await h.complete('come');
  assert.equal(h.viewer().getRootNode().activeElement.dataset.richTargetId, 'sense.1');
  assert.equal(h.calls.filter(item => item.type === 'lookup').length, 4);
  for (const item of nav.snapshot.history) assert.deepEqual(Object.keys(item).sort(), ['fragment', 'id', 'packVersion', 'packageVersion', 'query'].sort());
  assert.equal(h.displayed.length, 1); await h.stop();
});

test('a missing originating record on Back never redirects its fragment to another record', async () => {
  const h = harness(); await h.start(); const result = hit('go');
  result.dictionaries[0].records = [0, 1].map(index => ({ headword: 'go', text: `RECORD ${index}`, richRecord: {
    rawRecord: `<p id="sense.1">RECORD ${index}</p><a href="#sense.1">LOCAL LINK</a>`, format: 'HTML'
  } }));
  await h.complete('go', result);
  const hosts = [...h.container.querySelectorAll('.tf-selection-rich-text')];
  hosts[1].shadowRoot.querySelector('[data-rich-fragment-target="sense.1"]').click();
  void h.navigation().navigate({ kind: 'entry', headword: 'come', fragment: '' });
  await flush(); await h.complete('come');
  h.button('back').click(); await flush();
  const missing = { ...result, dictionaries: [{ ...result.dictionaries[0], records: result.dictionaries[0].records.slice(0, 1) }] };
  await h.complete('go', missing);
  assert.equal(h.status(), 'content.rich.fragmentMissing');
  assert.notEqual(h.viewer().getRootNode().activeElement?.dataset.richTargetId, 'sense.1');
  assert.equal(h.calls.filter(item => item.type === 'lookup').length, 3); await h.stop();
});

test('new navigation cancels inflight request and an old late response cannot replace the latest entry', async () => {
  const h = harness(); await h.start(); await h.complete('go'); h.click('COME LINK'); await flush();
  const nav = h.navigation(); void nav.navigate({ kind: 'entry', headword: 'other', fragment: '' }); await flush();
  assert.equal(h.calls.filter((item) => item.type === 'cancel').length, 1);
  await h.complete('other'); await h.complete('come');
  assert.match(h.viewer().textContent, /OTHER DEFINITION/u); assert.equal(nav.snapshot.history.length, 2);
  assert.equal(h.displayed.length, 1); await h.stop();
});

test('new selection and generation changes suppress late navigation and clear its session history', async () => {
  const h = harness(); await h.start(); await h.complete('go'); h.click('COME LINK'); await flush();
  h.nextGeneration(); await h.start('new'); await h.complete('come'); await h.complete('new');
  assert.match(h.viewer().textContent, /NEW DEFINITION/u); assert.equal(h.calls.filter((item) => item.type === 'cancel').length, 1);
  assert.equal(h.container.querySelectorAll('.tf-rich-navigation').length, 1); await h.stop();
});

test('history keeps only twenty metadata entries, truncates forward after a successful new target, and discards payloads', async () => {
  const h = harness(); await h.start(); await h.complete('go'); const nav = h.navigation();
  for (let index = 0; index < 22; index += 1) { void nav.navigate({ kind: 'entry', headword: `word${index}`, fragment: '' }); await flush(); await h.complete(`word${index}`); }
  assert.equal(nav.snapshot.history.length, 20); assert.equal(nav.snapshot.cursor, 19);
  for (const item of nav.snapshot.history) assert.deepEqual(Object.keys(item).sort(), ['fragment', 'id', 'packVersion', 'packageVersion', 'query'].sort());
  h.button('back').click(); await flush(); await h.complete('word20');
  assert.equal(nav.snapshot.cursor, 18); assert.equal(h.button('forward').disabled, false);
  void nav.navigate({ kind: 'entry', headword: 'fresh', fragment: '' }); await flush(); await h.complete('fresh');
  assert.equal(nav.snapshot.history.at(-1).query, 'fresh'); assert.equal(h.button('forward').disabled, true);
  assert.equal(nav.snapshot.history.some((item) => item.query === 'word21'), false);
  await h.stop(); assert.equal(nav.snapshot.history.length, 0); assert.equal(nav.snapshot.closed, true);
});

for (const event of ['pagehide', 'route']) test(`${event} clears navigation history, resources and late results`, async () => {
  const h = harness(); const page = h.dom.window.location.href;
  h.app.modules.selectionRichDetails.bindLifecycle({ getActivePage: () => page, getPageIdentity: (value) => new URL(value).pathname,
    onPageHide: () => { void h.app.modules.selectionRichDetails.cancel(); }, onRouteLeave: () => { void h.app.modules.selectionRichDetails.cancel(); } });
  await h.start(); await h.complete('go'); const nav = h.navigation(); h.click('COME LINK'); await flush();
  if (event === 'route') { h.dom.window.history.pushState({}, '', '/other-route'); h.dom.window.dispatchEvent(new h.dom.window.PopStateEvent('popstate')); }
  else h.dom.window.dispatchEvent(new h.dom.window.Event('pagehide'));
  await flush(); await h.complete('come');
  assert.equal(nav.snapshot.closed, true); assert.equal(nav.snapshot.history.length, 0);
  assert.equal(h.container.querySelector('.tf-rich-navigation'), null); assert.equal(h.viewer(), undefined); assert.ok(h.closed.length > 0);
  await h.stop();
});

test('queued navigation is removed before its message starts and the replacement uses the same bounded queue', async () => {
  const list = [dictionary, ...[4, 5, 6].map((index) => ({ ...dictionary, id: `rich-mdict-${index}23e4567-e89b-42d3-a456-426614174000`, preferred: false, expandedByDefault: true }))];
  const h = harness(list); await h.start();
  // Initial three reads are in flight; resolving this dictionary allows the fourth initial read to occupy the freed slot.
  const first = h.pending[0]; first.finished = true; first.resolve(hit('go')); await flush();
  const nav = h.navigation(); void nav.navigate({ kind: 'entry', headword: 'come', fragment: '' }); await flush();
  assert.equal(h.calls.some((item) => item.text === 'come'), false);
  void nav.navigate({ kind: 'entry', headword: 'other', fragment: '' }); await flush();
  const unrelated = h.pending.find((item) => !item.finished); unrelated.finished = true; unrelated.resolve({ ok: true, found: false, dictionaries: [], errors: [] }); await flush();
  assert.equal(h.calls.some((item) => item.text === 'come'), false); assert.equal(h.calls.some((item) => item.text === 'other'), true);
  await h.complete('other'); assert.match(h.viewer().textContent, /OTHER DEFINITION/u); await h.stop();
  for (const item of h.pending.filter((item) => !item.finished)) item.resolve({ ok: false }); await flush();
});

test('untrusted button data and forged action identity cannot issue lookup requests', async () => {
  const h = harness(); await h.start(); await h.complete('go');
  const fake = h.document.createElement('button'); fake.dataset.richAction = 'entry'; fake.dataset.richEntryTarget = 'other'; h.viewer().append(fake); fake.click();
  void h.navigation().navigate({ kind: 'entry', headword: 'other', fragment: '', dictionaryId: 'forged' }); await flush();
  assert.equal(h.calls.filter((item) => item.type === 'lookup').length, 1); await h.stop();
});

test('navigation closes actual resolver fonts/audio and restores resources afresh on Back without re-recording', async () => {
  const h = harness([dictionary], true); await h.start();
  const html = '<link rel="stylesheet" href="style.css"><p class="font">GO FONT BODY</p><a href="sound://audio/go.wav">GO AUDIO</a><a href="entry://come">COME LINK</a>';
  await h.complete('go', hit('go', html));
  for (let step = 0; step < 20 && !h.fontSet.size; step += 1) await flush();
  assert.equal(h.fontSet.size, 1);
  h.viewer().querySelector('[data-action="load-mdd-audio"]').click();
  for (let step = 0; step < 20 && !h.viewer().querySelector('audio'); step += 1) await flush();
  assert.equal(h.viewer().querySelectorAll('audio').length, 1);
  assert.equal(h.app.modules.richResourceResolver.activeObjectUrlCount, 1);
  const before = h.calls.length, font = [...h.fontSet][0];
  await h.navigation().navigate({ kind: 'entry', headword: 'go', fragment: '' }); await flush();
  assert.equal(h.calls.length, before); assert.equal([...h.fontSet][0], font); assert.equal(h.app.modules.richResourceResolver.activeObjectUrlCount, 1);
  h.click('COME LINK'); await flush();
  assert.equal(h.fontSet.size, 0); assert.equal(h.app.modules.richResourceResolver.activeObjectUrlCount, 0);
  await h.complete('come'); assert.match(h.viewer().textContent, /COME DEFINITION/u);
  h.button('back').click(); await flush(); await h.complete('go', hit('go', html));
  for (let step = 0; step < 20 && !h.fontSet.size; step += 1) await flush();
  assert.equal(h.fontSet.size, 1); assert.equal(h.viewer().querySelector('audio'), null);
  assert.equal(h.displayed.length, 1);
  await h.stop(); assert.equal(h.fontSet.size, 0); assert.equal(h.app.modules.richResourceResolver.activeObjectUrlCount, 0);
});

test('a changed generation without explicit cancel cannot commit navigation or retain history', async () => {
  const h = harness(); await h.start(); await h.complete('go'); const nav = h.navigation(); h.click('COME LINK'); await flush();
  h.nextGeneration(); await h.complete('come'); assert.equal(nav.snapshot.closed, true); assert.equal(nav.snapshot.history.length, 0);
  assert.equal(h.viewer(), undefined); assert.equal(h.displayed.length, 1); await h.stop();
});

for (const kind of ['error', 'stale']) test(`localized navigation ${kind} explicitly retains the current entry`, async () => {
  const h = harness([dictionary], false, contentMessages); await h.start(); await h.complete('go');
  h.viewer().querySelector('button').click(); await flush(); const response = hit('come');
  if (kind === 'error') response.errors = [{ code: 'UNAVAILABLE' }]; else response.dictionaries[0].packageVersion = 'changed';
  await h.complete('come', response);
  assert.equal(h.status(), '目标词条未能打开，已保留当前词条。');
  assert.match(h.viewer().textContent, /GO DEFINITION/); assert.equal(h.navigation().snapshot.cursor, 0); h.dom.window.close();
});
