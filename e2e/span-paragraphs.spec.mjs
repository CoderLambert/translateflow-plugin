import { test, expect } from './support/extension-fixture.mjs';

test('plain and marked spans translate once with links, code and cache restoration intact', async ({ harness: h }, testInfo) => {
  await h.reset();
  h.server.setPage('/span-article', `<style>main > span:not([hidden]), [data-as=p] { display:block; margin:16px 0; } main { max-width:760px; margin:auto; }</style>
    <main><h1>Guide</h1>
    <span id="intro">This plain span describes the workflow runtime and its shared state.</span>
    <span id="links">Read the <a href="/guide"><span>complete workflow documentation</span></a> before building a graph.</span>
    <span id="code" data-as="p">Call <code>run_graph()</code> to execute a graph with <strong>persistent state</strong>.</span>
    <div id="marked-div" data-as="p">A marked division also represents a complete documentation paragraph.</div>
    <span><p id="card">This regular paragraph describes how the documentation examples work.</p></span>
    <ul><li id="list"><span>This list item explains the first execution capability.</span></li></ul>
    <blockquote><span id="quote" data-as="p">This quoted paragraph explains another execution capability.</span></blockquote>
    <p id="nested">This paragraph <span>contains nested inline text</span> which must remain in the same translation.</p>
    <nav><span>Navigation should not be sent to the translation provider.</span></nav>
    <pre><code><span>Code blocks should not be sent to the translation provider.</span></code></pre>
    <div contenteditable="true"><span>Editable text should not be sent to the translation provider.</span></div>
    <span hidden>Hidden text should not be sent to the translation provider.</span>
    </main>`);
  const page = await h.open('/span-article'); await h.inject(page);
  await expect(page.locator('main > span[hidden]')).toBeHidden();
  const result = await h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'span-article' });
  expect(result).toMatchObject({ ok: true, apiTranslated: 9, count: 9, missing: 0, task: { state: 'completed' } });
  for (const id of ['intro', 'links', 'code', 'marked-div', 'card', 'list', 'quote', 'nested'])
    await expect(page.locator(`#${id} > .abt-translation`)).toHaveCount(1);
  await expect(page.locator('.abt-translation')).toHaveCount(9);
  await expect(page.locator('#links > .abt-translation a')).toHaveAttribute('href', '/guide');
  await expect(page.locator('#code > .abt-translation code')).toHaveText('run_graph()');
  const sent = h.server.calls.flatMap(call => call.segments);
  expect(sent).toHaveLength(9);
  expect(sent.some(item => /should not be sent/.test(item.text))).toBe(false);
  const calls = h.server.calls.length;
  await h.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: 9, missing: 0 });
  expect(h.server.calls).toHaveLength(calls);
  await page.evaluate(() => {
    const old = document.querySelector('#intro'), replacement = old.cloneNode(true);
    replacement.querySelector('.abt-translation').remove(); replacement.removeAttribute('data-abt-translated');
    old.replaceWith(replacement);
  });
  await expect(page.locator('#intro > .abt-translation')).toHaveCount(1);
  expect(h.server.calls).toHaveLength(calls);
  await page.screenshot({ path: testInfo.outputPath('translated-span-paragraphs.png'), fullPage: true });
  await page.close();
});

test('automatic translation discovers plain spans and updates the owning paragraph after inline span mutations', async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/dynamic-spans', `<style>main > span { display:block; }</style><main>
    <p id="parent">Original paragraph: <span id="inline">the initial inline content explains the first workflow.</span></p>
    <span id="plain">This independent span explains a second workflow.</span>
    </main>`);
  const page = await h.open('/dynamic-spans'); await h.inject(page);
  expect(await h.sendContent(page, 'ABT_ENABLE_AUTO')).toMatchObject({ ok: true });
  await expect(page.locator('#parent > .abt-translation')).toHaveCount(1);
  await expect(page.locator('#plain > .abt-translation')).toHaveCount(1);
  await page.evaluate(() => {
    const span = document.createElement('span'); span.id = 'new-span';
    span.textContent = 'A newly loaded ordinary span explains an additional workflow.';
    document.querySelector('main').appendChild(span);
  });
  await expect(page.locator('#new-span > .abt-translation')).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('#inline').firstChild.nodeValue = 'updated inline characters explain the next workflow.'; });
  await expect(page.locator('#parent > .abt-translation')).toContainText('updated inline characters');
  await page.evaluate(() => { document.querySelector('#inline').textContent = 'replacement inline children explain the final workflow.'; });
  await expect(page.locator('#parent > .abt-translation')).toContainText('replacement inline children');
  await expect(page.locator('#inline .abt-translation')).toHaveCount(0);
  await expect(page.locator('.abt-translation')).toHaveCount(3);
  await h.sendContent(page, 'ABT_DISABLE_AUTO');
  await page.close();
});
