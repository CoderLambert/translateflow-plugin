import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { chooseSelect } from "./support/select-control.mjs";

const output = resolve("dist/store/screenshots");
async function capture(page, file) {
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: resolve(output, file) });
}

test("store guide, policy and configuration screenshots come from the actual extension UI", async ({ harness: h }) => {
  await h.reset();
  const page = await h.context.newPage();
  for (const [locale, language] of [["zh_CN", "zh"], ["en", "en"]]) {
    await h.setStorage({ uiLocale: locale });
    await page.goto(`chrome-extension://${h.extensionId}/options.html#help`);
    await expect(page.locator("#guide-title")).toBeVisible();
    await page.locator("#guide-tab-text").click();
    await expect(page.locator("#guide-panel-text")).toBeVisible();
    await expect(page.locator("#guide-panel-start")).toHaveCount(0);
    await capture(page, `${language}-guide.png`);
    await page.goto(`chrome-extension://${h.extensionId}/options.html#provider`);
    await expect(page.locator("#connectionPlatform")).toBeEnabled();
    await chooseSelect(page.locator("#connectionPlatform"), "openai");
    await page.locator(".connection-editor").scrollIntoViewIfNeeded();
    await capture(page, `${language}-service-setup.png`);
  }
  await page.goto(`chrome-extension://${h.extensionId}/options.html#developer`);
  const privacy = page.locator('a[href="assets/legal/privacy-en.html"]');
  const policyPromise = h.context.waitForEvent("page");
  await privacy.click();
  const policy = await policyPromise; await policy.waitForLoadState("domcontentloaded");
  await expect(policy.getByRole("heading", { level: 1 })).toHaveText("TranslateFlow Privacy Policy");
  expect(h.server.calls).toHaveLength(0);
  await policy.close(); await page.close();
});

test("fresh installation can configure a service, translate and reuse its cache after browser restart", async ({ harness: h }) => {
  await h.resetProfile();
  const page = await h.context.newPage();
  await page.goto(`chrome-extension://${h.extensionId}/options.html#help`);
  await expect(page.locator("#guide-title")).toBeVisible();
  expect(h.server.calls).toHaveLength(0);
  await page.goto(`chrome-extension://${h.extensionId}/options.html#provider`);
  await chooseSelect(page.locator("#connectionPlatform"), "lmstudio");
  await page.locator("#connectionBaseUrl").fill(h.server.baseUrl);
  await page.locator("#connectionModel").fill("new-user-model");
  await page.getByRole("button", { name: "保存 AI 服务", exact: true }).click();
  await expect(page.locator("#status")).toContainText("已保存连接");
  await chooseSelect(page.locator("#defaultService"), "api-key:lmstudio");
  await expect(page.locator("#status")).toContainText("默认翻译服务已更新");
  await page.goto(`chrome-extension://${h.extensionId}/options.html#general`);
  await page.getByRole("group", { name: "句段与全文翻译方式" }).locator('input[value="ai"]').check();
  await page.getByRole("group", { name: "单词查词方式" }).getByRole("radio", { name: "AI", exact: true }).check();
  await page.getByRole("button", { name: "保存翻译偏好", exact: true }).click();
  await expect(page.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
  const article = await h.open("/article"); await h.inject(article);
  const translated = await h.sendContent(article, "ABT_TRANSLATE_PAGE", { taskId: "fresh-first-result" });
  expect(translated, JSON.stringify(translated)).toMatchObject({ ok: true, apiTranslated: 3 });
  await expect(article.locator(".abt-translation")).toHaveCount(3);
  const calls = h.server.calls.length; expect(calls).toBeGreaterThan(0);
  await h.restartBrowser();
  const stored = await h.getStorage(["defaultService", "providerConnections"]);
  expect(stored.defaultService).toEqual({ kind: "api-key", connectionId: "lmstudio" });
  expect(stored.providerConnections.lmstudio.defaultModel).toBe("new-user-model");
  const reopened = await h.open("/article"); await h.inject(reopened);
  expect((await h.sendContent(reopened, "ABT_RESTORE_CACHE")).ok).toBe(true);
  await expect(reopened.locator(".abt-translation")).toHaveCount(3);
  expect(h.server.calls).toHaveLength(calls);
  await reopened.close();
});

test("store page and text screenshots use the authorized real local model with public text", async ({ harness: h }) => {
  test.skip(process.env.TF_STORE_REAL_MODEL !== "1", "Explicit local-model acceptance only");
  test.setTimeout(150_000);
  await h.reset();
  await h.setStorage({ uiLocale: "zh_CN", aiServiceConfigured: true, providerConnectionsVersion: 1,
    providerConnections: { local: { id: "local", revision: 1, name: "Local translation", platform: "lmstudio", protocol: "openai-chat", baseUrl: "http://192.168.1.3:1234/v1", credentialId: "local", defaultModel: "hy-mt2-7b", settings: { allowEmptyApiKey: true, allowInsecureHttp: true } } },
    providerCredentials: { local: "" }, defaultService: { kind: "api-key", connectionId: "local" } });
  await h.serviceWorker.evaluate(() => {
    const original = globalThis.fetch; globalThis.__storeLocalCalls = 0;
    globalThis.fetch = (...args) => {
      if (String(args[0]).startsWith("http://192.168.1.3:1234/")) globalThis.__storeLocalCalls++;
      return original(...args);
    };
  });
  const page = await h.context.newPage(); await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("https://coderlambert.github.io/translateflow-plugin/demo.html");
  await h.inject(page);
  const result = await h.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "store-real-example" });
  expect(result.ok).toBe(true);
  await expect(page.locator(".abt-translation").first()).toContainText(/[\u4e00-\u9fff]/u);
  await capture(page, "zh-page-real-local.png");
  const callsBeforeRestore = await h.serviceWorker.evaluate(() => globalThis.__storeLocalCalls);
  expect(callsBeforeRestore).toBeGreaterThan(0);
  const restore = await h.sendContent(page, "ABT_RESTORE_CACHE");
  expect(restore.ok).toBe(true); expect(await h.serviceWorker.evaluate(() => globalThis.__storeLocalCalls)).toBe(callsBeforeRestore);
  await h.driver.reload(); await h.driver.locator("#inputTranslation").click();
  await expect.poll(() => h.context.pages().find(item => item.url().endsWith("/input-translation.html"))?.url()).toBeTruthy();
  const text = h.context.pages().find(item => item.url().endsWith("/input-translation.html"));
  await text.bringToFront();
  await text.setViewportSize({ width: 1280, height: 800 });
  await text.locator("#input").fill("Could we move our meeting to tomorrow afternoon? Please let me know what time works best for you.");
  await expect(text.locator("#send")).toBeEnabled();
  await expect(text.locator("#target")).toHaveValue("Simplified Chinese");
  await text.locator('[data-scene="email"]').click();
  await text.locator("#send").click();
  await expect(text.locator("#status")).toHaveText("翻译完成", { timeout: 60_000 });
  await expect(text.locator(".answer")).toContainText(/[\u4e00-\u9fff]/u);
  await capture(text, "zh-text-real-local.png");
  await h.setStorage({ uiLocale: "en" });
  await page.reload(); await h.inject(page);
  expect((await h.sendContent(page, "ABT_RESTORE_CACHE")).ok).toBe(true);
  await capture(page, "en-page-real-local.png");
  await text.reload(); await expect(text.locator(".answer")).toContainText(/[\u4e00-\u9fff]/u);
  await capture(text, "en-text-real-local.png");
  await writeFile(resolve(output, "real-model.json"), JSON.stringify({ service: "user-authorized local LM Studio", model: "hy-mt2-7b", page: "https://coderlambert.github.io/translateflow-plugin/demo.html", text: "public synthetic meeting request", mockedProviderCalls: h.server.calls.length }, null, 2));
  expect(h.server.calls).toHaveLength(0);
  await text.close(); await page.close();
});
