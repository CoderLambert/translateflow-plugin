import { chooseSelect, expectSelectValue } from "./support/select-control.mjs";
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
      await chooseSelect(editor.locator("#connectionPlatform"), scenario.platform);
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
      await editor.getByRole("button", { name: "保存 AI 服务" }).click();
      await expect(options.locator("#status")).toContainText(`已保存连接：${scenario.name}`);
      const saved = (await harness.getStorage(["providerConnections"])).providerConnections[scenario.platform];
      expect(saved).toMatchObject({ baseUrl: `${harness.server.baseUrl}/v1`, defaultModel: "user/model:custom-tag",
        settings: { allowEmptyApiKey: scenario.keyless } });
      const card = options.locator(".connection-card").filter({ hasText: scenario.name });
      await card.getByRole("button", { name: "测试", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("模型返回：OK");
      await chooseSelect(options.locator("#defaultService"), `api-key:${scenario.platform}`);
      await expect(options.locator("#status")).toContainText("默认翻译服务已更新");

      harness.server.reset();
      const article = await harness.open("/article");
      await harness.inject(article);
      const translated = await harness.sendContent(article, "ABT_TRANSLATE_PAGE", { taskId: `preset-${scenario.platform}` });
      // The restored general pipeline includes the readable "Fixture" heading.
      expect(translated).toMatchObject({ ok: true, apiTranslated: 4, missing: 0 });
      for (const id of ["intro", "rich", "cache"]) await expect(article.locator(`#${id} > .abt-translation`)).toHaveCount(1);
      await expect(article.locator("[data-abt-translated='1']")).toHaveCount(4);
      expect(harness.server.calls).toHaveLength(2);
      expect(harness.server.calls.every(call => call.model === "user/model:custom-tag")).toBe(true);
      await options.reload();
      await expectSelectValue(options.locator("#defaultService"), `api-key:${scenario.platform}`);
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
      await chooseSelect(editor.locator("#connectionPlatform"), "ollama");
      await editor.locator("#connectionModel").fill(model);
      await editor.getByRole("button", { name: "保存 AI 服务" }).click();
      const card = options.locator(".connection-card").filter({ hasText: "Ollama (local)" });
      await card.getByRole("button", { name: "测试", exact: true }).click();
      const feedback = card.locator(".connection-test-status");
      await expect(feedback).toBeVisible();
      await expect(feedback).not.toHaveAttribute("data-kind", "loading", { timeout: 60_000 });
      await card.screenshot({ path: testInfo.outputPath("real-ollama-connection.png") });
      await testInfo.attach("real-local-connection-result", { body: JSON.stringify({ model,
        kind: await feedback.getAttribute("data-kind"), message: await feedback.innerText() }), contentType: "application/json" });
      await expect(feedback).toContainText("模型返回：OK");
      await chooseSelect(options.locator("#defaultService"), "api-key:ollama");
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

    await expect(options.getByRole("heading", { name: "连接 AI 翻译服务" })).toBeVisible();
    const manifest = await options.evaluate(() => chrome.runtime.getManifest());
    if (manifest.version_name === `${manifest.version}-dev`) {
      await expect(options.getByRole("heading", { name: "Provider · ChatGPT 订阅" })).toBeVisible();
    } else {
      await expect(options.getByRole("link", { name: "GitHub 开发版及配置说明" })).toBeVisible();
      await expect(options.getByRole("heading", { name: "Provider · ChatGPT 订阅" })).toHaveCount(0);
    }
    await expect(options.locator(".connection-card").filter({ hasText: "OpenAI-compatible" })).toBeVisible();

    const editor = options.locator("form.connection-editor");
    await chooseSelect(editor.locator("#connectionPlatform"), "anthropic");
    await editor.locator("#connectionBaseUrl").fill(`${harness.server.baseUrl}/v1`);
    await editor.locator("#connectionModel").fill("claude-e2e");
    await editor.locator("#connectionApiKey").fill("anthropic-e2e-secret");
    await editor.getByLabel("本地或自托管服务允许 HTTP").check();
    await expect(editor.getByLabel("本地或自托管服务允许 HTTP")).toBeChecked();
    await editor.getByRole("button", { name: "保存 AI 服务" }).click();
    await expect(options.locator("#status")).toContainText("已保存连接：Anthropic");
    expect((await harness.getStorage(["providerConnections"])).providerConnections.anthropic.settings.allowInsecureHttp).toBe(true);

    const anthropicCard = options.locator(".connection-card").filter({ hasText: "Anthropic" });
    await expect(anthropicCard).toContainText("已保存 API Key");
    await anthropicCard.getByRole("button", { name: "测试" }).click();
    await expect(anthropicCard.getByRole("status")).toContainText("模型返回：OK");
    await expect(options.locator("#status")).toContainText("模型返回：OK");
    await chooseSelect(options.locator("#defaultService"), "api-key:anthropic");
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
    expect(translated).toMatchObject({ ok: true, apiTranslated: 4, missing: 0 });
    for (const id of ["intro", "rich", "cache"]) await expect(article.locator(`#${id} > .abt-translation`)).toHaveCount(1);
    await expect(article.locator("[data-abt-translated='1']")).toHaveCount(4);
    expect(harness.server.calls).toHaveLength(2);
    expect(harness.server.calls[0]).toMatchObject({ protocol: "anthropic-messages", headers: { xApiKey: "anthropic-e2e-secret" } });

    await options.reload();
    await expectSelectValue(options.locator("#defaultService"), "api-key:anthropic");
    await expect(options.locator("#connectionApiKey")).toHaveValue("");
    const reloadedCard = options.locator(".connection-card").filter({ hasText: "Anthropic" });
    await reloadedCard.getByRole("button", { name: "编辑" }).click();
    await options.getByLabel("保存时清除已保存的 API Key").check();
    await editor.getByRole("button", { name: "保存 AI 服务" }).click();
    await expect(options.locator("#status")).toContainText("已保存连接：Anthropic");
    const cleared = await options.evaluate(() => chrome.runtime.sendMessage({ type: "PROVIDER_CONNECTIONS_LIST" }));
    expect(cleared.connections.find(item => item.id === "anthropic").hasApiKey).toBe(false);
    await article.close();
    await options.close();
  });
});

test('reasoning settings survive reload and a real MV3 browser restart', async ({harness}, testInfo) => {
  await harness.reset();
  let options=await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
  const editor=options.locator('form.connection-editor');
  await chooseSelect(editor.locator('#connectionPlatform'),'ollama');
  await editor.locator('#connectionBaseUrl').fill(harness.server.baseUrl);
  await editor.locator('#connectionModel').fill('user/model:custom-tag');
  await expect(editor.locator('.connection-reasoning')).not.toHaveAttribute('open');
  await expect(editor.locator('#connectionReasoning')).not.toBeVisible();
  await expect(editor.locator('#connectionReasoningAdvanced')).toHaveCount(0);
  await editor.locator('.connection-reasoning summary').click();
  await chooseSelect(editor.locator('#connectionReasoning'),'effort');
  await chooseSelect(editor.locator('#connectionReasoningEffort'),'high');
  await expect(editor.getByText(/该模型的自定义选项尚未验证/)).toBeVisible();
  await editor.getByRole('button',{name:'保存 AI 服务'}).click();
  await expect(options.locator('#status')).toContainText('已保存连接');
  const stored=await harness.getStorage(['providerConnections']);
  expect(stored.providerConnections.ollama.settings.reasoning).toEqual({mode:'effort',effort:'high',advanced:true});
  await options.reload();
  await options.locator('.connection-card').filter({hasText:'Ollama (local)'}).getByRole('button',{name:'编辑'}).click();
  await expectSelectValue(options.locator('#connectionReasoning'),'effort');
  await expectSelectValue(options.locator('#connectionReasoningEffort'),'high');
  await harness.restartBrowser();
  options=await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
  const card=options.locator('.connection-card').filter({hasText:'Ollama (local)'});
  await card.getByRole('button',{name:'测试',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('模型返回：OK');
  await card.getByRole('button',{name:'编辑'}).click();
  await expect(options.locator('.connection-reasoning')).toHaveAttribute('open');
  await chooseSelect(options.locator('#connectionReasoning'),'default');
  await options.getByRole('button',{name:'保存 AI 服务'}).click();
  await expect(options.locator('#status')).toContainText('已保存连接');
  expect((await harness.getStorage(['providerConnections'])).providerConnections.ollama.settings.reasoning).toEqual({mode:'default'});
  await options.reload();
  await options.locator('.connection-card').filter({hasText:'Ollama (local)'}).getByRole('button',{name:'编辑'}).click();
  await expect(options.locator('.connection-reasoning')).not.toHaveAttribute('open');
  await options.setViewportSize({width: 1100, height: 1000});
  await options.locator('.connection-reasoning').scrollIntoViewIfNeeded();
  await options.screenshot({path: testInfo.outputPath('reasoning-default.png')});
});


test('fast and enhanced presets save and reach the MV3 provider without parameter confirmation', async ({harness}, testInfo) => {
  await harness.reset();
  const options = await harness.context.newPage();
  await options.setViewportSize({width:390,height:820});
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
  const editor = options.locator('form.connection-editor');
  await chooseSelect(editor.locator('#connectionPlatform'),'openai');
  await editor.locator('#connectionBaseUrl').fill(harness.server.baseUrl+'/v1');
  await editor.locator('#connectionModel').fill('gpt-5.1');
  await editor.locator('#connectionApiKey').fill('synthetic-preset-key');
  await editor.getByLabel('本地或自托管服务允许 HTTP').check();
  await expect(editor.locator('.connection-reasoning summary')).toHaveText('翻译模式：快速（推荐）');
  await expect(editor.locator('#connectionReasoningAdvanced')).toHaveCount(0);
  await editor.getByRole('button',{name:'保存 AI 服务'}).click();
  await expect(options.locator('#status')).toContainText('已保存连接');
  const card = options.locator('.connection-card').filter({hasText:'OpenAI'}).filter({hasText:'gpt-5.1'});
  await card.getByRole('button',{name:'测试',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('模型返回：OK');
  expect(harness.server.calls.at(-1)).toMatchObject({model:'gpt-5.1',reasoningEffort:'none'});
  await options.reload();
  await card.getByRole('button',{name:'编辑'}).click();
  await expect(editor.locator('.connection-reasoning')).not.toHaveAttribute('open');
  await editor.locator('.connection-reasoning').scrollIntoViewIfNeeded();
  await options.screenshot({path:testInfo.outputPath('fast-preset.png')});
  await editor.locator('.connection-reasoning summary').click();
  await chooseSelect(editor.locator('#connectionReasoning'),'enhanced');
  await editor.getByRole('button',{name:'保存 AI 服务'}).click();
  await expect(options.locator('#status')).toContainText('已保存连接');
  await card.getByRole('button',{name:'测试',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('模型返回：OK');
  expect(harness.server.calls.at(-1).reasoningEffort).toBe('medium');
  await options.reload();
  await card.getByRole('button',{name:'编辑'}).click();
  await expectSelectValue(editor.locator('#connectionReasoning'),'enhanced');
  await expect(editor.locator('#connectionReasoningEffort')).toHaveCount(0);
  await expect(editor.locator('#connectionReasoningBudget')).toHaveCount(0);
  await editor.locator('.connection-reasoning').scrollIntoViewIfNeeded();
  await options.screenshot({path:testInfo.outputPath('enhanced-preset.png')});
  await chooseSelect(editor.locator('#connectionReasoning'),'model-default');
  await editor.getByRole('button',{name:'保存 AI 服务'}).click();
  await expect(options.locator('#status')).toContainText('已保存连接');
  await card.getByRole('button',{name:'测试',exact:true}).click();
  await expect(card.getByRole('status')).toContainText('模型返回：OK');
  expect(harness.server.calls.at(-1).reasoningEffort).toBeUndefined();
  expect((await harness.getStorage(['providerConnections'])).providerConnections.openai.settings.reasoning).toEqual({mode:'model-default'});
  expect(await options.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await options.close();
});
