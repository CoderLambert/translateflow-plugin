import { test, expect } from "./support/extension-fixture.mjs";

test.describe("API key provider connections", () => {
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  for (const scenario of [
    { platform: "ollama", name: "Ollama (local)", keyless: true },
    { platform: "lmstudio", name: "LM Studio", keyless: true },
    { platform: "ollama-cloud", name: "Ollama Cloud", keyless: false }
  ]) {
    test(`${scenario.name} saves, tests, translates and survives a settings reload`, async ({ harness }, testInfo) => {
      const options = await harness.context.newPage();
      await options.setViewportSize({ width: 390, height: 820 });
      await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
      const editor = options.locator("form.connection-editor");
      await editor.locator("#connectionPlatform").selectOption(scenario.platform);
      await expect(editor.getByLabel("本地服务允许空 API Key")).toBeChecked({ checked: scenario.keyless });
      await expect(editor.getByLabel("本地或自托管服务允许 HTTP")).toBeChecked({ checked: scenario.keyless });
      await expect(editor.locator("#connectionHelp")).not.toBeEmpty();
      await editor.scrollIntoViewIfNeeded();
      await options.screenshot({ path: testInfo.outputPath(`${scenario.platform}-editor.png`), fullPage: true });
      // The named presets canonicalize a service root to the OpenAI /v1 endpoint.
      await editor.locator("#connectionBaseUrl").fill(harness.server.baseUrl);
      await editor.locator("#connectionModel").fill("user/model:custom-tag");
      if (!scenario.keyless) {
        await editor.getByLabel("本地或自托管服务允许 HTTP").check();
        await editor.locator("#connectionApiKey").fill("cloud-e2e-synthetic-key");
      }
      await editor.getByRole("button", { name: "保存连接" }).click();
      await expect(options.locator("#status")).toContainText(`已保存连接：${scenario.name}`);
      const saved = (await harness.getStorage(["providerConnections"])).providerConnections[scenario.platform];
      expect(saved).toMatchObject({ baseUrl: `${harness.server.baseUrl}/v1`, defaultModel: "user/model:custom-tag",
        settings: { allowEmptyApiKey: scenario.keyless } });
      const card = options.locator(".connection-card").filter({ hasText: scenario.name });
      await card.getByRole("button", { name: "测试", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("模型返回：OK");
      await options.locator("#defaultService").selectOption(`api-key:${scenario.platform}`);
      await expect(options.locator("#status")).toContainText("默认翻译服务已更新");

      harness.server.reset();
      const article = await harness.open("/article");
      await harness.inject(article);
      const translated = await harness.sendContent(article, "ABT_TRANSLATE_PAGE", { taskId: `preset-${scenario.platform}` });
      expect(translated).toMatchObject({ ok: true, apiTranslated: 3 });
      await expect(article.locator("[data-abt-translated='1']")).toHaveCount(3);
      expect(harness.server.calls).toHaveLength(2);
      expect(harness.server.calls.every(call => call.model === "user/model:custom-tag")).toBe(true);
      await options.reload();
      await expect(options.locator("#defaultService")).toHaveValue(`api-key:${scenario.platform}`);
      await options.locator(".connection-card").filter({ hasText: scenario.name }).getByRole("button", { name: "编辑" }).click();
      await expect(editor.locator("#connectionModel")).toHaveValue("user/model:custom-tag");
      await expect(editor.locator("#connectionApiKey")).toHaveValue("");
      expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await options.close();
      await article.close();
    });
  }

  // Opt-in only: uses an already installed local model, never a signed-in cloud model.
  if (process.env.TF_OLLAMA_REAL_MODEL) {
    test("real local Ollama translates through the installed MV3 package", async ({ harness }, testInfo) => {
      test.setTimeout(120_000);
      const model = process.env.TF_OLLAMA_REAL_MODEL;
      const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
      expect(response.ok).toBe(true);
      const installed = (await response.json()).models.find(item => item.name === model);
      expect(installed, "The model must already be installed; this test never downloads models").toBeTruthy();
      expect(installed.remote_host || installed.remote_model, "Cloud-backed Ollama models require separate authorization").toBeFalsy();

      const options = await harness.context.newPage();
      await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
      const editor = options.locator("form.connection-editor");
      await editor.locator("#connectionPlatform").selectOption("ollama");
      await editor.locator("#connectionModel").fill(model);
      await editor.getByRole("button", { name: "保存连接" }).click();
      const card = options.locator(".connection-card").filter({ hasText: "Ollama (local)" });
      await card.getByRole("button", { name: "测试", exact: true }).click();
      const feedback = card.locator(".connection-test-status");
      await expect(feedback).toBeVisible();
      await expect(feedback).not.toHaveAttribute("data-kind", "loading", { timeout: 60_000 });
      await card.screenshot({ path: testInfo.outputPath("real-ollama-connection.png") });
      await testInfo.attach("real-local-connection-result", { body: JSON.stringify({ model,
        kind: await feedback.getAttribute("data-kind"), message: await feedback.innerText() }), contentType: "application/json" });
      await expect(feedback).toContainText("模型返回：OK");
      await options.locator("#defaultService").selectOption("api-key:ollama");
      await expect(options.locator("#status")).toContainText("默认翻译服务已更新");

      const article = await harness.open("/article");
      await article.evaluate(() => {
        document.body.innerHTML = '<main><p id="real-ollama-source">This morning, the sun is shining and the weather is warm.</p></main>';
      });
      await harness.inject(article);
      const translated = await harness.sendContent(article, "ABT_TRANSLATE_PAGE", { taskId: "ollama-real-public-sentence" });
      expect(translated).toMatchObject({ ok: true, apiTranslated: 1 });
      await expect(article.locator(".abt-translation")).toHaveCount(1);
      const text = await article.locator(".abt-translation").innerText();
      expect(text).toMatch(/[\u4e00-\u9fff]/u);
      expect(harness.server.calls).toHaveLength(0);
      await article.screenshot({ path: testInfo.outputPath("real-ollama-translation.png") });
      await testInfo.attach("real-local-result", { body: JSON.stringify({ model, translated: text, mockCalls: 0 }), contentType: "application/json" });
      await options.close();
      await article.close();
    });
  }

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
    await expect(anthropicCard.getByRole("status")).toContainText("模型返回：OK");
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
    expect(harness.server.calls).toHaveLength(2);
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
