import { mkdir } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

const machine = providerId => ({ version: 2, routing: "fixed", mode: "free-online", providerId, sourceLanguage: "auto" });
const evidence = "docs/task-execution/local/free-online-mt";

// Only the external transport is synthetic; production router/config/cache/DOM/UI
// bytes are unchanged. These tests do not claim live service availability.
async function installTransport(harness) {
  await harness.serviceWorker.evaluate(() => {
    const previous = globalThis.__mtOriginalFetch || fetch;
    globalThis.__mtOriginalFetch = previous;
    globalThis.__mtProbe = { calls: [], aborted: 0, mode: "ok" };
    globalThis.fetch = async (url, init) => {
      const origin = new URL(String(url)).origin;
      if (!["https://edge.microsoft.com", "https://transmart.qq.com"].includes(origin)) return previous(url, init);
      const probe = globalThis.__mtProbe, microsoft = origin === "https://edge.microsoft.com";
      const body = JSON.parse(init.body), texts = microsoft ? body : body.source.text_list;
      probe.calls.push({ origin, texts, credentials: init.credentials, redirect: init.redirect, headers: init.headers });
      if (probe.mode === "hold") await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => { probe.aborted++; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      if (probe.mode === "malformed") return Response.json(microsoft ? [] : { header: { ret_code: "succ" }, auto_translation: [] });
      const result = texts.map(text => `${microsoft ? "微软译文" : "腾讯译文"}：${text}`);
      return Response.json(microsoft ? result.map(text => ({ translations: [{ text }] })) : { header: { ret_code: "succ" }, auto_translation: result });
    };
  });
}
const probe = harness => harness.serviceWorker.evaluate(() => globalThis.__mtProbe);
async function noAi(harness, providerId = "mt-microsoft-web") {
  await harness.setStorage({ provider: "deepseek", apiKey: "", providerConnections: {}, providerCredentials: {}, defaultService: null,
    aiServiceConfigured: null, openAICompatible: { apiKey: "", baseUrl: "", model: "" }, dictionaryEnabled: false,
    machineTranslation: machine(providerId), translationPreferences: { version: 1, wordMethod: "free-online", textMethod: "free-online" },
    machineTranslationConsent: { version: 1, routing: "fixed", providerId } });
}
async function select(page, selector) {
  await page.locator(selector).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.locator(".tf-selection-chip")).toBeVisible(); await page.locator(".tf-selection-chip").click();
}
async function recording(harness) {
  const center = await harness.context.newPage(); await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  const send = (method, body = {}) => center.evaluate(message => chrome.runtime.sendMessage(message), { protocolVersion: 2, method, ...body });
  const state = await send("reading.get-recording-state"); expect(state.ok).toBe(true);
  expect((await send("reading.set-recording", { enabled: true, expectedConsentGeneration: state.data.consentGeneration })).ok).toBe(true);
  return { center, send };
}

test.beforeEach(async ({ harness }) => { await harness.reset(); await installTransport(harness); await mkdir(evidence, { recursive: true }); });

test("legacy mode remains AI; free setting reads never trigger a translation", async ({ harness }) => {
  const before = await harness.getStorage(["providerConnections", "defaultService"]);
  const meta = await harness.runtime({ type: "MACHINE_TRANSLATION_GET" }); expect(meta.ok).toBe(true); expect(meta.config.mode).toBe("legacy");
  expect((await probe(harness)).calls).toHaveLength(0);
  const page = await harness.open("/article"); await harness.inject(page);
  const result = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-legacy" }); expect(result.ok).toBe(true);
  expect(harness.server.calls.length).toBeGreaterThan(0); expect((await probe(harness)).calls).toHaveLength(0);
  expect((await harness.getStorage(["defaultService"])).defaultService || before.defaultService).toBeTruthy(); await page.close();
});

test("Microsoft page translation protects inline code/links, restores cache and Tencent stays isolated", async ({ harness }) => {
  await noAi(harness);
  const page = await harness.open("/article");
  await page.evaluate(() => { document.body.innerHTML = '<main><p id="mt-rich">Read <code>privateCode()</code> with <kbd>Ctrl+K</kbd>, <strong>careful attention</strong> and <a href="https://example.invalid/private?token=synthetic">the documentation</a>.</p><p id="mt-plain">Read https://docs.example.invalid/private?token=visible and email admin@example.invalid before continuing. Localhost localhost:3000/private?token=local, IPv6 [fd00::1]:8080/private?token=ipv6, repository git@github.com:private/repo.</p></main>'; });
  await harness.inject(page);
  const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-page" }); expect(translated.ok).toBe(true);
  await expect(page.locator(".abt-translation")).toHaveCount(2);
  await expect(page.locator(".abt-translation code")).toHaveText("privateCode()");
  await expect(page.locator(".abt-translation kbd")).toHaveText("Ctrl+K");
  await expect(page.locator(".abt-translation a")).toHaveAttribute("href", "https://example.invalid/private?token=synthetic");
  const first = await probe(harness); expect(first.calls.length).toBeGreaterThan(0);
  expect(JSON.stringify(first.calls)).not.toMatch(/privateCode|TF:|token=synthetic/);
  // Visible address text, not only href attributes, stays inside the browser.
  expect(JSON.stringify(first.calls)).not.toMatch(/docs\.example\.invalid|token=visible|admin@example\.invalid|localhost:3000|token=local|fd00::1|token=ipv6|git@github\.com|private\/repo/);
  await expect(page.locator(".abt-translation").nth(1)).toContainText("https://docs.example.invalid/private?token=visible");
  await expect(page.locator(".abt-translation").nth(1)).toContainText("admin@example.invalid");
  await expect(page.locator(".abt-translation").nth(1)).toContainText("localhost:3000/private?token=local");
  await expect(page.locator(".abt-translation").nth(1)).toContainText("[fd00::1]:8080/private?token=ipv6");
  await expect(page.locator(".abt-translation").nth(1)).toContainText("git@github.com:private/repo");
  expect(first.calls.every(item => item.credentials === "omit" && item.redirect === "error")).toBe(true);
  expect(harness.server.calls).toHaveLength(0);
  await harness.sendContent(page, "ABT_RESTORE_CACHE"); expect((await probe(harness)).calls.length).toBe(first.calls.length);
  await harness.setStorage({ machineTranslation: machine("mt-tencent-transmart"), machineTranslationConsent: { version: 1, routing: "fixed", providerId: "mt-tencent-transmart" } });
  const tx = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-tencent" }); expect(tx.ok).toBe(true);
  await expect(page.locator(".abt-translation").first()).toContainText("腾讯译文");
  const count = (await probe(harness)).calls.length;
  await harness.setStorage({ machineTranslation: machine("mt-microsoft-web"), machineTranslationConsent: { version: 1, routing: "fixed", providerId: "mt-microsoft-web" } });
  await harness.sendContent(page, "ABT_RESTORE_CACHE"); await expect(page.locator(".abt-translation").first()).toContainText("微软译文");
  expect((await probe(harness)).calls.length).toBe(count);
  await page.screenshot({ path: `${evidence}/page-mocked-transport.png` }); await page.close();
});

test("Selection stores a translation artifact, survives reload, and history reads stay local", async ({ harness }) => {
  await noAi(harness); const { center, send } = await recording(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("微软译文");
  let items = [];
  await expect.poll(async () => { const response = await send("reading.list-records", { pageKey: null, query: "", cursor: null, limit: 100 }); items = response.data?.items || []; return items.length; }).toBeGreaterThan(0);
  const count = (await probe(harness)).calls.length;
  const detail = await send("reading.get-record", { recordId: items[0].recordId }); expect(detail.ok).toBe(true);
  expect(JSON.stringify(detail)).toContain("mt-microsoft-web"); expect(JSON.stringify(detail)).toContain("mt-adapter-v1");
  await page.reload(); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("微软译文");
  expect((await probe(harness)).calls.length).toBe(count); expect(harness.server.calls).toHaveLength(0);
  await harness.setStorage({ machineTranslation: machine("mt-tencent-transmart"), machineTranslationConsent: { version: 1, routing: "fixed", providerId: "mt-tencent-transmart" } });
  await page.reload(); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("腾讯译文");
  const switchedCalls = (await probe(harness)).calls;
  expect(switchedCalls.length).toBeGreaterThan(count);
  expect(switchedCalls.at(-1).origin).toBe("https://transmart.qq.com");
  expect(harness.server.calls).toHaveLength(0);
  await page.screenshot({ path: `${evidence}/selection-mocked-transport.png` }); await page.close(); await center.close();
});

test("Options applies a consented free service, tests it and preserves AI credentials after reload", async ({ harness }) => {
  const page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/options.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
  const original = await harness.getStorage(["apiKey", "openAICompatible", "defaultService"]);
  await expect(page.locator('.mt-text-method input[value="ai"]')).toBeChecked();
  await page.locator('.mt-text-method input[value="free-online"]').check(); await page.locator(".mt-manual > summary").click(); await page.locator("#mt-provider").selectOption("mt-tencent-transmart");
  // Saving a method is separate from consenting to upload text.
  await expect(page.locator("#mt-save")).toBeEnabled();
  await page.locator("#mt-save").click(); await expect(page.locator(".mt-settings [role=status]").last()).toContainText("翻译偏好已保存");
  expect((await probe(harness)).calls).toHaveLength(0);
  expect((await harness.getStorage(["machineTranslationConsent"])).machineTranslationConsent).toBeNull();
  await page.locator("#mt-consent").check();
  await page.locator("#mt-save").click(); await expect(page.locator(".mt-settings [role=status]").last()).toContainText("翻译偏好已保存");
  await page.locator("#mt-test").click(); await expect(page.locator(".mt-test-result")).toContainText("腾讯译文");
  const count = (await probe(harness)).calls.length;
  await page.reload(); await expect(page.locator("#mt-provider")).toHaveValue("mt-tencent-transmart");
  expect((await probe(harness)).calls.length).toBe(count);
  const stored = await harness.getStorage(["apiKey", "openAICompatible", "defaultService"]); expect(stored).toEqual(original);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/settings-narrow.png`, fullPage: true }); await page.close();
});

test("Popup can choose a free site service even when AI is unconfigured", async ({ harness }) => {
  await noAi(harness); await harness.setStorage({ machineTranslation: { ...machine("mt-microsoft-web"), mode: "legacy" } });
  const page = await harness.open("/article"); await harness.inject(page); await page.bringToFront(); await harness.driver.reload();
  await expect(harness.driver.locator("#mt-site-mode")).toBeEnabled(); await harness.driver.locator("#mt-site-mode").selectOption("free-online"); await harness.driver.locator(".mt-manual > summary").click(); await harness.driver.locator("#mt-site-provider").selectOption("mt-microsoft-web");
  await harness.driver.locator(".mt-popup input[type=checkbox]").check(); await expect(harness.driver.locator("#translate")).toHaveText("应用并翻译"); await harness.driver.locator("#translate").click();
  await expect(harness.driver.locator("#contextMode")).toHaveText("免费在线");
  await expect(harness.driver.locator("#contextProvider")).toHaveText("Microsoft");
  await expect(harness.driver.locator("#contextModel")).toHaveCount(0);
  await expect(page.locator(".abt-translation").first()).toContainText("微软译文");
  await harness.driver.setViewportSize({ width: 360, height: 820 }); await harness.driver.screenshot({ path: `${evidence}/popup.png`, fullPage: true });
  expect(harness.server.calls).toHaveLength(0); await page.close();
});

test("cancellation aborts the real pending transport and invalid responses never enter cache", async ({ harness }) => {
  await noAi(harness); const page = await harness.open("/article"); await harness.inject(page);
  await harness.serviceWorker.evaluate(() => { globalThis.__mtProbe.mode = "hold"; });
  const pending = harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-cancel" });
  await expect.poll(async () => (await probe(harness)).calls.length).toBeGreaterThan(0);
  await harness.sendContent(page, "TF_CANCEL_TASK", { taskId: "mt-cancel" }); await pending;
  await expect.poll(async () => (await probe(harness)).aborted).toBeGreaterThan(0); await expect(page.locator(".abt-translation")).toHaveCount(0);
  await harness.serviceWorker.evaluate(() => { globalThis.__mtProbe.mode = "malformed"; });
  const bad = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-bad" }); expect(bad.ok).toBe(false);
  await expect(page.locator(".abt-translation")).toHaveCount(0); const before = (await probe(harness)).calls.length;
  await harness.sendContent(page, "ABT_RESTORE_CACHE"); expect((await probe(harness)).calls.length).toBe(before);
  expect(harness.server.calls).toHaveLength(0); await page.close();
});

test("navigating away aborts the tab-owned free MT request", async ({ harness }) => {
  await noAi(harness); const page = await harness.open("/article"); await harness.inject(page);
  await harness.serviceWorker.evaluate(() => { globalThis.__mtProbe.mode = "hold"; });
  const pending = harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-navigation" })
    .then(() => ({ resolved: true }), error => ({ error: String(error) }));
  await expect.poll(async () => (await probe(harness)).calls.length).toBeGreaterThan(0);
  await page.goto(new URL("/selection?navigation=mt", page.url()).href);
  const outcome = await pending;
  expect(outcome).toHaveProperty("error");
  expect(outcome.error).toMatch(/message channel closed/i);
  await expect.poll(async () => (await probe(harness)).aborted).toBeGreaterThan(0);
  expect(await page.locator(".abt-translation").count()).toBe(0);
  expect(harness.server.calls).toHaveLength(0);
  await page.close();
});

for (const providerId of ["mt-microsoft-web", "mt-tencent-transmart"]) {
  test(`saved dictionary-first preference prevents ${providerId} calls on a rich word hit`, async ({ harness }, testInfo) => {
    await noAi(harness, providerId);
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({ name: "local-first.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["mtlocalfixture", "<p>Local dictionary preferred fixture</p>"]], { title: "Local first fixture", styleSheet: "" }) });
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成");
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#general`);
    await options.getByRole("radio", { name: "词典", exact: true }).check();
    await options.locator("#mt-save").click();
    await expect.poll(async () => (await harness.getStorage(["translationPreferences"])).translationPreferences.wordMethod).toBe("dictionary");
    const page = await harness.open("/selection");
    await page.locator("#technical-competition").evaluate(node => { node.textContent = "mtlocalfixture"; });
    await harness.inject(page); await select(page, "#technical-competition");
    const rich = page.locator(".tf-selection-rich-record").filter({ hasText: "Local first fixture" });
    await expect(rich).toContainText("Local dictionary preferred fixture");
    expect((await probe(harness)).calls).toHaveLength(0);
    expect(harness.server.calls).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("dictionary-first-no-mt.png") });
    await page.keyboard.press("Escape");
    await options.locator('input[name="word-method"]').first().check(); await options.locator("#mt-save").click();
    await expect.poll(async () => (await harness.getStorage(["translationPreferences"])).translationPreferences.wordMethod).toBe("free-online");
    await select(page, "#technical-competition");
    await expect(page.locator(".tf-selection-primary")).toContainText(providerId === "mt-microsoft-web" ? "微软译文" : "腾讯译文");
    const count = (await probe(harness)).calls.length;
    expect(count).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await options.getByRole("radio", { name: "词典", exact: true }).check(); await options.locator("#mt-save").click();
    await expect.poll(async () => (await harness.getStorage(["translationPreferences"])).translationPreferences.wordMethod).toBe("dictionary");
    await select(page, "#technical-competition");
    await expect(rich).toContainText("Local dictionary preferred fixture");
    expect((await probe(harness)).calls).toHaveLength(count);
    await page.keyboard.press("Escape");
    await page.locator("#technical-competition").evaluate(node => { node.textContent = "unknownmtfixture"; });
    await select(page, "#technical-competition");
    const translate = page.getByRole("button", { name: "使用普通翻译处理这个词", exact: true });
    await expect(translate).toHaveCount(0);
    expect((await probe(harness)).calls).toHaveLength(count);
    await page.getByText("切换方式", { exact: true }).click(); await page.getByRole("button", { name: "用免费在线查词", exact: true }).click();
    await expect(page.locator(".tf-selection-primary")).toContainText(providerId === "mt-microsoft-web" ? "微软译文" : "腾讯译文");
    expect((await probe(harness)).calls.length).toBeGreaterThan(count);
  });
}

async function installAutoTransport(harness, holdBackup = false) {
  await harness.serviceWorker.evaluate(hold => {
    globalThis.__mtProbe = { calls: [], aborted: 0, mode: 'auto' };
    globalThis.fetch = async (url, init) => {
      const host = new URL(url).hostname, probe = globalThis.__mtProbe;
      if (!['edge.microsoft.com','index-translate.bilibili.com','translate.googleapis.com','aidemo.youdao.com'].includes(host)) return globalThis.__mtOriginalFetch(url, init);
      probe.calls.push({ host });
      if (host === 'edge.microsoft.com') throw new TypeError('synthetic offline');
      if (hold) await new Promise((resolve,reject) => {
        globalThis.__mtRelease = resolve;
        init.signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), { once: true });
      });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '备用线路完成的译文。' } }] });
    };
  }, holdBackup);
}

test('automatic backup uses concrete provenance and DB4 cache without additional network on restore', async ({ harness }) => {
  await noAi(harness); await harness.setStorage({ machineTranslation: { ...machine('mt-microsoft-web'), routing: 'auto' }, machineTranslationConsent: { version: 1, routing: 'auto', providerId: 'mt-microsoft-web' } });
  await installAutoTransport(harness);
  const page = await harness.open('/article');
  await page.evaluate(() => { document.body.innerHTML = '<main><p>This is a public test paragraph for automatic backup translation.</p></main>'; });
  await harness.inject(page);
  const result = await harness.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'auto-page'});expect(result.ok).toBe(true);
  await expect(page.locator('.abt-translation')).toContainText('备用线路');
  await expect(page.locator('.abt-translation')).toHaveAttribute('data-provider-id','mt-bilibili');
  expect((await probe(harness)).calls.map(c=>c.host)).toEqual(['edge.microsoft.com','index-translate.bilibili.com']);
  const rules = await harness.serviceWorker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  const rule = rules.find(r => r.id === 12001);expect(rule.condition.initiatorDomains).toEqual([harness.extensionId]);
  const expression = new RegExp(rule.condition.regexFilter);
  expect(expression.test('https://index-translate.bilibili.com/v1/chat/completions')).toBe(true);
  for(const url of ['https://example.invalid/v1/chat/completions','https://index-translate.bilibili.com/v1/models','https://index-translate.bilibili.com/v1/chat/completions?x=1']) expect(expression.test(url)).toBe(false);
  expect(rule.condition.requestMethods).toEqual(['post']);
  await harness.sendContent(page,'ABT_CLEAR_TRANSLATIONS');
  await harness.sendContent(page,'ABT_RESTORE_CACHE');
  await expect(page.locator('.abt-translation')).toContainText('备用线路');
  expect((await probe(harness)).calls).toHaveLength(2);expect(harness.server.calls).toHaveLength(0);
  await page.screenshot({path:`${evidence}/automatic-backup.png`});await page.close();
});

test('clearing during backup preserves the displayed result but prevents repopulating DB4', async ({ harness }) => {
  await noAi(harness); await harness.setStorage({ machineTranslation: { ...machine('mt-microsoft-web'), routing: 'auto' }, machineTranslationConsent: { version: 1, routing: 'auto', providerId: 'mt-microsoft-web' } });
  await installAutoTransport(harness,true);
  const page = await harness.open('/article');
  await page.evaluate(() => { document.body.innerHTML = '<main><p>This is a public paragraph for the cache clearing race.</p></main>'; });
  await harness.inject(page);
  const pending = harness.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'auto-clear'});
  await expect.poll(async () => (await probe(harness)).calls.length).toBe(2);
  expect((await harness.runtime({type:'CACHE_CLEAR_ALL'})).ok).toBe(true);
  await harness.serviceWorker.evaluate(() => globalThis.__mtRelease());
  expect((await pending).ok).toBe(true);await expect(page.locator('.abt-translation')).toContainText('备用线路');
  expect((await harness.runtime({type:'CACHE_STATS'})).segmentCount).toBe(0);
  await harness.sendContent(page,'ABT_CLEAR_TRANSLATIONS');await harness.sendContent(page,'ABT_RESTORE_CACHE');
  await expect(page.locator('.abt-translation')).toHaveCount(0);expect((await probe(harness)).calls).toHaveLength(2);await page.close();
});

test('automatic concrete cache survives worker and persistent-profile restart', async ({ harness }) => {
  await noAi(harness);await harness.setStorage({ machineTranslation: {...machine('mt-microsoft-web'), routing:'auto'}, machineTranslationConsent: { version: 1, routing: 'auto', providerId: 'mt-microsoft-web' } });
  await installAutoTransport(harness);
  let page=await harness.open('/article');
  const text='This is a public fixture paragraph that survives a worker restart.';
  await page.evaluate(value=>{document.body.innerHTML=`<main><p>${value}</p></main>`;},text);await harness.inject(page);
  expect((await harness.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'auto-restart'})).ok).toBe(true);
  expect((await harness.runtime({type:'CACHE_STATS'})).segmentCount).toBe(1);
  await harness.restartBrowser();await installTransport(harness);await installAutoTransport(harness);
  page=await harness.open('/article');await page.evaluate(value=>{document.body.innerHTML=`<main><p>${value}</p></main>`;},text);await harness.inject(page);
  expect((await harness.sendContent(page,'ABT_RESTORE_CACHE')).ok).toBe(true);
  await expect(page.locator('.abt-translation')).toContainText('备用线路');expect((await probe(harness)).calls).toHaveLength(0);await page.close();
});
