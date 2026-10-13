import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';

const title = 'Responsive dictionary fixture';
const record = `<link rel="stylesheet" href="layout.css"><div class="word-line"><b class="head">example</b><span>Several local badges</span><span>British and American pronunciation</span></div><div class="layout"><section class="definitions"><b class="pos">noun</b><p>Readable definition with a complete sentence.</p><details><summary>Show related words</summary><div class="synonyms">${Array.from({length:30},(_,i)=>`<p>Related word ${i + 1}: a complete explanation that remains readable in the dictionary window.</p>`).join('')}<p class="tail">FINAL RELATED WORD</p></div></details></section><section class="related"><p>Related concepts and usage.</p></section></div>`;
const css = '.word-line{display:flex;flex-flow:row wrap;gap:12px}.head{flex-shrink:0}.layout{display:flex;flex-direction:row-reverse;gap:16px}.definitions{flex:3 1 0;min-width:0}.related{flex:1 1 0;min-width:0}.pos{background:#123456;color:white}@media screen and (max-width:600px){.layout{flex-direction:column}.definitions,.related{flex:auto}}';
async function select(page, word) {
  await page.evaluate(word => { let el=document.querySelector('#reading-fixture'); if(!el){el=document.createElement('p');el.id='reading-fixture';document.body.prepend(el);} el.textContent=word; const range=document.createRange();range.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,view:window})); },word);
  await page.locator('.tf-selection-chip').click();
  const card=page.locator('.tf-selection-rich-record').filter({hasText:title});
  if(!await card.evaluate(el=>el.open)) await card.locator('summary').click();
  await expect(card).toHaveAttribute('data-state','success');
  return { panel:page.locator('.tf-selection-panel'),viewer:card.locator('.tf-rich-viewer') };
}
async function contained(page,panel) {
  const rect=await panel.boundingBox(),size=page.viewportSize();
  expect(rect.x).toBeGreaterThanOrEqual(6);expect(rect.y).toBeGreaterThanOrEqual(6);
  expect(rect.x+rect.width).toBeLessThanOrEqual(size.width-6);expect(rect.y+rect.height).toBeLessThanOrEqual(size.height-6);
  await expect(panel.locator('.tf-selection-header')).toBeInViewport();
  await expect(panel.locator('.tf-selection-footer-actions')).toBeInViewport();
}

test('rich article expands the existing window on overflow; container layout, manual sizing and new selection stay usable',async({harness},info)=>{
  test.setTimeout(120000);await harness.reset();
  const options=await harness.context.newPage();await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({name:'reading.mdx',mimeType:'application/octet-stream',buffer:makeRichMdx([['readingfixture',record],['tinyfixture','<p>Short article.</p>']],{title})});
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText(title);await options.locator('#localDictionaryImportButton').click();await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成');
  const row=options.locator('#richMdictInstalledList [data-dictionary-id]').filter({hasText:title});await row.getByRole('button',{name:/添加或重新选择资源/u}).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({name:'reading.mdd',mimeType:'application/octet-stream',buffer:makeMdd([['layout.css',Buffer.from(css)]])});await expect(options.locator('#status')).toContainText('本地资源已更新');
  const page=await harness.open('/selection');await page.setViewportSize({width:1440,height:1000});await harness.inject(page);
  const external=[];page.on('request',r=>{if(/^https?:/u.test(r.url())&&new URL(r.url()).origin!==harness.server.baseUrl)external.push(r.url());});
  const {panel,viewer}=await select(page,'readingfixture');
  await expect(panel).toHaveAttribute('data-view-mode','compact');
  await expect.poll(()=>viewer.locator('.layout').evaluate(el=>getComputedStyle(el).flexDirection)).toBe('column');
  await expect.poll(()=>viewer.locator('.pos').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');
  await viewer.locator('summary').click();
  await expect(panel).toHaveAttribute('data-view-mode','reading');
  await expect.poll(async()=>(await panel.boundingBox()).width).toBeGreaterThan(900);
  await expect.poll(()=>viewer.locator('.layout').evaluate(el=>getComputedStyle(el).flexDirection)).toBe('row-reverse');
  await contained(page,panel);await viewer.locator('.tail').scrollIntoViewIfNeeded();await expect(viewer.locator('.tail')).toBeInViewport();
  await page.screenshot({path:info.outputPath('reading-desktop.png')});
  await panel.locator('.tf-selection-size-toggle').click();await expect(panel).toHaveAttribute('data-view-mode','compact');
  await expect.poll(()=>viewer.locator('.layout').evaluate(el=>getComputedStyle(el).flexDirection)).toBe('column');
  await panel.locator('.tf-selection-size-toggle').click();await expect(panel).toHaveAttribute('data-view-mode','reading');
  await page.setViewportSize({width:360,height:760});await expect(async()=>{await contained(page,panel);}).toPass();
  await expect.poll(()=>viewer.locator('.layout').evaluate(el=>getComputedStyle(el).flexDirection)).toBe('column');
  expect(await viewer.locator('.head').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(35);
  await viewer.locator('.tail').scrollIntoViewIfNeeded();await expect(viewer.locator('.tail')).toBeInViewport();
  await page.screenshot({path:info.outputPath('reading-narrow.png')});
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();
  const next=await select(page,'tinyfixture');await expect(next.panel).toHaveAttribute('data-view-mode','compact');await expect(next.viewer).toContainText('Short article.');
  expect(harness.server.calls).toHaveLength(0);expect(external).toEqual([]);
});
