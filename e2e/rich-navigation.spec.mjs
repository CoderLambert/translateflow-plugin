import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';
import { makeTinyTrueType } from '../tests/helpers/ttf-fixture.mjs';

const go = '<link rel="stylesheet" href="navigation.css"><p class="probe">AAAA</p><p id="go.part">GO DEFINITION SENTINEL</p><a href="entry://come#come.part">OPEN COME</a><a href="entry://missing">OPEN MISSING</a><a href="https://attacker.invalid/remote">INERT REMOTE</a><a href="sound://audio/go.wav">GO AUDIO</a>';
const come = '<p id="come.part">COME DEFINITION SENTINEL</p><a href="entry://go#go.part">OPEN GO</a><a href="#come.part">LOCAL SECTION</a>';
const css = '@font-face{font-family:"Navigation Fixture";src:url(fonts/static.ttf)}.probe{font-family:"Navigation Fixture",monospace;font-size:40px}';
function wav() {
  const bytes = Buffer.alloc(44 + 1600); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(1600, 40); return bytes;
}
async function install(harness) {
  const options = await harness.context.newPage(); await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({ name: 'Navigation Fixture.mdx', mimeType: 'application/octet-stream', buffer: makeRichMdx([['come', come], ['go', go]], { title: 'Navigation Fixture' }) });
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText('Navigation Fixture'); await options.locator('#localDictionaryImportButton').click();
  await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成', { timeout: 60000 });
  const row = options.locator('#richMdictInstalledList [data-dictionary-id]').filter({ hasText: 'Navigation Fixture' });
  await row.getByRole('button', { name: /添加或重新选择资源/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: 'Navigation Fixture.mdd', mimeType: 'application/octet-stream', buffer: makeMdd([
    ['navigation.css', Buffer.from(css)], ['fonts/static.ttf', makeTinyTrueType()], ['audio/go.wav', wav()]
  ]) }); await expect(options.locator('#status')).toContainText('本地资源已更新', { timeout: 60000 }); await options.close();
}
async function selectGo(page) {
  await page.evaluate(() => { let node = document.querySelector('#navigation-word'); if (!node) { node = document.createElement('p'); node.id = 'navigation-word'; document.body.append(node); } node.textContent = 'go'; });
  await page.locator('#navigation-word').evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window })); });
  await expect(page.locator('.tf-selection-chip')).toBeVisible(); await page.locator('.tf-selection-chip').click();
}

test('same-dictionary entry navigation, literal fragments, Back/Forward, misses and resource cleanup remain local after restart', async ({ harness }) => {
  test.setTimeout(150000); await harness.reset(); await install(harness); const external = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass) await harness.restartBrowser();
    const page = await harness.open('/selection');
    page.on('request', (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
    const documentUrl = page.url(); await harness.inject(page); await selectGo(page);
    const card = page.locator('.tf-selection-rich-record').filter({ hasText: 'Navigation Fixture' });
    if (!await card.evaluate((node) => node.open)) await card.locator('summary').click();
    await expect(card).toHaveAttribute('data-state', 'success', { timeout: 30000 });
    const viewer = card.locator('.tf-rich-viewer'), nav = card.locator('.tf-rich-navigation');
    const back = nav.getByRole('button', { name: /返回|Back/u }), forward = nav.getByRole('button', { name: /前进|Forward/u });
    await expect(viewer).toContainText('GO DEFINITION SENTINEL'); await expect(back).toBeDisabled();
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-') && face.status === 'loaded').length)).toBe(1);
    await viewer.locator('[data-action="load-mdd-audio"]').click(); await expect(viewer.locator('audio')).toBeVisible();
    expect(await viewer.getByRole('button', { name: 'INERT REMOTE', exact: true }).count()).toBe(0);
    await viewer.getByRole('button', { name: 'OPEN COME', exact: true }).click();
    await expect(viewer).toContainText('COME DEFINITION SENTINEL'); await expect(back).toBeEnabled(); await expect(forward).toBeDisabled();
    await expect.poll(() => viewer.evaluate((node) => node.getRootNode().activeElement?.dataset.richTargetId)).toBe('come.part');
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-')).length)).toBe(0);
    await expect(viewer.locator('audio')).toHaveCount(0);
    await back.click(); await expect(viewer).toContainText('GO DEFINITION SENTINEL'); await expect(forward).toBeEnabled();
    await forward.click(); await expect(viewer).toContainText('COME DEFINITION SENTINEL');
    await viewer.getByRole('button', { name: 'LOCAL SECTION', exact: true }).click();
    await expect.poll(() => viewer.evaluate((node) => node.getRootNode().activeElement?.dataset.richTargetId)).toBe('come.part');
    await back.click(); await expect(viewer).toContainText('GO DEFINITION SENTINEL');
    await viewer.getByRole('button', { name: 'OPEN MISSING', exact: true }).click();
    await expect(nav.getByRole('status')).toContainText(/未找到该词条|Entry not found/u); await expect(viewer).toContainText('GO DEFINITION SENTINEL'); await expect(back).toBeDisabled(); await expect(forward).toBeEnabled();
    await page.keyboard.press('Escape'); await expect(page.locator('.tf-selection-panel')).toBeHidden();
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-')).length)).toBe(0);
    await selectGo(page); const fresh = page.locator('.tf-selection-rich-record').filter({ hasText: 'Navigation Fixture' });
    if (!await fresh.evaluate((node) => node.open)) await fresh.locator('summary').click();
    await expect(fresh.locator('.tf-rich-navigation').getByRole('button', { name: /返回|Back/u })).toBeDisabled();
    await expect(fresh.locator('.tf-rich-navigation').getByRole('button', { name: /前进|Forward/u })).toBeDisabled();
    expect(page.url()).toBe(documentUrl);
    await page.keyboard.press('Escape'); await page.close();
  }
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]);
});
