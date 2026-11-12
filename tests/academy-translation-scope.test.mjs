import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const sources = await Promise.all(['runtime', 'structured', 'page-policy', 'page-units', 'page-discovery', 'dom', 'batch'].map(name =>
  readFile(new URL(`../src/content/${name}.js`, import.meta.url), 'utf8')));
function environment(t, html) {
  const env = new JSDOM(`<!doctype html><style>* { opacity: 1; }</style>${html}`,
    { runScripts: 'outside-only', url: 'https://fixture.invalid/course' });
  t.after(() => env.window.close());
  env.window.Element.prototype.getBoundingClientRect = function () {
    return { width: this.closest('[hidden]') ? 0 : 640, height: this.closest('[hidden]') ? 0 : 24 };
  };
  for (const source of sources) env.window.eval(source);
  return { document: env.window.document, ...env.window.__TRANSLATE_FLOW_CONTENT__.modules };
}
const ids = dom => Array.from(dom.collectElements(), el => el.id);

test('course introductions inside content headers remain readable while site banners are excluded', t => {
  const { dom } = environment(t, `<header><p id="banner">This global banner is outside the reading content.</p></header>
    <main><article><header><h2 id="title">Introduction to a synthetic workflow course</h2>
      <p id="intro">Learn the basics of building reliable graph workflows.</p></header></article>
      <header role="banner"><p>Explicit site chrome remains excluded.</p></header></main>`);
  assert.deepEqual(ids(dom), ['title', 'intro']);
});

test('buttons, independent links and generic readable blocks join the same candidate discovery', t => {
  const { dom } = environment(t, `<main><section>
    <button id="chapter" aria-expanded="false"><h3>Module one introduces a synthetic workflow</h3></button>
    <a id="enroll" href="/join">Enroll in this course</a>
    <div id="summary">A leaf division contains a complete sentence.</div>
    <reading-copy id="custom">A custom element contains another complete sentence.</reading-copy>
    <p id="paragraph">Read <a href="/guide">the guide</a> and <span>its examples</span> together.</p>
  </section></main>`);
  assert.deepEqual(ids(dom), ['chapter', 'enroll', 'summary', 'custom', 'paragraph']);
});

test('block containers are not collected as one translation and inline text retains its enclosing owner', t => {
  const { dom, document } = environment(t, `<main><div id="layout">
    <div id="first">The first readable <span id="inline">inline phrase</span> belongs to one block.</div>
    <div id="second">The second readable text belongs to a separate block.</div>
  </div></main>`);
  assert.deepEqual(ids(dom), ['first', 'second']);
  assert.equal(dom.findCandidateElement(document.querySelector('#inline')).id, 'first');
});

test('generic discovery and rich serialization do not collect protected content', t => {
  const { dom, batch } = environment(t, `<main>
    <p id="safe">Read <strong>the safe documentation</strong><script>privateScriptText()</script><style>.private-style { color:red }</style><span hidden>HIDDEN_SECRET</span><span style="display:none">CSS_SECRET</span><span translate="no">UNTRANSLATED_SECRET</span> carefully.</p>
    <textarea>Input text must never be collected.</textarea><input value="Private input value">
    <div contenteditable="plaintext-only">Editable prose must not enter the request.</div>
    <div translate="no">Explicitly protected prose must not enter the request.</div>
    <div class="notranslate">Protected prose must not enter the request.</div>
    <nav><a href="/menu">Navigation text stays excluded.</a></nav>
    <footer><div>Footer text stays excluded.</div></footer>
    <div data-tf-extension-ui><div>Extension text stays excluded.</div></div>
    <pre><code>Do not translate source code blocks.</code></pre>
    <div hidden>Hidden text stays excluded.</div>
  </main>`);
  assert.deepEqual(ids(dom), ['safe']);
  const entries = batch.buildEntries(dom.collectUnits());
  assert.equal(entries.length, 2);
  assert.doesNotMatch(entries.map(entry => entry.text).join(" "), /SECRET|privateScript|private-style/);
});

test('control translation preserves nodes, event handlers and navigation attributes', t => {
  const { dom, document } = environment(t, `<main><button id="chapter" aria-expanded="false">Open the first chapter</button>
    <a id="enroll" href="/join">Enroll in this course</a></main>`);
  const button = document.querySelector('#chapter'), link = document.querySelector('#enroll');
  let clicks = 0; button.addEventListener('click', () => { clicks++; button.setAttribute('aria-expanded', 'true'); });
  dom.insertTranslation(button, '打开第一章节'); dom.insertTranslation(link, '报名此课程');
  button.click();
  assert.equal(clicks, 1); assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(link.getAttribute('href'), '/join');
  assert.equal(button.querySelectorAll('.abt-translation').length, 1);
  assert.ok(button.querySelector('.abt-translation').classList.contains('abt-translation-inline'));
  dom.clearTranslations();
  assert.equal(button.textContent, 'Open the first chapter');
  assert.equal(document.querySelector('#chapter'), button);
});
