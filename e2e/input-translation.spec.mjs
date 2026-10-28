import { chooseSelect, expectSelectValue } from "./support/select-control.mjs";
import { test, expect } from './support/extension-fixture.mjs';

async function openInput(h) {
  await h.driver.reload();
  await h.driver.locator('#inputTranslation').click();
  await expect.poll(() => h.context.pages().find(page => page.url().endsWith('/input-translation.html'))?.url()).toBeTruthy();
  const page = h.context.pages().find(page => page.url().endsWith('/input-translation.html'));
  await expect(page.locator('#input')).toBeEnabled();
  return page;
}
async function setup(h) {
  await h.reset();
  await h.driver.evaluate(() => chrome.storage.session.clear());
  await h.setStorage({ uiLocale: 'zh_CN', providerConnectionsVersion: 1,
    providerConnections: { local: { id: 'local', revision: 1, name: 'Local AI', platform: 'custom', protocol: 'openai-chat', baseUrl: h.server.baseUrl + '/v1', credentialId: 'local', defaultModel: 'mock-model', settings: { allowEmptyApiKey: true, allowInsecureHttp: true } } },
    providerCredentials: { local: '' }, defaultService: { kind: 'api-key', connectionId: 'local' } });
}
async function translate(page, text) { await page.locator('#input').fill(text); await page.locator('#send').click(); }

test('input window opens on protected pages, translates, refines only the selected turn and copies plain text', async ({ harness: h }, info) => {
  await setup(h);
  const protectedPage = await h.context.newPage(); await protectedPage.goto('chrome://extensions/'); await protectedPage.bringToFront();
  const page = await openInput(h);
  expect(h.server.calls).toHaveLength(0);
  await page.setViewportSize({ width: 580, height: 760 });
  await expect(page.locator('#input')).toBeFocused();
  await page.screenshot({ path: info.outputPath('input-empty.png') });
  await h.driver.locator('#inputTranslation').click();
  expect(h.context.pages().filter(p => p.url().endsWith('/input-translation.html'))).toHaveLength(1);
  await chooseSelect(page.locator('#target'), 'English');
  const original = 'Could we move the meeting to tomorrow afternoon?';
  await translate(page, original);
  await expect(page.locator('#status')).toHaveText('翻译完成');
  await expect(page.locator('.answer')).toContainText(original);
  expect(h.server.calls).toHaveLength(1);
  await page.getByRole('button', { name: '复制译文', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('译文已复制');
  await page.locator('#input').focus(); await page.keyboard.press('Control+v');
  await expect(page.locator('#input')).toHaveValue(await page.locator('.answer').innerText());
  await page.locator('#input').fill('A separate draft to preserve.');
  await page.getByRole('button', { name: '继续调整', exact: true }).click();
  await expect(page.locator('#adjust-bar')).toBeVisible();
  await page.locator('#input').fill('Make this more polite.');
  await page.locator('#input').press('Control+Enter');
  await expect(page.locator('.answer')).toHaveCount(2);
  await expect(page.locator('#status')).toHaveText('翻译完成');
  expect(h.server.calls[1].segments[0].text).toBe(original);
  expect(h.server.calls[1].systemPrompt).toContain('Make this more polite.');
  expect(h.server.calls[1].systemPrompt).toContain('previousTranslation');
  await expect(page.locator('#input')).toHaveValue('A separate draft to preserve.');
  await translate(page, 'A completely unrelated second message.');
  await expect(page.locator('#status')).toHaveText('翻译完成');
  expect(h.server.calls).toHaveLength(3);
  expect(h.server.calls[2].systemPrompt).not.toContain(original);
  expect(h.server.calls[2].systemPrompt).not.toContain('Make this more polite.');
  expect(await h.runtime({ type: 'CACHE_STATS' })).toMatchObject({ ok: true, segmentCount: 0 });
  expect(await h.getStorage(['inputTranslationSessionV1'])).toEqual({});
  await page.screenshot({ path: info.outputPath('input-results.png') });
  await page.locator('#input').fill('Draft after completed translations.');
  await expect.poll(() => page.evaluate(async () => (await chrome.storage.session.get('inputTranslationSessionV1')).inputTranslationSessionV1?.draft)).toBe('Draft after completed translations.');
  await page.close();
  const reopened = await openInput(h);
  await expect(reopened.locator('#input')).toHaveValue('Draft after completed translations.');
  await expect(reopened.locator('.answer')).toHaveCount(3);
  await expect(reopened.locator('#target')).toHaveValue('English');
  expect(h.server.calls).toHaveLength(3);
  reopened.once('dialog', dialog => dialog.accept()); await reopened.locator('#clear').click();
  await expect(reopened.locator('.turn')).toHaveCount(0); await expect(reopened.locator('#input')).toHaveValue('');
  await expect.poll(() => reopened.evaluate(async () => (await chrome.storage.session.get('inputTranslationSessionV1')).inputTranslationSessionV1?.turns.length)).toBe(0);
  await reopened.reload(); await expect(reopened.locator('.turn')).toHaveCount(0);
  await reopened.close(); await protectedPage.close();
});

test('input failures retry in place; stop and close prevent late results and preserve input', async ({ harness: h }, info) => {
  await setup(h); const page = await openInput(h);
  h.server.setFailures([401]); await translate(page, 'Recoverable input.');
  await expect(page.locator('.answer.error')).toBeVisible();
  await expect(page.locator('.source-text')).toHaveText('Recoverable input.');
  await page.screenshot({ path: info.outputPath('input-failure.png') });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('翻译完成');
  await expect(page.locator('.turn')).toHaveCount(1);
  expect(h.server.calls).toHaveLength(2);
  h.server.setDelay(3000);
  await translate(page, 'Cancel this request.');
  await expect.poll(() => h.server.calls.length).toBe(3);
  await page.locator('#input').fill('Keep my next draft.');
  await page.locator('#stop').click();
  await expect(page.locator('#status')).toHaveText('已停止，可按需重试。');
  await expect(page.locator('#input')).toHaveValue('Keep my next draft.');
  h.server.setDelay(0);
  await page.locator('#send').click(); await expect(page.locator('#status')).toHaveText('翻译完成');
  await expect(page.locator('.answer').nth(1)).toHaveText('已停止，可按需重试。');
  await expect(page.locator('.answer').nth(2)).toContainText('Keep my next draft.');
  h.server.setDelay(3000); await translate(page, 'Close while working.');
  await expect.poll(() => h.server.calls.length).toBe(5);
  await page.close();
  const reopened = await openInput(h);
  await expect(reopened.locator('.answer').last()).toHaveText('翻译已中断，输入内容已保留。');
  expect(h.server.calls).toHaveLength(5);
  await reopened.close(); h.server.setDelay(0);
});

test('input window respects IME, language/service selection, text limits and narrow dark layout', async ({ harness: h }, info) => {
  await setup(h); const page = await openInput(h);
  await expect(page.locator('#service option')).toHaveCount(2);
  await chooseSelect(page.locator('#service'), { index: 1 });
  await page.locator('#input').fill('Draft typed with an IME.');
  await page.locator('#input').dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(h.server.calls).toHaveLength(0);
  await page.locator('#input').fill('x'.repeat(6001)); await expect(page.locator('#send')).toBeDisabled();
  await page.locator('#input').fill('A short message for a colleague.');
  await page.locator('#brief summary').click(); await page.locator('#requirement').fill('Keep a friendly tone.');
  for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.locator('#send').focus();
    expect(await page.locator('#send').evaluate(node => {
      const r = node.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.top >= 0;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('input-narrow-' + colorScheme + '.png') });
  }
  await page.locator('#send').click(); await expect(page.locator('#status')).toHaveText('翻译完成');
  expect(h.server.calls).toHaveLength(1);
  expect(h.server.calls[0].systemPrompt).toContain('Keep a friendly tone.');
  const storage = await h.getStorage(['targetLanguage', 'defaultService']);
  expect(storage.targetLanguage).toBe('Simplified Chinese');
  await page.close();
});
