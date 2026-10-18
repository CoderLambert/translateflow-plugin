import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { createContentI18nStub } from './helpers/content-i18n-stub.mjs';
import { makeOxfordAdapterRecord, ADAPTER_DIAGRAM } from './helpers/oxford-adapter-fixture.mjs';
import { parseSafeSvg, validateSafeSvgScene, extractSafeSvg } from '../src/shared/safe-svg.js';

function pipeline({ assets, defer = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid/' }); const document = dom.window.document;
  for (const method of ['play', 'pause', 'load']) dom.window.HTMLMediaElement.prototype[method] = method === 'play' ? () => Promise.resolve() : () => {};
  const calls = [], pending = [], stopped = [];
  const app = { modules: { safeSvg: { parseSafeSvg, validateSafeSvgScene, extractSafeSvg }, contentI18n: createContentI18nStub(),
    ...(assets ? { runtime: { messages: { background: { RICH_MDD_RESOURCE: 'read', RICH_MDD_RESOURCE_READ_CANCEL: 'cancel' } }, sendRuntimeMessage(message) {
      calls.push(message); if (message.type === 'cancel') return Promise.resolve({ ok: true, cancelled: true });
      if (defer) return new Promise((resolve) => pending.push({ message, resolve }));
      return Promise.resolve(assets(message));
    } } } : { richResourceResolver: { attach() {}, close() {}, stopAudio(host) { stopped.push(host); }, closeImagePreview() { return false; } } }) } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, TextEncoder, TextDecoder, Uint8Array, Blob, URL, atob, crypto: webcrypto });
  for (const name of ['rich-controls', 'rich-resource-path', 'rich-sanitizer-tags', 'rich-sanitizer-style', 'rich-navigation-actions', 'rich-svg', 'rich-oxford-adapter', 'rich-sanitizer-tokenizer', 'rich-sanitizer',
    ...(assets ? ['rich-resource-media', 'rich-resource-fonts', 'rich-resource-encoding', 'rich-resource-preview', 'rich-resource-resolver'] : []), 'rich-viewer']) {
    vm.runInContext(readFileSync(new URL(`../src/content/selection/${name}.js`, import.meta.url), 'utf8'), context);
  }
  const hosts = [];
  const p = { dom, app, document, calls, pending, stopped, hosts, sanitize: (html) => app.modules.selectionRichSanitizer.sanitizeRichDictionaryRecord({ rawRecord: html, format: 'HTML' }),
    render(html) { const host = document.createElement('div'); document.body.append(host); hosts.push(host); app.modules.selectionRichViewer.render(host, p.sanitize(html), 'SAFE TEXT', { dictionaryId: 'rich-mdict-123e4567-e89b-42d3-a456-426614174000', packVersion: 'import-mdx-123e4567', packageVersion: 'import-mdd-123e4567', recordOffset: hosts.length * 100 }); return host; },
    escape() { const event = { preventDefault() {}, stopImmediatePropagation() {} }; return app.modules.richOxfordAdapter.consumeEscape(event, document.body); },
    close() { app.modules.richOxfordAdapter.closeAll(); app.modules.richResourceResolver?.closeAll?.(); dom.window.close(); } };
  return p;
}
const nodes = (items) => items.flatMap((node) => [node, ...nodes(node.children || [])]);
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function settle(p) { for (let index = 0; index < 100; index += 1) { await flush(); if (!p.app.modules.richResourceResolver.runningReadCount && !p.app.modules.richResourceResolver.pendingReadCount) return; } assert.fail('queue did not settle'); }
const response = () => ({ ok: true, found: true, packageVersion: 'import-mdd-123e4567', kind: 'image', mime: 'image/svg+xml', safeSvg: parseSafeSvg(ADAPTER_DIAGRAM).scene, size: Buffer.byteLength(ADAPTER_DIAGRAM), width: 24, height: 24 });

for (const [count, pronunciationIndices] of [[3, [0, 1, 2]], [4, [0, 3]]]) test(`Oxford structural ${count}/${pronunciationIndices.length} adapter synchronizes native POS and missing mappings without borrowing`, () => {
  const p = pipeline(); const html = makeOxfordAdapterRecord({ posCount: count, pronunciationIndices }); const ast = p.sanitize(html);
  const plan = p.app.modules.richOxfordAdapter.recognize(ast.nodes); assert.equal(plan.version, 'oxford10-v1');
  const radio = nodes(ast.nodes).find((node) => node.tag === 'input'); assert.deepEqual(Object.keys(radio.oxfordHints), ['posIndex']);
  assert.equal(Object.keys(radio.attrs).some((key) => key === 'data-pos-index'), false);
  const host = p.render(html), root = host.shadowRoot;
  for (let index = 0; index < count; index += 1) {
    const label = root.querySelector(`label[for="pos-${index}"]`); label.click();
    assert.equal(root.querySelector(`#pos-${index}`).checked, true);
    assert.equal([...root.querySelectorAll('.o-pos-panel')].filter((node) => !node.hidden).length, 1);
    const active = [...root.querySelectorAll('.o-pronunciation-set')].filter((node) => !node.hidden);
    assert.equal(active.length, pronunciationIndices.includes(index) ? 1 : 0);
    if (active.length) assert.match(active[0].textContent, new RegExp(`PRON ${index}`));
  }
  assert.ok(p.stopped.length >= count); p.close();
});

for (const [name, change] of [
  ['noncanonical index', (html) => html.replace('data-pos-index="0"', 'data-pos-index="00"')],
  ['class conflict', (html) => html.replace('o-pos-radio-0', 'o-pos-radio-1')],
  ['panel conflict', (html) => html.replace('o-for-pos-2"><div class="o-pos-body"', 'o-for-pos-1"><div class="o-pos-body"')],
  ['label conflict', (html) => html.replace('for="pos-0" class="o-for-pos-0"', 'for="pos-0" class="o-for-pos-1"')],
  ['multiple switch', (html) => html + '<div class="o-pos-switch"></div>'],
  ['no word line', (html) => html.replace('o-word-line', 'generic-word')]
]) test(`malformed ${name} keeps generic controls and does not install Oxford owned actions`, () => {
  const p = pipeline(); const html = change(makeOxfordAdapterRecord()); const ast = p.sanitize(html);
  assert.equal(p.app.modules.richOxfordAdapter.recognize(ast.nodes), null);
  const host = p.render(html); assert.equal(host.shadowRoot.querySelectorAll('.tf-rich-owned-action').length, 0);
  assert.equal(host.shadowRoot.querySelectorAll('input').length, 3); p.close();
});

test('optional duplicate/forged mappings disable only their relation and never select a different POS set', () => {
  const p = pipeline(); let html = makeOxfordAdapterRecord({ pronunciationIndices: [0, 0, 3], posCount: 3 });
  html = html.replace('data-head-symbols-for="0"', 'data-head-symbols-for="+0"');
  const host = p.render(html); const root = host.shadowRoot;
  assert.equal(root.querySelectorAll('.tf-rich-owned-action').length > 0, true);
  assert.equal([...root.querySelectorAll('.o-pronunciation-set')].filter((node) => !node.hidden).length, 0);
  const ast = p.sanitize(makeOxfordAdapterRecord()); const input = nodes(ast.nodes).find((node) => node.tag === 'input'); input.oxfordHints = { posIndex: '0' };
  assert.equal(p.app.modules.richOxfordAdapter.recognize(ast.nodes), null); p.close();
});

test('POS keyboard and literal dot fragment activate the matching panel, open native details, and remain record-local', () => {
  const p = pipeline(); const first = p.render(makeOxfordAdapterRecord()), second = p.render(makeOxfordAdapterRecord());
  const label = first.shadowRoot.querySelector('label[for="pos-0"]'); label.focus(); label.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(first.shadowRoot.querySelector('#pos-2').checked, true); assert.equal(second.shadowRoot.querySelector('#pos-0').checked, true);
  const match = p.app.modules.richNavigationActions.locate([first], 'panel.1.deep');
  assert.equal(match.found, true); assert.equal(first.shadowRoot.querySelector('#pos-1').checked, true);
  const target = [...first.shadowRoot.querySelectorAll('[data-rich-target-id]')].find((node) => node.dataset.richTargetId === 'panel.1.deep');
  assert.equal(target.closest('details').open, true); assert.equal(first.shadowRoot.activeElement, target); p.close();
});

test('owned hints use bounded sanitized text, Escape restores focus and missing/oversized tips remain generic', () => {
  const p = pipeline(); const host = p.render(makeOxfordAdapterRecord()); const root = host.shadowRoot;
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.showHint'); button.click();
  assert.match(root.querySelector('.tf-rich-owned-hint').textContent, /SYNTHETIC TIP/u); assert.equal(root.querySelector('.tf-rich-owned-hint script'), null);
  assert.equal(p.escape(), true); assert.equal(root.querySelector('.tf-rich-owned-hint'), null); assert.equal(root.activeElement, button); assert.equal(p.escape(), false);
  const over = p.render(makeOxfordAdapterRecord().replace('SYNTHETIC TIP', 'x'.repeat(1025))); assert.equal([...over.shadowRoot.querySelectorAll('button')].some((node) => node.textContent === 'content.rich.showHint'), false); p.close();
});

test('descriptor-only SVG illustration preview shares budgets, closes before hint, refunds and restores focus', async () => {
  const p = pipeline({ assets: () => response() }); const host = p.render(makeOxfordAdapterRecord()); await settle(p); const root = host.shadowRoot;
  const hint = [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.showHint'); hint.click();
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.viewIllustration'); button.click(); await settle(p);
  assert.equal(root.querySelectorAll('.tf-rich-image-preview svg').length, 1);
  assert.equal(p.app.modules.richResourceResolver.activeObjectUrlCount, 0);
  assert.equal(p.app.modules.richResourceResolver.openImagePreview(host, 'images/diagram.svg', button), false);
  assert.equal(p.app.modules.richResourceResolver.openImagePreview(host, 'image\u0000https://attacker.invalid/x\u0000', button), false);
  const bytes = p.app.modules.richResourceResolver.activeObjectUrlBytes; assert.equal(p.escape(), true); assert.equal(root.querySelector('.tf-rich-image-preview'), null); assert.equal(root.activeElement, button);
  assert.equal(p.app.modules.richResourceResolver.activeObjectUrlBytes, bytes - Buffer.byteLength(ADAPTER_DIAGRAM));
  assert.equal(root.querySelectorAll('.tf-rich-owned-hint').length, 1); assert.equal(p.escape(), true); assert.equal(root.activeElement, hint); assert.equal(p.escape(), false); p.close();
});

for (const kind of ['missing', 'bad MIME', 'hostile SVG', 'stale']) test(`preview ${kind} preserves definition and exposes retry without accepting unsafe bytes`, async () => {
  const p = pipeline({ assets: () => { const result = response(); if (kind === 'missing') result.found = false; if (kind === 'bad MIME') result.mime = 'text/html'; if (kind === 'hostile SVG') result.safeSvg.root.attrs.onload = 'bad()'; if (kind === 'stale') result.packageVersion = 'changed'; return result; } });
  const host = p.render(makeOxfordAdapterRecord()); await settle(p); const root = host.shadowRoot;
  [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.viewIllustration').click(); await settle(p);
  assert.equal(root.querySelector('.tf-rich-image-preview svg'), null); assert.match(root.querySelector('.tf-rich-image-preview [role="status"]').textContent, /illustrationUnavailable/u);
  assert.match(root.querySelector('.tf-rich-viewer').textContent, /PANEL 0 SENTINEL/u); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlCount, 0); p.close();
});

test('POS change stops the actual active audio without auto-playing a new POS', async () => {
  const p = pipeline({ assets: (message) => message.path.endsWith('.wav') ? { ok: true, found: true, packageVersion: 'import-mdd-123e4567', kind: 'audio', mime: 'audio/wav', size: 1, base64: 'eA==' } : response() });
  const host = p.render(makeOxfordAdapterRecord()); await settle(p); const root = host.shadowRoot;
  root.querySelector('.o-pronunciation-set:not([hidden]) [data-action="load-mdd-audio"]').click(); await settle(p);
  assert.equal(root.querySelectorAll('audio').length, 1); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlCount, 1);
  root.querySelector('label[for="pos-1"]').click();
  assert.equal(root.querySelector('audio'), null); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlCount, 0);
  assert.equal(p.calls.filter((message) => message.path?.endsWith('.wav')).length, 1); p.close();
});

test('late illustration response after Escape or a replaced record never appends or charges the old scene', async () => {
  const p = pipeline({ assets: () => response(), defer: true }); const host = p.render(makeOxfordAdapterRecord()); await flush();
  p.pending[0].resolve(response()); await flush(); const root = host.shadowRoot;
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.viewIllustration'); button.click(); await flush();
  const pendingPreview = p.pending.at(-1), before = p.app.modules.richResourceResolver.activeObjectUrlBytes;
  assert.equal(p.escape(), true); pendingPreview.resolve(response()); await settle(p);
  assert.equal(root.querySelector('.tf-rich-image-preview'), null); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlBytes, before);
  button.click(); await flush(); const replaced = p.pending.at(-1);
  p.app.modules.selectionRichViewer.renderPlainText(host, 'NEW RECORD'); replaced.resolve(response()); await settle(p);
  assert.equal(host.shadowRoot.querySelector('.tf-rich-image-preview'), null); assert.equal(host.shadowRoot.querySelector('svg'), null);
  assert.equal(host.shadowRoot.querySelector('.tf-rich-viewer').textContent, 'NEW RECORD'); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlBytes, 0);
  assert.equal(p.calls.filter((message) => message.type === 'cancel').length, 2); p.close();
});

test('preview retry is explicit and a recovered resource is admitted only once', async () => {
  let available = false; const p = pipeline({ assets: () => available ? response() : { ok: true, found: false, packageVersion: 'import-mdd-123e4567' } });
  const host = p.render(makeOxfordAdapterRecord()); await settle(p); const root = host.shadowRoot;
  [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.viewIllustration').click(); await settle(p);
  assert.equal(root.querySelector('.tf-rich-image-preview svg'), null); available = true;
  [...root.querySelectorAll('.tf-rich-image-preview button')].find((node) => node.textContent === 'content.rich.retry').click(); await settle(p);
  assert.equal(root.querySelectorAll('.tf-rich-image-preview svg').length, 1); assert.equal(p.app.modules.richResourceResolver.activeObjectUrlBytes, Buffer.byteLength(ADAPTER_DIAGRAM)); p.close();
});

for (const kind of ['active bytes', 'image bytes', 'pixels']) test(`preview ${kind} budget rejection does not remove the body or leak charges`, async () => {
  const p = pipeline({ assets: () => response() }); const host = p.render(makeOxfordAdapterRecord()); await settle(p);
  const root = host.shadowRoot, viewport = root.querySelector('.tf-rich-viewer'); const button = [...root.querySelectorAll('button')].find((node) => node.textContent === 'content.rich.viewIllustration');
  const resource = { kind: 'image', path: 'images/diagram.svg', presentation: '' };
  const session = { container: host, viewport, resources: [resource], objectBytes: 0, imageBytes: 0, imagePixels: 0 };
  const limits = { maxActiveBytes: 65536, maxImageBytes: 65536, maxImagePixels: 1024 }; limits[{ 'active bytes': 'maxActiveBytes', 'image bytes': 'maxImageBytes', pixels: 'maxImagePixels' }[kind]] = 1;
  const manager = p.app.modules.richResourcePreview.create({ ...limits, isCurrent: () => true, scheduleRead: (_, action) => Promise.resolve().then(action),
    fetchAsset: async () => p.app.modules.richSvg.asset(response()), createTrackedUrl() { assert.fail('SVG cannot create Blob URLs'); }, revokeUrl() {}, cancelResourceRequest() {} });
  assert.equal(manager.open(session, p.app.modules.richResourcePath.descriptorKey('image', resource.path), button), true); await flush();
  assert.equal(root.querySelector('.tf-rich-image-preview svg'), null); assert.match(root.querySelector('.tf-rich-image-preview [role="status"]').textContent, /illustrationUnavailable/u);
  assert.equal(session.objectBytes, 0); assert.equal(session.imageBytes, 0); assert.equal(session.imagePixels, 0); manager.close(session); p.close();
});

test('hint metadata count and node admission stay bounded and optional ambiguity creates no owned hint', () => {
  const p = pipeline(); const original = makeOxfordAdapterRecord({ hints: false, illustration: false });
  const tips = Array.from({ length: 300 }, (_, index) => `<span class="o-symbol-wrap">${index}<span class="o-symbol-tip">TIP ${index}</span></span>`).join('');
  const host = p.render(original + tips); assert.equal([...host.shadowRoot.querySelectorAll('button')].filter((node) => node.textContent === 'content.rich.showHint').length, 256);
  const ambiguous = p.render(original + '<span class="o-symbol-wrap"><span class="o-symbol-tip">ONE</span><span class="o-symbol-tip">TWO</span></span>');
  assert.equal(ambiguous.shadowRoot.querySelector('.tf-rich-owned-action'), null); p.close();
});

function hintButton(host) { return [...host.shadowRoot.querySelectorAll('button')].find(node => node.textContent === 'content.rich.showHint'); }
function card(p, hosts) {
  const body = p.document.createElement('div'); body.className = 'tf-selection-rich-card-body'; p.document.body.append(body);
  for (const host of hosts) { host.classList.add('tf-selection-rich-text'); body.append(host); }
  return body;
}
function usage(hosts) {
  let nodes = 0, bytes = 0;
  for (const host of hosts) {
    const walker = host.ownerDocument.createTreeWalker(host.shadowRoot.querySelector('.tf-rich-viewer'), 0xffffffff);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) { nodes++; if (node.nodeType === 3) bytes += Buffer.byteLength(node.nodeValue); }
  }
  return { nodes, bytes };
}
function padNodes(p, host, hosts, target) {
  const filler = p.document.createElement('div'), fragment = p.document.createDocumentFragment();
  for (let count = usage(hosts).nodes + 1; count < target; count++) fragment.append(p.document.createTextNode(''));
  filler.append(fragment); host.shadowRoot.querySelector('.tf-rich-viewer').append(filler);
  assert.equal(usage(hosts).nodes, target); return filler;
}

test('two valid records whose aggregate metrics admit 32766 nodes cannot open an over-budget hint', () => {
  const p = pipeline(); const base = makeOxfordAdapterRecord(); const count = p.sanitize(base).metrics.nodes;
  const html = base + '<span></span>'.repeat(16383 - count);
  assert.equal(p.sanitize(html).metrics.nodes, 16383);
  const first = p.render(html), second = p.render(html); card(p, [first, second]);
  const before = usage([first, second]); hintButton(first).click();
  assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null); assert.deepEqual(usage([first, second]), before);
  p.close();
});

test('card-wide actual UTF-8 text near 2 MiB refuses a hint, then admits it after sibling text is removed', () => {
  const p = pipeline(), first = p.render(makeOxfordAdapterRecord()), second = p.render(makeOxfordAdapterRecord()); card(p, [first, second]);
  const padding = p.document.createTextNode('界'.repeat(Math.ceil((2 * 1024 * 1024 - usage([first, second]).bytes - 128) / 3)));
  second.shadowRoot.querySelector('.tf-rich-viewer').append(padding);
  assert.ok(usage([first, second]).bytes < 2 * 1024 * 1024);
  hintButton(first).click(); assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null);
  padding.remove(); hintButton(first).click(); assert.ok(first.shadowRoot.querySelector('.tf-rich-owned-hint')); p.close();
});

test('sibling hints count toward card nodes; toggling a hint closed at the limit restores admission', () => {
  const p = pipeline(), first = p.render(makeOxfordAdapterRecord()), second = p.render(makeOxfordAdapterRecord()); card(p, [first, second]);
  padNodes(p, second, [first, second], 32760);
  hintButton(second).click(); assert.ok(second.shadowRoot.querySelector('.tf-rich-owned-hint')); assert.equal(usage([first, second]).nodes, 32765);
  hintButton(first).click(); assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null);
  hintButton(second).click(); assert.equal(second.shadowRoot.querySelector('.tf-rich-owned-hint'), null); assert.equal(usage([first, second]).nodes, 32760);
  hintButton(first).click(); assert.ok(first.shadowRoot.querySelector('.tf-rich-owned-hint')); assert.ok(usage([first, second]).nodes <= 32768); p.close();
});

test('live sibling preview and SVG nodes are measured, and closing preview restores hint admission', async () => {
  const p = pipeline({ assets: () => response() }), first = p.render(makeOxfordAdapterRecord()), second = p.render(makeOxfordAdapterRecord()); card(p, [first, second]); await settle(p);
  [...second.shadowRoot.querySelectorAll('button')].find(node => node.textContent === 'content.rich.viewIllustration').click(); await settle(p);
  assert.ok(second.shadowRoot.querySelector('.tf-rich-image-preview svg path'));
  padNodes(p, second, [first, second], 32764);
  hintButton(first).click(); assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null);
  assert.equal(p.app.modules.richResourceResolver.closeImagePreview(second), true);
  hintButton(first).click(); assert.ok(first.shadowRoot.querySelector('.tf-rich-owned-hint')); assert.ok(usage([first, second]).nodes <= 32768); p.close();
});

test('host without a card body counts only its own viewport, and own hostile additions still stop admission', () => {
  const p = pipeline(), first = p.render(makeOxfordAdapterRecord()), second = p.render(makeOxfordAdapterRecord());
  padNodes(p, second, [second], 32768); hintButton(first).click(); assert.ok(first.shadowRoot.querySelector('.tf-rich-owned-hint'));
  hintButton(first).click(); assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null);
  padNodes(p, first, [first], 32764); hintButton(first).click(); assert.equal(first.shadowRoot.querySelector('.tf-rich-owned-hint'), null); p.close();
});
