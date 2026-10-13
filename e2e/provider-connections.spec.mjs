import { test, expect } from "./support/extension-fixture.mjs";

test.describe("API key provider connections", () => {
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  test("saves an Anthropic connection, keeps its key private, and translates through the native protocol", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.setViewportSize({ width: 390, height: 820 });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);

    await expect(options.getByRole("heading", { name: "API Key 连接" })).toBeVisible();
    await expect(options.getByRole("heading", { name: "Provider · ChatGPT 订阅" })).toBeVisible();
    await expect(options.locator(".connection-card").filter({ hasText: "OpenAI-compatible" })).toBeVisible();

    const editor = options.locator("form.connection-editor");
    await editor.locator("#connectionPlatform").selectOption("anthropic");
    await editor.locator("#connectionBaseUrl").fill(`${harness.server.baseUrl}/v1`);
    await editor.locator("#connectionModel").fill("claude-e2e");
    await editor.locator("#connectionApiKey").fill("anthropic-e2e-secret");
    await editor.getByLabel("本地或自托管服务允许 HTTP").check();
    await expect(editor.getByLabel("本地或自托管服务允许 HTTP")).toBeChecked();
    await editor.getByRole("button", { name: "保存连接" }).click();
    await expect(options.locator("#status")).toContainText("已保存连接：Anthropic");
    expect((await harness.getStorage(["providerConnections"])).providerConnections.anthropic.settings.allowInsecureHttp).toBe(true);

    const anthropicCard = options.locator(".connection-card").filter({ hasText: "Anthropic" });
    await expect(anthropicCard).toContainText("已保存 API Key");
    await anthropicCard.getByRole("button", { name: "测试" }).click();
    await expect(options.locator("#status")).toContainText("模型返回：OK");
    await options.locator("#defaultService").selectOption("api-key:anthropic");
    await expect(options.locator("#status")).toContainText("默认翻译服务已更新");

    const overflow = await options.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);

    const listed = await options.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
    expect(listed.ok).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("anthropic-e2e-secret");
    expect(listed.connections.find(item => item.id === "anthropic")).toMatchObject({ hasApiKey: true, protocol: "anthropic-messages" });

    harness.server.reset();
    const article = await harness.open("/article");
    await harness.inject(article);
    const contentStorage = await harness.driver.evaluate(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: async () => {
        try { await chrome.storage.local.get(["providerCredentials"]); return { blocked: false }; }
        catch (error) { return { blocked: true, message: String(error?.message || error) }; }
      } });
      return result.result;
    }, await harness.tabId(article));
    expect(contentStorage.blocked).toBe(true);
    const translated = await harness.sendContent(article, "ABT_TRANSLATE_PAGE", { taskId: "provider-connections-anthropic" });
    expect(translated).toMatchObject({ ok: true, apiTranslated: 3 });
    await expect(article.locator("[data-abt-translated='1']")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0]).toMatchObject({ protocol: "anthropic-messages", headers: { xApiKey: "anthropic-e2e-secret" } });

    await options.reload();
    await expect(options.locator("#defaultService")).toHaveValue("api-key:anthropic");
    await expect(options.locator("#connectionApiKey")).toHaveValue("");
    const reloadedCard = options.locator(".connection-card").filter({ hasText: "Anthropic" });
    await reloadedCard.getByRole("button", { name: "编辑" }).click();
    await options.getByLabel("保存时清除已保存的 API Key").check();
    await editor.getByRole("button", { name: "保存连接" }).click();
    await expect(options.locator("#status")).toContainText("已保存连接：Anthropic");
    const cleared = await options.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
    expect(cleared.connections.find(item => item.id === "anthropic").hasApiKey).toBe(false);
    await article.close();
    await options.close();
  });
});
