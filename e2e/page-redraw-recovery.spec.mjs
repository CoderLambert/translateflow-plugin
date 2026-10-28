import { test, expect } from './support/extension-fixture.mjs';

test.afterEach(async ({ harness: h }) => {
  await h.serviceWorker.evaluate(() => {
    globalThis.__redrawRelease?.();
    if (globalThis.__redrawFetch) fetch = __redrawFetch;
  });
});

for (const mode of ['same-source', 'cached-source', 'changed-source', 'cancelled']) test(`page redraw during translation retains only current results: ${mode}`, async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/redraw', `<main>${Array.from({ length: 20 }, (_, i) => `<p id="p${i}">A distinct complete source paragraph numbered ${i} for redraw recovery.</p>`).join('')}</main>`);
  await h.serviceWorker.evaluate(() => {
    globalThis.__redrawFetch = fetch; globalThis.__redrawCalls = 0; globalThis.__redrawPending = false;
    globalThis.fetch = async (...args) => {
      if (String(args[0]).endsWith('/chat/completions') && ++__redrawCalls === 2) {
        __redrawPending = true;
        await new Promise(resolve => { globalThis.__redrawRelease = resolve; });
      }
      return __redrawFetch(...args);
    };
  });
  const page = await h.open('/redraw'); await h.inject(page);
  const html = await page.locator('main').innerHTML();
  if (mode === 'cached-source') {
    await page.locator('#p18, #p19').evaluateAll(nodes => nodes.forEach(node => node.remove()));
    expect(await h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'prime-cache' })).toMatchObject({ apiTranslated: 18 });
    await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, html);
  }
  const pending = h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'redraw' });
  await expect.poll(() => h.serviceWorker.evaluate(() => __redrawPending)).toBe(true);
  await expect(page.locator('.abt-translation')).toHaveCount(18);
  await page.locator('main').evaluate((main, html) => { main.innerHTML = html; }, html);
  if (mode === 'changed-source') await page.locator('#p0').evaluate(p => { p.textContent = 'This is a different source that has never been requested.'; });
  if (mode === 'cancelled') await h.sendContent(page, 'TF_CANCEL_TASK', { taskId: 'redraw' });
  await h.serviceWorker.evaluate(() => __redrawRelease());
  const result = await pending;
  if (mode === 'cancelled') {
    expect(result).toMatchObject({ ok: true, cancelled: true });
    await expect(page.locator('.abt-translation')).toHaveCount(0);
  } else {
    const count = mode === 'changed-source' ? 19 : 20;
    expect(result).toMatchObject({ ok: true, count, apiTranslated: mode === 'cached-source' ? 2 : count,
      cacheHits: mode === 'cached-source' ? 18 : 0, missing: mode === 'changed-source' ? 1 : 0 });
    await expect(page.locator('.abt-translation')).toHaveCount(count);
    if (mode === 'changed-source') {
      await expect(page.locator('#p0 .abt-translation')).toHaveCount(0);
      expect(result.task.state).toBe('failed');
    }
    expect(h.server.calls).toHaveLength(2);
  }
  await page.close();
});
