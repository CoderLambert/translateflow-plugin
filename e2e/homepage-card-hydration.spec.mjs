import { test, expect } from './support/extension-fixture.mjs';

test.afterEach(async ({ harness: h }) => {
  await h.serviceWorker.evaluate(() => {
    globalThis.__cardRelease?.();
    if (globalThis.__cardFetch) fetch = __cardFetch;
  });
});

for (const timing of ['before-translation', 'during-translation']) test(`visible cards remain complete when link wrappers appear ${timing}`, async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/card-hydration', `<main>${Array.from({ length: 8 }, (_, i) => `
    <div role="link" tabindex="0" class="card"><div class="body">
      <h2 contenteditable="false">Resource heading ${i}</h2>
      <span class="copy">A complete description for resource ${i}.</span>
      <div><button>Visit resource ${i}</button></div>
    </div></div>`).join('')}
    <div hidden>NEVER_SEND_HIDDEN</div><div style="display:none">NEVER_SEND_CSS_HIDDEN</div>
    <div contenteditable="true">NEVER_SEND_EDITOR</div><div translate="no">NEVER_SEND_PROTECTED</div>
    <blockquote aria-hidden="true" style="position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden"><h2>NEVER_SEND_CLIPPED</h2></blockquote>
    <pre>NEVER_SEND_CODE</pre></main>`);
  const page = await h.open('/card-hydration');
  await h.inject(page);
  await page.evaluate(() => {
    globalThis.originalBodies = [...document.querySelectorAll('.body')];
    globalThis.cardClicks = 0;
    document.querySelector('button').addEventListener('click', event => { event.preventDefault(); cardClicks++; });
    globalThis.wrapCards = () => {
      for (const [i, body] of originalBodies.entries()) {
        const link = document.createElement('a');
        link.href = `/resource-${i}`;
        link.tabIndex = -1;
        link.setAttribute('aria-hidden', 'true');
        link.style.display = 'contents';
        body.replaceWith(link);
        link.appendChild(body);
      }
    };
  });
  if (timing === 'before-translation') await page.evaluate(() => wrapCards());
  else await h.serviceWorker.evaluate(() => {
    globalThis.__cardFetch = fetch;
    globalThis.__cardCalls = 0;
    globalThis.__cardPending = false;
    const held = new Promise(resolve => { globalThis.__cardRelease = resolve; });
    globalThis.fetch = async (...args) => {
      if (String(args[0]).endsWith('/chat/completions') && ++__cardCalls >= 2) {
        __cardPending = true;
        await held;
      }
      return __cardFetch(...args);
    };
  });
  const pending = h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'card-hydration' });
  if (timing === 'during-translation') {
    await expect.poll(() => h.serviceWorker.evaluate(() => __cardPending)).toBe(true);
    await expect(page.locator('.abt-translation')).toHaveCount(4);
    await page.evaluate(() => wrapCards());
    await h.serviceWorker.evaluate(() => __cardRelease());
  }
  expect(await pending).toMatchObject({ ok: true, count: 24, missing: 0, task: { state: 'completed' } });
  await expect(page.locator('.abt-translation')).toHaveCount(24);
  for (const card of await page.locator('.card').all()) {
    await expect(card.locator('h2 > .abt-translation')).toHaveCount(1);
    await expect(card.locator('.copy > .abt-translation')).toHaveCount(1);
    await expect(card.locator('button > .abt-translation')).toHaveCount(1);
  }
  await expect(page.locator('.abt-translation a')).toHaveCount(0);
  const sent = h.server.calls.flatMap(call => call.segments).map(segment => segment.text);
  expect(sent).toHaveLength(24);
  expect(new Set(sent).size).toBe(24);
  expect(sent.some(text => text.includes('NEVER_SEND'))).toBe(false);
  expect(await page.evaluate(() => originalBodies.every((node, i) =>
    node === document.querySelectorAll('.body')[i] && node.parentElement.getAttribute('href') === `/resource-${i}`))).toBe(true);
  await page.locator('button').first().click();
  expect(await page.evaluate(() => cardClicks)).toBe(1);
  const calls = h.server.calls.length;
  await h.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: 24, missing: 0 });
  await expect(page.locator('.abt-translation')).toHaveCount(24);
  expect(h.server.calls).toHaveLength(calls);
  await page.close();
});
