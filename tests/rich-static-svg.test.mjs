import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { parseSafeSvg, validateSafeSvgScene, extractSafeSvg } from "../src/shared/safe-svg.js";
import { buildMddIndex, lookupMddResource, MDD_IMPORT_LIMITS } from "../src/background/packs/importers/mdd.js";
import { classifyMddResource } from "../src/background/packs/importers/mdd-resource-policy.js";
import { makeMdd } from "./helpers/mdd-fixture.mjs";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><g transform="translate(1 2) rotate(15 12 12)"><path d="M2 2 L8 2 L8 8 Z"/><polygon points="10,10 12,14 14,10" fill="#123456"/><circle cx="12" cy="12" r="2" stroke="black" stroke-width="1"/></g></svg>';
const pure = { parseSafeSvg, validateSafeSvgScene, extractSafeSvg };

test("closed static scene parser and DTO roundtrip preserve bounded geometric elements", () => {
  const result = parseSafeSvg(svg);
  assert.equal(result.nodes, 5); assert.equal(result.width, 24); assert.equal(result.height, 24);
  assert.deepEqual(validateSafeSvgScene(structuredClone(result.scene)), result);
  assert.deepEqual(extractSafeSvg(`before${svg}after`, 6).scene, result.scene);
  assert.equal(extractSafeSvg(`<svg/>${svg}`, 0).end, 6);
  assert.equal(parseSafeSvg(`<?xml version="1.0" encoding="UTF-8"?>${svg}`).nodes, 5);
});

for (const unsafe of [
  '<script>alert(1)</script>', '<foreignObject><p>html</p></foreignObject>', '<style>svg{fill:red}</style>',
  '<use href="#x"/>', '<image href="https://attacker.invalid/a"/>', '<animate attributeName="fill"/>',
  '<filter/>', '<linearGradient/>', '<path d="M0 0L1 1" onclick="alert(1)"/>',
  '<path d="M0 0L1 1" fill="url(#x)"/>', '<path d="M0 0L1 1" style="fill:red"/>',
  '<circle r="1" transform="scale(100000)"/>', '<svg viewBox="0 0 1 1"/>', '<path d="L0 0"/>',
  '<path d="M0 0A1 1 0 2 0 2 2"/>', '<polygon points="0 0 1 1 2"/>', '<circle r="Infinity"/>',
  '<circle r="1" r="2"/>', '<circle r="1" href="javascript:alert(1)"/>'
]) test(`static SVG rejects ${unsafe.split(/[ >]/u)[0]}`, () => {
  assert.equal(parseSafeSvg(`<svg viewBox="0 0 24 24">${unsafe}</svg>`), null);
  assert.throws(() => classifyMddResource("icons/unsafe.svg", Buffer.from(`<svg>${unsafe}</svg>`), MDD_IMPORT_LIMITS));
});

test("entities, source, global attributes, geometry, depth and node budgets reject whole scenes", () => {
  assert.equal(parseSafeSvg('<!DOCTYPE svg [<!ENTITY a "abc">]><svg>&a;</svg>'), null);
  assert.equal(parseSafeSvg('<svg fill="&#114;ed"/>'), null);
  assert.equal(parseSafeSvg(`<svg>${' '.repeat(65536)}</svg>`), null);
  assert.equal(parseSafeSvg(`<svg>${'<g>'.repeat(8)}${'</g>'.repeat(8)}</svg>`), null);
  assert.equal(parseSafeSvg(`<svg>${'<circle r="1"/>'.repeat(128)}</svg>`), null);
  const long = 'M0 0' + 'L1 1'.repeat(1400);
  assert.equal(parseSafeSvg(`<svg><path d="${long}"/></svg>`), null);
  // Each attribute is individually below 4KiB; their scene total is not.
  const transforms = 'translate(0 0) '.repeat(90).trim();
  assert.equal(parseSafeSvg(`<svg>${Array.from({ length: 4 }, () => `<g transform="${transforms}"/>`).join('')}</svg>`), null);
  const dto = parseSafeSvg(svg).scene;
  dto.root.attrs.onclick = 'alert(1)'; assert.equal(validateSafeSvgScene(dto), null);
});

test("real MDD index lookup classifies SVG to safe scene with canonical dimensions", async () => {
  const bytes = makeMdd([["icons/static.svg", Buffer.from(svg)]]);
  const source = { size: bytes.length, async read(offset, size) { return bytes.subarray(offset, offset + size); } };
  const index = await buildMddIndex({ source });
  const result = await lookupMddResource({ source, index, path: "icons/static.svg" });
  assert.equal(result.found, true); assert.equal(result.kind, "image"); assert.equal(result.mime, "image/svg+xml");
  assert.deepEqual(result.safeSvg, parseSafeSvg(svg).scene);
  assert.deepEqual(result.dimensions, { width: 24, height: 24 });
});

function harness(response) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid/' });
  const document = dom.window.document;
  const calls = [];
  const app = { modules: { safeSvg: pure, contentI18n: createContentI18nStub(), runtime: {
    messages: { background: { RICH_MDD_RESOURCE: 'read', RICH_MDD_RESOURCE_READ_CANCEL: 'cancel' } },
    sendRuntimeMessage(message) { calls.push(message); return message.type === 'cancel' ? Promise.resolve({ ok: true }) : Promise.resolve(typeof response === 'function' ? response(message) : response); }
  } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, TextEncoder, TextDecoder, Uint8Array, Blob, URL, atob,
    HTMLButtonElement: dom.window.HTMLButtonElement });
  for (const file of ['rich-controls', 'rich-sanitizer-tags', 'rich-sanitizer-style', 'rich-resource-path', 'rich-svg',
    'rich-sanitizer-tokenizer', 'rich-sanitizer', 'rich-resource-media', 'rich-resource-fonts', 'rich-resource-encoding', 'rich-resource-resolver', 'rich-viewer']) {
    vm.runInContext(readFileSync(new URL(`../src/content/selection/${file}.js`, import.meta.url), 'utf8'), context);
  }
  const container = document.createElement('div'); document.body.append(container);
  return { app, document, container, calls, resolver: app.modules.richResourceResolver, dom };
}
const svgResponse = () => ({ ok: true, found: true, path: 'icons/static.svg', packageVersion: 'v1', kind: 'image', mime: 'image/svg+xml',
  safeSvg: parseSafeSvg(svg).scene, size: Buffer.byteLength(svg), width: 24, height: 24 });
async function settle(h) {
  for (let step = 0; step < 100; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    if (!h.resolver.runningReadCount && !h.resolver.pendingReadCount) return;
  }
  assert.fail('resource queue did not settle');
}

test("inline sanitizer counts all scene nodes and viewer reconstructs SVG namespaces without source attrs", () => {
  const h = harness();
  const ast = h.app.modules.selectionRichSanitizer.sanitizeRichDictionaryRecord({ rawRecord: `<p>BODY${svg}</p><svg><script>bad()</script></svg>`, format: 'HTML' });
  assert.equal(ast.metrics.nodes, 7);
  h.app.modules.selectionRichViewer.render(h.container, ast, 'BODY');
  const root = h.container.shadowRoot;
  assert.equal(root.querySelectorAll('svg').length, 1);
  assert.equal(root.querySelector('path').namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(root.querySelector('svg').getAttribute('fill'), 'currentColor');
  assert.equal(root.querySelectorAll('script,style:not(:first-child),use,image').length, 0);
  assert.equal(root.textContent.includes('bad()'), false);
  const malicious = structuredClone(ast); malicious.nodes[0].children[1].scene.root.attrs.href = 'https://attacker.invalid/';
  h.app.modules.selectionRichViewer.render(h.container, malicious, 'BODY');
  assert.equal(h.container.shadowRoot.querySelector('svg'), null);
});

test("MDD resource DTO revalidation creates native scene and charges/releases bytes and pixels without Blob URLs", async () => {
  const h = harness(svgResponse());
  const ast = h.app.modules.selectionRichSanitizer.sanitizeRichDictionaryRecord({ rawRecord: '<p>BODY<img src="icons/static.svg"></p>', format: 'HTML' });
  h.app.modules.selectionRichViewer.render(h.container, ast, 'BODY', { dictionaryId: 'fixture', packageVersion: 'v1' });
  await settle(h);
  assert.equal(h.container.shadowRoot.querySelectorAll('svg').length, 1);
  assert.equal(h.resolver.activeObjectUrlCount, 0);
  assert.equal(h.resolver.activeObjectUrlBytes, Buffer.byteLength(svg));
  assert.equal(h.resolver.activeImagePixelCount, 24 * 24);
  assert.equal(h.calls[0].ownerToken.length, 32);
  h.resolver.close(h.container);
  assert.equal(h.resolver.activeObjectUrlBytes, 0); assert.equal(h.resolver.activeImagePixelCount, 0);
});

for (const kind of ['stale', 'malformed', 'raw', 'overflow']) test(`SVG resource ${kind} keeps placeholder and source-free DOM`, async () => {
  const response = svgResponse();
  if (kind === 'stale') response.packageVersion = 'v2';
  if (kind === 'malformed') response.safeSvg.root.attrs.onload = 'bad()';
  if (kind === 'raw') response.base64 = Buffer.from(svg).toString('base64');
  if (kind === 'overflow') response.size = 65537;
  const h = harness(response);
  h.app.modules.selectionRichViewer.render(h.container, { nodes: [{ type: 'resource', kind: 'image', path: 'icons/static.svg' }] }, 'BODY', { dictionaryId: 'fixture', packageVersion: 'v1' });
  await settle(h);
  assert.equal(h.container.shadowRoot.querySelector('svg'), null);
  assert.equal(h.container.shadowRoot.querySelectorAll('[data-rich-resource-kind="image"]').length, 1);
  assert.equal(h.resolver.activeObjectUrlBytes, 0);
});

test("closed and replaced SVG viewer never appends deferred resource to current Shadow DOM", async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }));
  h.app.modules.selectionRichViewer.render(h.container, { nodes: [{ type: 'resource', kind: 'image', path: 'icons/static.svg' }] }, 'OLD', { dictionaryId: 'fixture', packageVersion: 'v1' });
  await new Promise((resolve) => setImmediate(resolve));
  h.app.modules.selectionRichViewer.renderPlainText(h.container, 'NEW GENERATION');
  finish(svgResponse()); await settle(h);
  assert.equal(h.container.shadowRoot.querySelector('svg'), null);
  assert.equal(h.container.shadowRoot.querySelector('.tf-rich-viewer').textContent, 'NEW GENERATION');
  assert.equal(h.calls.filter((call) => call.type === 'cancel').length, 1);
});

test("scene expansion applies the existing viewer node budget across all records of one card", async () => {
  const many = '<svg viewBox="0 0 24 24">' + '<circle r="1"/>'.repeat(127) + '</svg>';
  const response = { ...svgResponse(), safeSvg: parseSafeSvg(many).scene, size: Buffer.byteLength(many) };
  const h = harness(response);
  const body = h.document.createElement('div'); body.className = 'tf-selection-rich-card-body'; h.document.body.append(body);
  const hosts = [h.container, h.document.createElement('div')];
  for (const host of hosts) {
    host.className = 'tf-selection-rich-text'; body.append(host);
    const nodes = [...Array.from({ length: 15000 }, () => ({ type: 'text', text: 'x' })),
      ...Array.from({ length: 20 }, () => ({ type: 'resource', kind: 'image', path: 'icons/static.svg' }))];
    h.app.modules.selectionRichViewer.render(host, { nodes }, 'BODY', { dictionaryId: 'fixture', packageVersion: 'v1' });
  }
  await settle(h);
  assert.equal(hosts[0].shadowRoot.querySelectorAll('svg').length, 20);
  assert.equal(hosts[1].shadowRoot.querySelectorAll('svg').length, 0);
  assert.equal(hosts[1].shadowRoot.querySelectorAll('[data-rich-resource-kind="image"]').length, 20);
  h.resolver.closeAll();
});

for (const budget of ['active', 'images', 'pixels']) test(`SVG ${budget} capacity rejects admission atomically without removing text`, async () => {
  const h = harness();
  const node = h.document.createElement('span'); h.container.append(node);
  const session = { container: h.container, viewport: h.container, resources: [], objectBytes: 0, imageBytes: 0, imagePixels: 0 };
  const resource = { kind: 'image', label: 'ICON', instances: [{ element: node }] }; session.resources.push(resource);
  const limits = { maxActiveBytes: 65536, maxImageBytes: 65536, maxImagePixels: 1000 };
  limits[{ active: 'maxActiveBytes', images: 'maxImageBytes', pixels: 'maxImagePixels' }[budget]] = 1;
  const loader = h.app.modules.richSvg.create({ ...limits, isCurrent: () => true,
    scheduleRead: async (_, action) => action(), fetchAsset: async () => h.app.modules.richSvg.asset(svgResponse()) });
  await loader.load(session, resource);
  assert.equal(h.container.querySelector('svg'), null); assert.equal(node.parentNode, h.container);
  assert.equal(session.objectBytes, 0); assert.equal(session.imageBytes, 0); assert.equal(session.imagePixels, 0);
});

test("package uninstall replaces rendered SVG resources and clears charges", async () => {
  const h = harness(svgResponse());
  h.app.modules.selectionRichViewer.render(h.container, { nodes: [{ type: 'resource', kind: 'image', path: 'icons/static.svg' }] }, 'BODY', { dictionaryId: 'fixture', packageVersion: 'v1' });
  await settle(h); assert.equal(h.container.shadowRoot.querySelectorAll('svg').length, 1);
  h.resolver.closeDictionary('fixture');
  assert.equal(h.container.shadowRoot.querySelector('svg'), null);
  assert.equal(h.container.shadowRoot.querySelectorAll('[data-rich-resource-kind="image"]').length, 1);
  assert.equal(h.resolver.activeObjectUrlBytes, 0);
});

test("SVG CSS background slots degrade to none while unrelated body/state CSS is retained", async () => {
  const h = harness((request) => request.path === 'style.css' ? { ok: true, found: true, packageVersion: 'v1', kind: 'stylesheet', mime: 'text/css', size: 1, base64: 'eA==',
    safeCss: '.panel{background-image:tfasset0;color:red}', assetSlots: [{ token: 'tfasset0', kind: 'image', path: 'icons/static.svg' }] } : svgResponse());
  h.app.modules.selectionRichViewer.render(h.container, { nodes: [{ type: 'resource', kind: 'stylesheet', path: 'style.css' }] }, 'BODY', { dictionaryId: 'fixture', packageVersion: 'v1' });
  await settle(h);
  const styles = [...h.container.shadowRoot.querySelectorAll('style')].map((node) => node.textContent);
  assert.equal(styles.some((css) => css === '.panel{background-image:none;color:red}'), true);
  assert.equal(h.calls.some((call) => call.path === 'icons/static.svg'), false, 'unsupported CSS SVG does not consume a read or discard body CSS');
  assert.equal(h.resolver.activeObjectUrlCount, 0);
});

test("legacy renderer metrics count scene descendants before accepting a multi-record aggregate", () => {
  const h = harness();
  const scene = parseSafeSvg('<svg>' + '<circle r="1"/>'.repeat(127) + '</svg>').scene;
  h.app.modules.selectionRichSanitizer = { sanitizeRichDictionaryRecord: () => ({ nodes: Array.from({ length: 130 }, () => ({ type: 'svg', scene })) }) };
  vm.runInContext(readFileSync(new URL('../src/content/selection/rich-result-renderer.js', import.meta.url), 'utf8'), vm.createContext({ __TRANSLATE_FLOW_CONTENT__: h.app, document: h.document, TextEncoder }));
  const record = { text: 'BODY', richRecord: { rawRecord: 'BODY', format: 'HTML' } };
  assert.throws(() => h.app.modules.selectionRichResultRenderer.appendRichDictionaryDetails(h.container, { dictionaries: [{ id: 'fixture', records: [record, record] }] }), /aggregate display/u);
  assert.equal(h.container.querySelectorAll('.tf-selection-rich-text').length, 0);
});
