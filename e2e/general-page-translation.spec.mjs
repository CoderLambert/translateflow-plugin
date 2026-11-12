import { test, expect } from './support/extension-fixture.mjs';

test('mixed fragments, long prose and open shadow slots translate completely and restore without requests', async ({ harness: h }, info) => {
  await h.reset();
  const long = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ');
  h.server.setPage('/general-page', `<style>main {max-width:800px;margin:auto;} reading-panel {display:block}</style><main>
    <div id="mixed">Opening <strong>important explanation</strong> before a block.<p id="middle">The independent middle paragraph.</p>Closing explanation after the block.</div>
    <div id="breaks">First complete line.<br>Second complete line.</div>
    <p id="long">${long}</p><reading-panel><p slot="copy" id="assigned">Assigned text remains in the original light DOM.</p></reading-panel>
    <div contenteditable>NEVER_SEND_EDITOR</div><div translate="no">NEVER_SEND_PROTECTED</div></main>`);
  const page = await h.open('/general-page');
  await page.evaluate(() => {
    const shadow = document.querySelector('reading-panel').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div id="shadow-copy">Shadow introduction.<slot name="copy"></slot>Shadow ending.</div>';
    globalThis.originalText = document.querySelector('#mixed').firstChild;
    globalThis.originalAssigned = document.querySelector('#assigned');
  });
  await h.inject(page);
  const translated = await h.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'general-fragments' });
  expect(translated).toMatchObject({ ok: true, missing: 0, task: { state: 'completed' } });
  await expect(page.locator('#mixed > .abt-translation')).toHaveCount(2);
  await expect(page.locator('#middle > .abt-translation')).toHaveCount(1);
  await expect(page.locator('#breaks > .abt-translation')).toHaveCount(2);
  await expect(page.locator('#shadow-copy > .abt-translation')).toHaveCount(2);
  await expect(page.locator('#assigned > .abt-translation')).toHaveCount(1);
  const sent = h.server.calls.flatMap(call => call.segments).map(item => item.text);
  expect(sent.some(text => text.includes('NEVER_SEND'))).toBe(false);
  expect(sent.filter(text => text.startsWith('word')).join(' ')).toBe(long);
  expect(sent.filter(text => text.includes('Assigned text'))).toHaveLength(1);
  expect(await page.evaluate(() => originalText === document.querySelector('#mixed').firstChild && originalAssigned === document.querySelector('#assigned'))).toBe(true);
  expect(await page.locator('#shadow-copy > .abt-translation').first().evaluate(el => getComputedStyle(el).display)).toBe('block');
  await h.sendContent(page, 'ABT_TOGGLE_TRANSLATIONS');
  await expect(page.locator('#shadow-copy > .abt-translation').first()).toBeHidden();
  await h.sendContent(page, 'ABT_TOGGLE_TRANSLATIONS');
  await expect(page.locator('#shadow-copy > .abt-translation').first()).toBeVisible();
  const calls = h.server.calls.length;
  await h.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  expect(await h.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: translated.count, missing: 0 });
  expect(h.server.calls).toHaveLength(calls);
  await page.screenshot({ path: info.outputPath('general-page-translation.png'), fullPage: true });
  await page.close();
});

test('automatic discovery handles offscreen paragraphs, late shadow roots and source replacement', async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/general-auto', '<main><p id="first">The first readable paragraph.</p><late-reader></late-reader><p id="offscreen" style="margin-top:2500px">This paragraph is below the visible screen.</p></main>');
  const page = await h.open('/general-auto'); await h.inject(page);
  await h.sendContent(page, 'ABT_ENABLE_AUTO');
  await expect(page.locator('#offscreen > .abt-translation')).toHaveCount(1);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => document.querySelector('late-reader').attachShadow({ mode: 'open' }).innerHTML = '<p id="late">A late attached shadow paragraph.</p>');
  await expect(page.locator('#late > .abt-translation')).toHaveCount(1, { timeout: 10000 });
  await page.evaluate(() => {
    const p = document.querySelector('late-reader').shadowRoot.querySelector('#late');
    p.firstChild.nodeValue = 'The replacement shadow content must be translated.';
  });
  await expect(page.locator('#late > .abt-translation')).toContainText('replacement shadow content');
  const calls = h.server.calls.length;
  await h.sendContent(page, 'ABT_DISABLE_AUTO');
  await page.evaluate(() => document.querySelector('late-reader').shadowRoot.querySelector('#late').firstChild.nodeValue = 'Disabled automatic translation must not send this replacement.');
  await h.sendContent(page, 'ABT_RESTORE_CACHE');
  expect(h.server.calls).toHaveLength(calls);
  await expect(page.locator('#late > .abt-translation')).toHaveCount(0);
  await page.close();
});

test('scope setting includes all readable roots and safely changes between content and entire page', async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/general-scope', '<header><a href="/home" id="brand">Site navigation</a></header><main><p id="one">First main region.</p></main><main><p id="two">Second main region.</p><input value="PRIVATE_INPUT"></main><footer id="footer">Footer information.</footer>');
  const page = await h.open('/general-scope'); await h.inject(page);
  expect(await h.sendContent(page, 'ABT_TRANSLATE_PAGE')).toMatchObject({ count: 2 });
  await expect(page.locator('#brand .abt-translation')).toHaveCount(0);
  await h.setStorage({ pageTranslationScope: 'all' });
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  expect(await h.sendContent(page, 'ABT_TRANSLATE_PAGE')).toMatchObject({ count: 4, missing: 0 });
  await expect(page.locator('#brand > .abt-translation')).toHaveCount(1);
  await expect(page.locator('#footer > .abt-translation')).toHaveCount(1);
  await h.setStorage({ pageTranslationScope: 'content' });
  await h.sendContent(page, 'ABT_RESTORE_CACHE');
  await expect(page.locator('#brand .abt-translation')).toHaveCount(0);
  expect(h.server.calls.flatMap(call => call.segments).some(item => item.text.includes('PRIVATE_INPUT'))).toBe(false);
  const settings = await h.context.newPage();
  await settings.goto(`chrome-extension://${h.extensionId}/options.html#general`);
  await expect(settings.locator('#pageTranslationScope')).toContainText('正文内容');
  await settings.close(); await page.close();
});

test('page scan remains cancellable before any provider request', async ({ harness: h }) => {
  await h.reset();
  h.server.setPage('/scan-cancellation', `<main>${Array.from({length:12000}, (_,i)=>`<p>Readable paragraph number ${i}.</p>`).join('')}</main>`);
  const page=await h.open('/scan-cancellation');await h.inject(page);
  const run=h.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'cancel-discovery'});
  await expect.poll(async ()=>(await h.sendContent(page,'TF_TASK_STATUS',{taskId:'cancel-discovery'})).task?.state).toBe('queued');
  expect(await h.sendContent(page,'TF_CANCEL_TASK',{taskId:'cancel-discovery'})).toMatchObject({cancelled:true});
  expect(await run).toMatchObject({cancelled:true,task:{state:'cancelled'}});
  expect(h.server.calls).toHaveLength(0);
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  await page.close();
});

test('reopening a disclosure and removing only its translation both recover from cache',async({harness:h})=>{
  await h.reset();h.server.setPage('/reopen-source','<main><details open><summary>Read the lesson</summary><p id="copy">The same source survives disclosure changes.</p></details></main>');
  const page=await h.open('/reopen-source');await h.inject(page);await h.sendContent(page,'ABT_ENABLE_AUTO');
  await expect(page.locator('#copy > .abt-translation')).toHaveCount(1);
  const requests=h.server.calls.length;
  await page.locator('summary').click();await expect(page.locator('#copy > .abt-translation')).toHaveCount(0);
  await page.locator('summary').click();await expect(page.locator('#copy > .abt-translation')).toHaveCount(1);
  expect(h.server.calls).toHaveLength(requests);
  await page.evaluate(()=>document.querySelector('#copy > .abt-translation').remove());
  await expect(page.locator('#copy > .abt-translation')).toHaveCount(1,{timeout:10000});
  expect(h.server.calls).toHaveLength(requests);
  await h.sendContent(page,'ABT_DISABLE_AUTO');await page.close();
});
