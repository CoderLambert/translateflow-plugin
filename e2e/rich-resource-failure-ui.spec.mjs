import { readFile } from 'node:fs/promises';
import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';

const title = 'Resource recovery UI fixture';
const png = await readFile(new URL('../tests/fixtures/mdd-linked-package/sample.png', import.meta.url));
const record = '<link rel="stylesheet" href="entry.css"><p class="entry">BODY REMAINS READABLE</p>' +
  '<span class="o-head-symbol-set o-active">' + ['CEFR', 'OPAL', 'CET4', 'CET6', 'NETM'].map(label =>
    `<span class="o-symbol-wrap"><span class="o-symbol-token"><img src="img/${label}.png" alt="${label}"></span></span>`).join('') +
  '</span><p><img src="illustration.png" alt="Ordinary illustration"></p><a href="sound://audio.wav">Fixture audio</a>';
function wav() {
  const bytes = Buffer.alloc(1644); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(1600, 40);
  return bytes;
}
async function query(harness) {
  const page = await harness.open('/selection'); await harness.inject(page); await page.setViewportSize({ width: 360, height: 760 });
  await page.evaluate(() => { const word = document.createElement('p'); word.id = 'resource-word'; word.textContent = 'resourcefixture'; document.body.append(word); });
  await page.locator('#resource-word').evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window })); });
  await page.locator('.tf-selection-chip').click();
  const card = page.locator('.tf-selection-rich-record').filter({ hasText: title });
  if (!await card.evaluate(node => node.open)) await card.locator('summary').click();
  await expect(card).toHaveAttribute('data-state', 'success', { timeout: 30000 });
  return { page, card, viewer: card.locator('.tf-rich-viewer') };
}

test('missing companions preserve readable text and compact badges; attachment repair restores CSS images and audio after restart', async ({ harness }, testInfo) => {
  test.setTimeout(180000); await harness.reset();
  const external = [];
  harness.context.on('request', request => { if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
  const options = await harness.context.newPage(); await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({ name: 'Recovery.mdx', mimeType: 'application/octet-stream', buffer: makeRichMdx([['resourcefixture', record]], { title }) });
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText(title); await options.locator('#localDictionaryImportButton').click();
  await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成', { timeout: 60000 });
  const first = await query(harness);
  await expect(first.viewer).toContainText('BODY REMAINS READABLE');
  await expect(first.card.locator('.tf-rich-resource-notice')).toHaveCount(1);
  const badges = first.viewer.locator('.o-symbol-token > .tf-rich-placeholder');
  await expect(badges).toHaveCount(5);
  for (const badge of await badges.all()) {
    const size = await badge.evaluate(node => ({ height: node.getBoundingClientRect().height, writingMode: getComputedStyle(node).writingMode, whiteSpace: getComputedStyle(node).whiteSpace }));
    expect(size.height).toBeLessThan(40); expect(size.writingMode).toBe('horizontal-tb'); expect(size.whiteSpace).toBe('nowrap');
  }
  await expect(first.viewer.locator('[data-rich-resource-kind="image"]').filter({ hasText: 'Ordinary illustration' })).toBeVisible();
  await first.viewer.locator('[data-action="load-mdd-audio"]').click();
  await expect(first.viewer.locator('audio')).toHaveCount(0);
  await expect(first.viewer.locator('[data-action="load-mdd-audio"]')).toBeEnabled();
  await expect(first.card.locator('.tf-rich-resource-notice')).toHaveCount(1);
  await expect(first.viewer.locator('[data-action="load-mdd-audio"]')).toHaveAttribute('data-failure-kind', 'missing');
  expect(await first.viewer.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await first.page.screenshot({ path: testInfo.outputPath('missing-companions.png'), caret: 'initial' });
  await first.page.keyboard.press('Escape'); await expect(first.page.locator('.tf-selection-panel')).toBeHidden();
  const row = options.locator('#richMdictInstalledList [data-dictionary-id]').filter({ hasText: title });
  await row.getByRole('button', { name: /添加或重新选择资源/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: 'Recovery.mdd', mimeType: 'application/octet-stream', buffer: makeMdd([
    ['entry.css', Buffer.from('.entry{color:#123456}')], ['illustration.png', png], ['audio.wav', wav()],
    ...['CEFR', 'OPAL', 'CET4', 'CET6', 'NETM'].map(label => [`img/${label}.png`, png])
  ]) });
  await expect(options.locator('#status')).toContainText('本地资源已更新', { timeout: 60000 });
  await harness.restartBrowser();
  harness.context.on('request', request => { if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
  const repaired = await query(harness);
  await expect.poll(() => repaired.viewer.locator('.entry').evaluate(node => getComputedStyle(node).color)).toBe('rgb(18, 52, 86)');
  await expect(repaired.viewer.locator('.o-symbol-token img[src^="blob:"]')).toHaveCount(5);
  await repaired.viewer.locator('[data-action="load-mdd-audio"]').click();
  await expect(repaired.viewer.locator('audio[src^="blob:"]')).toBeVisible();
  await expect(repaired.card.locator('.tf-rich-resource-notice')).toHaveCount(0);
  await repaired.page.screenshot({ path: testInfo.outputPath('repaired-companions.png'), caret: 'initial' });
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]);
});
