import { mkdir } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";

const machine = providerId => ({ version: 1, mode: "free-online", providerId, sourceLanguage: "auto" });
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
    machineTranslation: machine(providerId) });
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
  await page.evaluate(() => { document.body.innerHTML = '<main><p id="mt-rich">Read <code>privateCode()</code> with <strong>careful attention</strong> and <a href="https://example.invalid/private?token=synthetic">the documentation</a>.</p><p id="mt-plain">Read https://docs.example.invalid/private?token=visible and email admin@example.invalid before continuing.</p></main>'; });
  await harness.inject(page);
  const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-page" }); expect(translated.ok).toBe(true);
  await expect(page.locator(".abt-translation")).toHaveCount(2);
  await expect(page.locator(".abt-translation code")).toHaveText("privateCode()");
  await expect(page.locator(".abt-translation a")).toHaveAttribute("href", "https://example.invalid/private?token=synthetic");
  const first = await probe(harness); expect(first.calls.length).toBeGreaterThan(0);
  expect(JSON.stringify(first.calls)).not.toMatch(/privateCode|TF:|token=synthetic/);
  // Visible address text, not only href attributes, stays inside the browser.
  expect(JSON.stringify(first.calls)).not.toMatch(/docs\.example\.invalid|token=visible|admin@example\.invalid/);
  await expect(page.locator(".abt-translation").nth(1)).toContainText("https://docs.example.invalid/private?token=visible");
  await expect(page.locator(".abt-translation").nth(1)).toContainText("admin@example.invalid");
  expect(first.calls.every(item => item.credentials === "omit" && item.redirect === "error")).toBe(true);
  expect(harness.server.calls).toHaveLength(0);
  await harness.sendContent(page, "ABT_RESTORE_CACHE"); expect((await probe(harness)).calls.length).toBe(first.calls.length);
  await harness.setStorage({ machineTranslation: machine("mt-tencent-transmart") });
  const tx = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "mt-tencent" }); expect(tx.ok).toBe(true);
  await expect(page.locator(".abt-translation").first()).toContainText("腾讯译文");
  const count = (await probe(harness)).calls.length;
  await harness.setStorage({ machineTranslation: machine("mt-microsoft-web") });
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
  await page.screenshot({ path: `${evidence}/selection-mocked-transport.png` }); await page.close(); await center.close();
});

test("Options applies a consented free service, tests it and preserves AI credentials after reload", async ({ harness }) => {
  const page = await harness.context.newPage(); await page.goto(`chrome-extension://${harness.extensionId}/options.html`);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
  const original = await harness.getStorage(["apiKey", "openAICompatible", "defaultService"]);
  await expect(page.locator("#mt-mode")).toHaveValue("legacy");
  await page.locator("#mt-mode").selectOption("free-online"); await page.locator("#mt-provider").selectOption("mt-tencent-transmart");
  await expect(page.locator("#mt-save")).toBeDisabled(); await page.locator("#mt-consent").check();
  await page.locator("#mt-save").click(); await expect(page.locator(".mt-settings [role=status]").last()).toContainText("翻译设置已应用");
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
  await harness.driver.locator(".mt-popup > summary").click();
  await expect(harness.driver.locator("#mt-site-provider")).toBeEnabled(); await harness.driver.locator("#mt-site-provider").selectOption("mt-microsoft-web");
  await harness.driver.locator(".mt-popup input[type=checkbox]").check(); await harness.driver.locator("#mt-site-save").click();
  await expect(harness.driver.locator("#contextMode")).toHaveText("免费在线");
  await expect(harness.driver.locator("#contextProvider")).toHaveText("Microsoft");
  await expect(harness.driver.locator("#contextModel")).toHaveCount(0);
  await harness.driver.locator("#translate").click(); await expect(page.locator(".abt-translation").first()).toContainText("微软译文");
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
