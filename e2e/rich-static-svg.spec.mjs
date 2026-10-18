import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';

const inline = '<svg viewBox="0 0 24 24" width="24" height="24" fill="#123456"><g transform="translate(1 1)"><path d="M0 0L20 0L0 20Z"/><polygon points="4 4 8 4 8 8"/><circle cx="12" cy="12" r="3"/></g></svg>';
const local = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><path d="M0 0L32 0L32 32Z" fill="#654321"/></svg>';
const hostile = '<svg onload="window.__svgExecuted=true"><foreignObject><iframe src="https://attacker.invalid/svg"></iframe></foreignObject></svg>';
const record = '<link rel="stylesheet" href="svg.css"><p class="svg-body">SVG BODY SENTINEL</p>' + inline + '<img src="icons/local.svg" alt="Local geometric icon"><img src="icons/hostile.svg" alt="Blocked icon">' + hostile + '<p>SVG TAIL SENTINEL</p>';

test('inline and local MDD SVG render native safe scenes across restart without XML, scripts or network', async ({ harness }) => {
  test.setTimeout(150000); await harness.reset();
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({ name: 'Static SVG Fixture.mdx', mimeType: 'application/octet-stream', buffer: makeRichMdx([['svgfixture', record]], { title: 'Static SVG Fixture' }) });
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText('Static SVG Fixture');
  await options.locator('#localDictionaryImportButton').click();
  await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成', { timeout: 60000 });
  const row = options.locator('#richMdictInstalledList [data-dictionary-id]').filter({ hasText: 'Static SVG Fixture' });
  await row.getByRole('button', { name: /添加或重新选择资源/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: 'Static SVG Fixture.mdd', mimeType: 'application/octet-stream', buffer: makeMdd([
    ['icons/local.svg', Buffer.from(local)], ['icons/hostile.svg', Buffer.from(hostile)],
    ['svg.css', Buffer.from('.svg-body{color:#123456;background-image:url(icons/local.svg)}')]
  ]) });
  await expect(options.locator('#status')).toContainText('本地资源已更新', { timeout: 60000 });
  await options.close();
  const external = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass) await harness.restartBrowser();
    const page = await harness.open('/selection');
    page.on('request', (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
    await harness.inject(page);
    await page.evaluate(() => { const p = document.createElement('p'); p.id = 'svg-word'; p.textContent = 'svgfixture'; document.body.append(p); });
    await page.locator('#svg-word').evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window })); });
    await expect(page.locator('.tf-selection-chip')).toBeVisible(); await page.locator('.tf-selection-chip').click();
    const card = page.locator('.tf-selection-rich-record').filter({ hasText: 'Static SVG Fixture' });
    if (!await card.evaluate((node) => node.open)) await card.locator('summary').click();
    await expect(card).toHaveAttribute('data-state', 'success', { timeout: 30000 });
    const viewer = card.locator('.tf-rich-viewer');
    await expect(viewer).toContainText('SVG TAIL SENTINEL');
    await expect(viewer.locator('svg')).toHaveCount(2);
    await expect(viewer.locator('[data-rich-resource-kind="image"]')).toHaveCount(1);
    await expect.poll(() => viewer.locator('.svg-body').evaluate((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundImage }))).toEqual({ color: 'rgb(18, 52, 86)', background: 'none' });
    const evidence = await viewer.evaluate((node) => ({
      scenes: [...node.querySelectorAll('svg')].map((svg) => ({ namespace: svg.namespaceURI, width: svg.getBoundingClientRect().width, geometry: [...svg.querySelectorAll('path,polygon,circle')].map((shape) => ({ namespace: shape.namespaceURI, width: shape.getBBox().width })) })),
      unsafe: node.querySelectorAll('script,foreignObject,iframe,use,image,animate,[onload],[href],[src]').length,
      executed: window.__svgExecuted === true
    }));
    expect(evidence.scenes).toHaveLength(2); expect(evidence.unsafe).toBe(0); expect(evidence.executed).toBe(false);
    for (const scene of evidence.scenes) { expect(scene.namespace).toBe('http://www.w3.org/2000/svg'); expect(scene.width).toBeGreaterThan(0); for (const shape of scene.geometry) { expect(shape.namespace).toBe('http://www.w3.org/2000/svg'); expect(shape.width).toBeGreaterThan(0); } }
    await page.keyboard.press('Escape'); await expect(page.locator('.tf-selection-panel')).toBeHidden();
    await page.close();
  }
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]);
});
