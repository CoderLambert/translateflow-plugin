import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';
import { makeOxfordAdapterRecord, ADAPTER_DIAGRAM } from '../tests/helpers/oxford-adapter-fixture.mjs';
function wav() { const bytes = Buffer.alloc(44 + 1600); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(1600, 40); return bytes; }
const go = makeOxfordAdapterRecord({ posCount: 4, pronunciationIndices: [0, 3], headIndices: [0, 3] }) + '<a href="#panel.2.deep">OPEN DEEP SECTION</a><a href="entry://adapterother#panel.1.deep">OPEN OTHER ENTRY</a>';
const other = makeOxfordAdapterRecord({ posCount: 3, pronunciationIndices: [0, 1, 2], headIndices: [0, 1, 2] });

async function selectWord(page) {
  await page.evaluate(() => { const node = document.createElement('p'); node.id = 'adapter-word'; node.textContent = 'go'; document.body.append(node); });
  await page.locator('#adapter-word').evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window })); });
  await expect(page.locator('.tf-selection-chip')).toBeVisible(); await page.locator('.tf-selection-chip').click();
}

test('structural Oxford POS, native disclosures, hints and registered illustrations remain local through navigation and restart', async ({ harness }) => {
  test.setTimeout(180000); await harness.reset();
  const options = await harness.context.newPage(); await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({ name: 'Generic Structural Fixture.mdx', mimeType: 'application/octet-stream', buffer: makeRichMdx([['adapterother', other], ['go', go]], { title: 'Generic Structural Fixture' }) });
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText('Generic Structural Fixture'); await options.locator('#localDictionaryImportButton').click(); await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成', { timeout: 60000 });
  const row = options.locator('#richMdictInstalledList [data-dictionary-id]').filter({ hasText: 'Generic Structural Fixture' });
  await row.getByRole('button', { name: /添加或替换 MDD 附件/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: 'Generic Structural Fixture.mdd', mimeType: 'application/octet-stream', buffer: makeMdd([
    ['images/diagram.svg', Buffer.from(ADAPTER_DIAGRAM)], ...[0, 1, 2, 3].map((index) => [`audio/pron-${index}.wav`, wav()])
  ]) }); await expect(options.locator('#status')).toContainText('本地资源已更新', { timeout: 60000 }); await options.close();
  const external = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass) await harness.restartBrowser(); const page = await harness.open('/selection');
    page.on('request', (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
    await harness.inject(page); await selectWord(page);
    const card = page.locator('.tf-selection-rich-record').filter({ hasText: 'Generic Structural Fixture' });
    if (!await card.evaluate((node) => node.open)) await card.locator('summary').first().click(); await expect(card).toHaveAttribute('data-state', 'success', { timeout: 30000 });
    const viewer = card.locator('.tf-rich-viewer'); await expect(viewer.locator('label[for="pos-0"]')).toBeVisible();
    await expect(viewer.locator('.o-pronunciation-set.o-active')).toContainText('PRON 0');
    await viewer.locator('.o-pronunciation-set.o-active [data-action="load-mdd-audio"]').click(); await expect(viewer.locator('audio')).toBeVisible();
    await viewer.locator('audio').evaluate((node) => { window.__oldAdapterAudio = node; });
    await viewer.locator('label[for="pos-3"]').click(); await expect(viewer.locator('audio')).toHaveCount(0);
    expect(await page.evaluate(() => window.__oldAdapterAudio.paused && !window.__oldAdapterAudio.hasAttribute('src'))).toBe(true);
    await expect(viewer.locator('.o-pronunciation-set.o-active')).toContainText('PRON 3'); await expect(viewer.locator('.o-head-symbol-set.o-active')).toContainText('HEAD 3');
    await viewer.locator('label[for="pos-2"]').click(); await expect(viewer.locator('.o-pronunciation-set.o-active')).toHaveCount(0); await expect(viewer.locator('.o-head-symbol-set.o-active')).toHaveCount(0);
    await viewer.getByRole('button', { name: 'OPEN DEEP SECTION', exact: true }).click(); await expect(viewer.locator('.o-for-pos-2.o-pos-panel details')).toHaveAttribute('open', '');
    await viewer.locator('label[for="pos-0"]').focus(); await page.keyboard.press('End'); await expect(viewer.locator('#pos-3')).toBeChecked();
    await viewer.locator('label[for="pos-0"]').click();
    const hint = viewer.getByRole('button', { name: /查看说明|Show explanation/u }); await hint.click(); await expect(viewer.locator('.tf-rich-owned-hint')).toContainText('SYNTHETIC TIP');
    const illustration = viewer.locator('.o-for-pos-0.o-pos-panel').getByRole('button', { name: /查看插图|View illustration/u }); await illustration.click();
    await expect(viewer.locator('.tf-rich-image-preview svg path')).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(viewer.locator('.tf-rich-image-preview')).toHaveCount(0); await expect(viewer.locator('.tf-rich-owned-hint')).toBeVisible(); await expect(illustration).toBeFocused();
    await page.keyboard.press('Escape'); await expect(viewer.locator('.tf-rich-owned-hint')).toHaveCount(0); await expect(hint).toBeFocused(); await expect(page.locator('.tf-selection-panel')).toBeVisible();
    await viewer.getByRole('button', { name: 'OPEN OTHER ENTRY', exact: true }).click();
    await expect(viewer.locator('label[for="pos-2"]')).toBeVisible(); await expect(viewer.locator('#pos-1')).toBeChecked(); await expect(viewer.locator('.o-for-pos-1.o-pos-panel details')).toHaveAttribute('open', '');
    await card.locator('.tf-rich-navigation').getByRole('button', { name: /返回|Back/u }).click(); await expect(viewer.locator('label[for="pos-3"]')).toBeVisible(); await expect(viewer.locator('#pos-2')).toBeChecked();
    expect(await viewer.locator('[onclick],[onload],script,iframe,foreignObject').count()).toBe(0);
    await page.keyboard.press('Escape'); await expect(page.locator('.tf-selection-panel')).toBeHidden(); await page.close();
  }
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]);
});
