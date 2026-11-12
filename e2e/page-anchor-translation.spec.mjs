import { test, expect } from './support/extension-fixture.mjs';

test.afterEach(async ({ harness: h }) => {
  await h.serviceWorker.evaluate(() => {
    globalThis.__anchorRelease?.();
    if (globalThis.__anchorFetch) fetch = __anchorFetch;
  });
});

for (const mode of ['unchanged', 'replace-anchor', 'hash-anchor', 'history-back', 'route-change', 'cancel'])
  test(`long page translation during ${mode}`, async ({ harness: h }, testInfo) => {
    await h.reset();
    const count = 120;
    h.server.setPage('/anchor-article', `<main>${Array.from({ length: count }, (_, i) => `<p id="p${i}">A distinct documentation paragraph numbered ${i} explains how form validation works.</p>`).join('')}</main>`);
    const page = await h.open('/anchor-article'); await h.inject(page);
    if (mode === 'history-back') await page.evaluate(() => history.pushState({}, '', '#start'));
    await h.serviceWorker.evaluate(() => {
      globalThis.__anchorFetch = fetch;
      globalThis.__anchorCalls = 0;
      const gate = new Promise(resolve => { globalThis.__anchorRelease = resolve; });
      globalThis.fetch = async (...args) => {
        if (String(args[0]).endsWith('/chat/completions') && ++__anchorCalls > 1) await gate;
        return __anchorFetch(...args);
      };
    });
    const pending = h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'anchor-page' });
    await expect.poll(() => h.serviceWorker.evaluate(() => __anchorCalls)).toBeGreaterThan(1);
    await expect(page.locator('.abt-translation')).toHaveCount(4);
    if (mode === 'cancel') await h.sendContent(page, 'TF_CANCEL_TASK', { taskId: 'anchor-page' });
    else if (mode === 'history-back') {
      await page.evaluate(() => new Promise(resolve => {
        addEventListener('popstate', resolve, { once: true }); history.back();
      }));
    } else if (mode !== 'unchanged') await page.evaluate(mode => {
      if (mode === 'hash-anchor') location.hash = 'p80';
      else history.replaceState({}, '', mode === 'route-change' ? '/other-article' : '#p80');
    }, mode);
    if (mode === 'hash-anchor') await expect(page).toHaveURL(/#p80$/);
    await h.serviceWorker.evaluate(() => __anchorRelease());
    const result = await pending;
    if (mode === 'route-change' || mode === 'cancel') {
      expect(result).toMatchObject({ ok: true, cancelled: true, task: { state: 'cancelled' } });
      await expect(page.locator('#p119 .abt-translation')).toHaveCount(0);
    } else {
      expect(result).toMatchObject({ ok: true, count, apiTranslated: count, missing: 0, task: { state: 'completed', done: count } });
      await expect(page.locator('.abt-translation')).toHaveCount(count);
      await expect(page.locator('#p119 .abt-translation')).toContainText('119');
      const calls = h.server.calls.length;
      await h.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
      expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: count, missing: 0 });
      expect(h.server.calls).toHaveLength(calls);
      await page.locator('#p119').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('translated-page-bottom.png') });
    }
    await page.close();
  });
