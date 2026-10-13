import { test, expect } from './support/extension-fixture.mjs';
import { makeRichMdx } from '../tests/helpers/rich-mdict-fixture.mjs';
import { makeMdd } from '../tests/helpers/mdd-fixture.mjs';
import { makeTinyTrueType } from '../tests/helpers/ttf-fixture.mjs';

const variants = [
  { style: 'normal', weight: '400', advance: 300 }, { style: 'italic', weight: '400', advance: 330 },
  { style: 'normal', weight: '700', advance: 600 }, { style: 'italic', weight: '700', advance: 630 }
];
const css = '.probe{font-family:"Fixture Font",monospace;font-size:40px;display:inline-block}.italic{font-style:italic}.bold{font-weight:700}' +
  variants.map(({ style, weight }, index) => `@font-face{font-family:"Fixture Font";src:url(fonts/${index}.ttf) format("truetype");font-style:${style};font-weight:${weight};font-display:swap}`).join('') +
  '@font-face{font-family:Remote;src:url(https://attacker.invalid/font.ttf)}.remote{font-family:Remote,serif}';
const record = '<link rel="stylesheet" href="font.css"><div class="entry">' + variants.map(({ style, weight }, index) => `<span class="probe ${style === 'italic' ? 'italic' : ''} ${weight === '700' ? 'bold' : ''}" data-untrusted="discard">AAAA</span>`).join('') + '<p>FONT RECORD TAIL</p><p class="remote">REMOTE FONT FALLBACK</p></div>';
const brokenRecord = '<link rel="stylesheet" href="broken.css"><div><input type="radio" id="state-a" name="states" class="choice" checked><input type="radio" id="state-b" name="states" class="choice"><nav><label for="state-a">First</label><label for="state-b">Second</label></nav><div class="panels"><section class="panel first">FIRST VISIBLE PANEL</section><section class="panel second">SECOND VISIBLE PANEL</section></div><span class="probe">AAAA</span><p>BROKEN FONT BODY TAIL</p></div>';
const brokenCss = '@font-face{font-family:Broken;src:url(fonts/broken.ttf)}.probe{font-family:Broken,monospace;font-size:40px}.choice{display:none}.panel{display:none}#state-a:checked~.panels>.first{display:block}#state-b:checked~.panels>.second{display:block}';

async function selectWord(page, text) {
  await page.evaluate((text) => { let word = document.querySelector('#font-word'); if (!word) { word = document.createElement('p'); word.id = 'font-word'; document.body.append(word); } word.textContent = text; }, text);
  await page.locator('#font-word').evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
  });
  await expect(page.locator('.tf-selection-chip')).toBeVisible(); await page.locator('.tf-selection-chip').click();
}

async function installed(harness, title, advanceOffset) {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator('#localDictionaryFiles').setInputFiles({ name: `${title}.mdx`, mimeType: 'application/octet-stream', buffer: makeRichMdx([['fontfixture', record], ['brokenfontfixture', brokenRecord]], { title }) });
  await expect(options.locator('#localDictionaryPreflightSummary')).toContainText(title);
  await options.locator('#localDictionaryImportButton').click();
  await expect(options.locator('#localDictionaryImportProgress')).toContainText('完成', { timeout: 60000 });
  const broken = makeTinyTrueType(); const cmapAt = broken.readUInt32BE(broken.indexOf(Buffer.from('cmap')) + 8); broken.writeUInt16BE(1, cmapAt); // valid bounded sfnt directory; browser decoder rejects the unsupported cmap version
  const mdd = makeMdd([['font.css', Buffer.from(css)], ['broken.css', Buffer.from(brokenCss)], ['fonts/broken.ttf', broken], ...variants.map(({ advance, style, weight }, index) => [`fonts/${index}.ttf`, makeTinyTrueType({ advance: advance + advanceOffset, weight: Number(weight), italic: style === 'italic' })])]);
  const row = options.locator('#richMdictInstalledList [data-dictionary-id]').filter({ hasText: title });
  await row.getByRole('button', { name: /添加或替换 MDD 附件/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: `${title}.mdd`, mimeType: 'application/octet-stream', buffer: mdd });
  await expect(options.locator('#status')).toContainText('本地资源已更新', { timeout: 60000 });
  await options.close();
}

test('local TrueType faces load with four variants, isolated families, fallback and exact cleanup after restart', async ({ harness }) => {
  test.setTimeout(180000); await harness.reset();
  await installed(harness, 'Synthetic Font One', 0); await installed(harness, 'Synthetic Font Two', 100);
  const external = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass) await harness.restartBrowser();
    const page = await harness.open('/selection');
    page.on('request', (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
    await harness.inject(page); await selectWord(page, 'fontfixture');
    const aliases = [];
    for (const [index, title] of ['Synthetic Font One', 'Synthetic Font Two'].entries()) {
      const card = page.locator('.tf-selection-rich-record').filter({ hasText: title });
      if (!await card.evaluate((node) => node.open)) await card.locator('summary').click();
      await expect(card).toHaveAttribute('data-state', 'success', { timeout: 30000 });
      const viewer = card.locator('.tf-rich-viewer'); await expect(viewer).toContainText('FONT RECORD TAIL');
      await expect.poll(async () => viewer.evaluate((node) => [...document.fonts].filter((face) => getComputedStyle(node.querySelector('.probe')).fontFamily.includes(face.family) && face.status === 'loaded').length)).toBe(4);
      const proof = await viewer.evaluate(async (node) => {
        const alias = getComputedStyle(node.querySelector('.probe')).fontFamily.split(',')[0].replaceAll('"', '').trim();
        const spans = [...node.querySelectorAll('.probe')];
        const faces = [...document.fonts].filter((face) => face.family === alias);
        return { alias, widths: spans.map((span) => span.getBoundingClientRect().width), faces: faces.map((face) => ({ status: face.status, style: face.style, weight: face.weight })), matched: (await document.fonts.load(`40px "${alias}"`, 'AAAA')).some((face) => faces.includes(face)), fallback: getComputedStyle(node.querySelector('.remote')).fontFamily };
      });
      expect(proof.alias).toMatch(/^tf-rich-font-[0-9a-f]{32}-0$/u); aliases.push(proof.alias);
      expect(proof.faces).toHaveLength(4); expect(proof.faces.every((face) => face.status === 'loaded')).toBe(true); expect(proof.matched).toBe(true);
      for (let variant = 0; variant < 4; variant += 1) expect(proof.widths[variant]).toBeCloseTo((variants[variant].advance + index * 100) * 0.16, 1);
      expect(proof.fallback).toBe('serif');
    }
    expect(aliases[0]).not.toBe(aliases[1]);
    expect(await page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-')).length)).toBe(8);
    await page.keyboard.press('Escape'); await expect(page.locator('.tf-selection-panel')).toBeHidden();
    await expect.poll(() => page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-')).length)).toBe(0);
    await selectWord(page, 'brokenfontfixture');
    const brokenCard = page.locator('.tf-selection-rich-record').filter({ hasText: 'Synthetic Font One' });
    if (!await brokenCard.evaluate((node) => node.open)) await brokenCard.locator('summary').click();
    await expect(brokenCard).toHaveAttribute('data-state', 'success', { timeout: 30000 });
    const brokenViewer = brokenCard.locator('.tf-rich-viewer');
    await expect(brokenViewer).toContainText('BROKEN FONT BODY TAIL');
    await expect(brokenViewer.locator('.tf-rich-truncated')).toContainText(/部分词典字体未能加载|Some dictionary fonts could not load/u);
    await expect(brokenViewer.locator('.first')).toBeVisible(); await expect(brokenViewer.locator('.second')).toBeHidden();
    await brokenViewer.locator('label[for="state-b"]').click(); await expect(brokenViewer.locator('.second')).toBeVisible(); await expect(brokenViewer.locator('.first')).toBeHidden();
    expect(await page.evaluate(() => [...document.fonts].filter((face) => face.family.startsWith('tf-rich-font-')).length)).toBe(0);
    await page.keyboard.press('Escape'); await expect(page.locator('.tf-selection-panel')).toBeHidden();
  }
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]);
});
