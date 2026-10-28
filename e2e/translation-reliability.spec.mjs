import { test, expect } from './support/extension-fixture.mjs';

async function setup(harness, authFailure = false, pollution = 'fence') {
  await harness.reset();
  await harness.setStorage({ providerConnectionsVersion: 1,
    providerConnections: { local: { id: 'local', revision: 1, name: 'Synthetic local model', platform: 'lmstudio', protocol: 'openai-chat',
      baseUrl: `${harness.server.baseUrl}/v1`, credentialId: 'local', defaultModel: 'hy-mt2-7b',
      settings: { streaming: true, outputTokens: 4096, temperature: null, allowEmptyApiKey: true, allowInsecureHttp: true } } },
    providerCredentials: { local: '' }, defaultService: { kind: 'api-key', connectionId: 'local' } });
  await harness.serviceWorker.evaluate(({ authFailure, pollution }) => {
    globalThis.__reliabilityOriginalFetch = fetch;
    globalThis.__reliabilityCalls = [];
    globalThis.__reliabilityAuthFailure = authFailure;
    globalThis.fetch = async (...args) => {
      if (!String(args[0]).endsWith('/chat/completions')) return __reliabilityOriginalFetch(...args);
      const body = JSON.parse(args[1].body);
      const single = body.messages[0].content.includes('Source text:\n');
      const segments = single ? [{ id: 'single', text: body.messages[0].content.split('Source text:\n').at(-1) }]
        : JSON.parse(body.messages[0].content.split('Input JSON:\n').at(-1)).segments;
      __reliabilityCalls.push({ rich: segments.some(s => s.text.includes('[[TF_')), count: segments.length });
      if (__reliabilityAuthFailure) return new Response('{"error":{"message":"PRIVATE_UNTRUSTED_UPSTREAM_PAYLOAD"}}', { status: 401 });
      const translations = Object.fromEntries(segments.map(s => [s.id, `译文：${s.text.replace(/\[\[TF_\d+_E\]\]/u, '')}`]));
      if (segments.length > 1 && !segments.some(s => s.text.includes("[[TF_")) && !segments.every(s => s.id.includes(":part:"))) {
        translations[segments[0].id] = pollution === 'boundary' ? '污染译文。”},{'
          : pollution === 'numeric' ? '污染译文。“5”、“6”、“8”、“10”' : '污染译文```json{';
      }
      const content = single ? translations.single : JSON.stringify({ translations });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
    };
  }, { authFailure, pollution });
}
async function autoState(harness, page) {
  return harness.driver.evaluate(async tabId => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const s = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.runtime.state;
      return { paused: s.autoPausedForError === true, running: s.autoDrainRunning, pending: s.pending.size };
    } }); return result.result;
  }, await harness.tabId(page));
}
test.afterEach(async ({ harness }) => { await harness.serviceWorker.evaluate(() => { if (globalThis.__reliabilityOriginalFetch) fetch = __reliabilityOriginalFetch; }); });

for (const pollution of ['fence', 'boundary', 'numeric']) test(`local ${pollution} damage recovers in MV3, preserves links/code and restores cache without new requests`, async ({ harness }, testInfo) => {
  await setup(harness, false, pollution);
  const page = await harness.open('/article'); await harness.inject(page);
  const result = await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'local-format-recovery' });
  expect(result).toMatchObject({ ok: true, apiTranslated: 3 });
  await expect(page.locator('.abt-translation')).toHaveCount(3);
  await expect(page.locator('#rich .abt-translation code')).toHaveText('npm test');
  await expect(page.locator('#rich .abt-translation a')).toHaveAttribute('href', '/docs');
  await expect(page.locator('#rich .abt-translation')).not.toContainText('[[TF_');
  const calls = await harness.serviceWorker.evaluate(() => __reliabilityCalls);
  expect(calls.filter(call => call.rich)).toHaveLength(2); expect(calls).toHaveLength(7);
  for (const fragment of ['```json', '”},{', '“5”、“6”'])
    await expect(page.locator('.abt-translation').first()).not.toContainText(fragment);
  await harness.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  const restored = await harness.sendContent(page, 'ABT_RESTORE_CACHE');
  expect(restored).toMatchObject({ ok: true, cacheHits: 3 });
  expect(await harness.serviceWorker.evaluate(() => __reliabilityCalls.length)).toBe(calls.length);
  await page.screenshot({ path: testInfo.outputPath('local-format-recovery.png') });
  await page.close();
});

test('old polluted IndexedDB entries are skipped without requests and manual translation refills only misses', async ({ harness }, testInfo) => {
  await setup(harness);
  const page = await harness.open('/article'); await harness.inject(page);
  expect(await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'seed-valid-cache' })).toMatchObject({ ok: true, apiTranslated: 3 });
  const calls = await harness.serviceWorker.evaluate(() => __reliabilityCalls.length);
  const poisoned = await harness.serviceWorker.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('ai_bilingual_translator');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('entries', 'readwrite'), store = tx.objectStore('entries');
        let changed = 0;
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          const row = cursor.value;
          if (row.namespace === 'translation' && row.value.source.format === 'plain') {
            row.value.translation = changed++ === 0 ? '历史污染。”},{' : '历史污染。“5”、“6”、“8”';
            cursor.update(row);
          }
          cursor.continue();
        };
        tx.oncomplete = () => resolve(changed); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  expect(poisoned).toBe(2);
  await harness.sendContent(page, 'ABT_CLEAR_TRANSLATIONS');
  expect(await harness.sendContent(page, 'ABT_RESTORE_CACHE')).toMatchObject({ ok: true, cacheHits: 1 });
  expect(await harness.serviceWorker.evaluate(() => __reliabilityCalls.length)).toBe(calls);
  await expect(page.locator('.abt-translation')).toHaveCount(1);
  await expect(page.locator('#rich .abt-translation code')).toHaveText('npm test');
  expect(await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'refill-invalid-cache' })).toMatchObject({ ok: true, apiTranslated: 2 });
  await expect(page.locator('.abt-translation')).toHaveCount(3);
  expect(await harness.serviceWorker.evaluate(() => __reliabilityCalls.length)).toBe(calls + 4);
  await expect(page.locator('body')).not.toContainText('历史污染');
  await page.screenshot({ path: testInfo.outputPath('cache-quality-recovery.png') });
  await page.close();
});

test('automatic authentication failure pauses with safe feedback and manual success resumes it', async ({ harness }, testInfo) => {
  await setup(harness, true);
  const page = await harness.open('/article'); await harness.inject(page);
  await harness.sendContent(page, 'ABT_ENABLE_AUTO');
  await expect.poll(() => autoState(harness, page)).toMatchObject({ paused: true, running: false });
  expect(await harness.serviceWorker.evaluate(() => __reliabilityCalls.length)).toBe(1);
  await expect(page.getByText(/翻译服务认证失败/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('PRIVATE_UNTRUSTED');
  await page.screenshot({ path: testInfo.outputPath('automatic-safe-error.png') });
  await harness.serviceWorker.evaluate(() => { __reliabilityAuthFailure = false; });
  const retried = await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'manual-recovery' });
  expect(retried).toMatchObject({ ok: true, apiTranslated: 3 });
  await expect.poll(() => autoState(harness, page)).toMatchObject({ paused: false, running: false, pending: 0 });
  await expect(page.locator('.abt-translation')).toHaveCount(3);
  await page.close();
});
