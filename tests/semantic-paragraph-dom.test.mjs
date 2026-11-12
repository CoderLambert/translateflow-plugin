import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sources = await Promise.all(['runtime', 'structured', 'page-policy', 'page-units', 'page-discovery', 'dom', 'batch'].map(name =>
  readFile(new URL(`../src/content/${name}.js`, import.meta.url), 'utf8')));
function environment(t, html) {
  const env = new JSDOM(`<!doctype html><style>* { opacity: 1; }</style><main>${html}</main>`,
    { runScripts: 'outside-only', url: 'https://fixture.invalid/docs' });
  t.after(() => env.window.close());
  // JSDOM has no layout; extraction and candidate filtering are the real modules.
  env.window.Element.prototype.getBoundingClientRect = () => ({ width: 640, height: 24 });
  for (const source of sources) env.window.eval(source);
  return { document: env.window.document, ...env.window.__TRANSLATE_FLOW_CONTENT__.modules };
}
const ids = dom => Array.from(dom.collectElements(), el => el.id);

test('collects plain spans and explicitly marked paragraphs alongside ordinary paragraphs', t => {
  const { dom, batch } = environment(t, `<div id="container">
    <span id="intro" data-as="p">This synthetic introduction describes a workflow.</span>
    <div id="detail" data-as="p">This synthetic detail describes another workflow.</div>
    <p id="ordinary">An ordinary documentation paragraph remains available.</p>
    <span id="plain">An ordinary span also contains documentation text.</span>
  </div>`);
  assert.deepEqual(ids(dom), ['intro', 'detail', 'ordinary', 'plain']);
  assert.equal(batch.buildEntries(dom.collectUnits()).length, 4);
});

test('inline spans belong to the containing paragraph, heading, list item or outer span', t => {
  const { dom, document } = environment(t, `<p id="paragraph">A complete <span>sentence with <span id="inner">nested emphasis</span></span> stays together.</p>
    <h2 id="heading"><span>A complete heading stays together.</span></h2>
    <ul><li id="item"><span>A list item stays together.</span></li></ul>
    <blockquote id="block"><span>A quotation stays together.</span></blockquote>
    <span id="span">A standalone <span>nested span</span> remains one text block.</span>`);
  assert.deepEqual(ids(dom), ['paragraph', 'heading', 'item', 'block', 'span']);
  assert.equal(dom.findCandidateElement(document.querySelector('#inner')).id, 'paragraph');
  assert.equal(dom.findCandidateElement(document.querySelector('#span')).id, 'span');
});

test('semantic paragraphs inside lists and quotes are translated once, as are nested paragraph markers', t => {
  const { dom } = environment(t, `<ul><li id="list"><span id="list-text" data-as="p">The list contains a full explanatory paragraph.</span></li></ul>
    <blockquote id="quote"><span id="quote-text" data-as="p">The quotation contains another explanatory paragraph.</span></blockquote>
    <p id="outer">A surrounding paragraph <span data-as="p">contains a marked fragment</span> and trailing text.</p>
    <span id="marked-outer" data-as="p">An outer marked paragraph <span data-as="p">contains another marked fragment.</span></span>`);
  assert.deepEqual(ids(dom), ['list', 'quote', 'outer', 'marked-outer']);
});

test('a span wrapping native block paragraphs leaves their paragraph boundaries intact', t => {
  const { dom } = environment(t, `<span id="wrapper"><p id="first">A complete first paragraph belongs to its own block.</p>
    <p id="second">A complete second paragraph belongs to a separate block.</p></span>`);
  assert.deepEqual(ids(dom), ['first', 'second']);
});

for (const marker of ['', 'data-as="p"']) test(`spans keep code, navigation, editable, hidden and extension UI exclusions (${marker || 'plain'})`, t => {
  const { dom } = environment(t, `<span id="allowed" ${marker}>This visible article paragraph is eligible.</span>
    <nav><span ${marker}>Navigation content must not enter translation.</span></nav>
    <header role="banner"><span ${marker}>Site banner content must not enter translation.</span></header>
    <pre><span ${marker}>Code blocks must not enter translation.</span></pre>
    <code><span ${marker}>Standalone code must not enter translation.</span></code>
    <div contenteditable="plaintext-only"><span ${marker}>Editable text must not enter translation.</span></div>
    <div contenteditable="true"><span ${marker}>Editable content must not enter translation.</span></div>
    <div data-tf-extension-ui><span ${marker}>Extension controls must not enter translation.</span></div>
    <span ${marker} class="abt-translation">Existing translated content must not be translated.</span>
    <span ${marker} style="display:none">Hidden content must not enter translation.</span>`);
  assert.deepEqual(ids(dom), ['allowed']);
});

for (const marker of ['', 'data-as="p"']) test(`span translation preserves links and code, avoids duplicates and remains removable (${marker || 'plain'})`, t => {
  const { dom, document } = environment(t, `<span id="rich" ${marker}>Read the <a href="/guide">workflow guide</a> and use <code>run_graph()</code> safely.</span>`);
  const el = dom.collectElements()[0];
  assert.ok(el, 'the rich semantic paragraph must be selected');
  const original = el.innerHTML;
  const source = dom.extractSourceSegment(el);
  assert.equal(source.rich, true);
  assert.equal(dom.insertTranslation(el, `译文：${source.text}`), true);
  assert.equal(dom.insertTranslation(el, 'duplicate'), false);
  assert.equal(document.querySelectorAll('.abt-translation').length, 1);
  assert.equal(el.querySelector('.abt-translation a').getAttribute('href'), '/guide');
  assert.equal(el.querySelector('.abt-translation code').textContent, 'run_graph()');
  assert.equal(dom.extractSourceSegment(el).text, source.text);
  assert.deepEqual(ids(dom), ['rich']);
  dom.clearTranslations();
  assert.equal(el.innerHTML, original);
});
