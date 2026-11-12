import { test, expect } from './support/extension-fixture.mjs';

test('course introductions, chapter controls and text containers translate without breaking their actions', async ({ harness: h }, testInfo) => {
  await h.reset();
  h.server.setPage('/course-scope', `<style>main { max-width:760px; margin:auto; padding:12px; } button { padding:12px; } reading-copy { display:block; margin:16px 0; }</style>
    <header><p>GLOBAL_BANNER is outside the course reading area.</p></header>
    <main><article><header><h2 id="title">Introduction to reliable graph workflows</h2>
      <p id="intro">Learn how to build reliable workflows using synthetic examples.</p></header>
      <section><header><h2 id="curriculum">The complete course curriculum</h2></header>
        <button id="chapter" aria-expanded="false" aria-controls="lessons"><h3>Module one introduces the workflow</h3></button>
        <div id="lessons" hidden><p id="lesson">This newly expanded lesson explains the first graph.</p></div>
      </section>
      <a id="enroll" href="/synthetic-enroll">Enroll in this course</a>
      <div id="summary">This leaf division contains <strong>readable course information</strong>.</div>
      <reading-copy id="custom">This custom element contains additional course information.</reading-copy>
      <p id="safe">Read <strong>the safe course material</strong><span style="display:none">HIDDEN_SECRET</span><span translate="no">PROTECTED_SECRET</span> carefully.</p>
      <nav><a href="/menu">NAVIGATION_ONLY must remain excluded.</a></nav>
      <textarea>INPUT_SECRET must remain excluded.</textarea>
      <pre><code>CODE_BLOCK must remain excluded.</code></pre>
    </article></main>`);
  const page = await h.open('/course-scope'); await h.inject(page);
  await page.evaluate(() => {
    globalThis.originalChapter = document.querySelector('#chapter'); globalThis.fixtureClicks = 0;
    originalChapter.addEventListener('click', () => {
      fixtureClicks++; originalChapter.setAttribute('aria-expanded', 'true'); document.querySelector('#lessons').hidden = false;
    });
    document.querySelector('#enroll').addEventListener('click', event => { event.preventDefault(); fixtureClicks++; });
  });
  expect(await h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'course-page' })).toMatchObject({ ok: true, count: 9, apiTranslated: 9, missing: 0 });
  for (const id of ['title', 'intro', 'curriculum', 'chapter', 'enroll', 'summary', 'custom'])
    await expect(page.locator(`#${id} > .abt-translation`)).toHaveCount(1);
  await expect(page.locator('#safe > .abt-translation')).toHaveCount(2);
  await expect(page.locator('#chapter h3 .abt-translation')).toHaveCount(0);
  expect(await page.locator('#chapter > .abt-translation').evaluate(el => getComputedStyle(el).display)).toBe('inline');
  await expect(page.locator('#enroll')).toHaveAttribute('href', '/synthetic-enroll');
  await page.locator('#enroll').click();
  expect(await page.evaluate(() => fixtureClicks)).toBe(1);
  expect(h.server.calls.flatMap(call => call.segments).some(item => /SECRET|GLOBAL_BANNER|NAVIGATION_ONLY|CODE_BLOCK/.test(item.text))).toBe(false);
  const calls = h.server.calls.length;
  await h.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ cacheHits: 9, missing: 0 });
  expect(h.server.calls).toHaveLength(calls);
  await h.sendContent(page, 'ABT_ENABLE_AUTO');
  await page.locator('#chapter').click();
  await expect(page.locator('#lesson > .abt-translation')).toHaveCount(1);
  expect(await page.evaluate(() => originalChapter === document.querySelector('#chapter') && fixtureClicks === 2)).toBe(true);
  await expect(page.locator('#chapter')).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 390, height: 820 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('translated-course.png'), fullPage: true });
  await h.sendContent(page, 'ABT_DISABLE_AUTO'); await page.close();
});

test('automatic discovery notices expanded content while restore-only expansion never sends a cache miss', async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/course-expansion', `<main><p id="initial">This initial course paragraph is already visible.</p>
    <section id="panel" hidden><p id="revealed">A newly revealed lesson becomes readable after expansion.</p></section>
    <section id="uncached" hidden><p>A separate uncached lesson must remain a cache-only miss.</p></section></main>`);
  const page = await h.open('/course-expansion'); await h.inject(page);
  await h.sendContent(page, 'ABT_ENABLE_AUTO');
  await expect(page.locator('#initial > .abt-translation')).toHaveCount(1);
  await page.evaluate(() => { document.querySelector('#panel').hidden = false; });
  await expect(page.locator('#revealed > .abt-translation')).toHaveCount(1);
  await h.sendContent(page, 'ABT_DISABLE_AUTO');
  await h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'course-restore-mode' });
  const calls = h.server.calls.length;
  await page.evaluate(() => { document.querySelector('#uncached').hidden = false; });
  expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ missing: 1 });
  await expect(page.locator('#uncached .abt-translation')).toHaveCount(0);
  expect(h.server.calls).toHaveLength(calls);
  await page.close();
});
