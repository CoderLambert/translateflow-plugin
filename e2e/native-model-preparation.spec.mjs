import { test, expect } from "./support/extension-fixture.mjs";

async function closeTestPages({ harness }) {
  // Close other documents in this case so only its Settings page can own the shared model host.
  for (const page of harness.context.pages()) if (page !== harness.driver) await page.close();
}
test.beforeEach(closeTestPages);
test.afterEach(closeTestPages);

async function openSettings(harness, options = {}) {
  await harness.reset();
  await harness.setStorage({ provider: "deepseek", apiKey: "", providerConnections: {}, providerCredentials: {}, defaultService: null,
    aiServiceConfigured: null, openAICompatible: { apiKey: "", baseUrl: "", model: "" }, dictionaryEnabled: false, browserTranslationEnabled: true, translationPreferences: { version: 1, wordMethod: "browser-local", textMethod: "browser-local" } });
  const page = await harness.context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ failures = 0, hold = false, supported = true }) => {
    const state = globalThis.__tfNativeSettings = { failures, hold, creates: [], destroyed: 0, inputs: [], pending: [] };
    const create = (kind, options) => {
      const attempt = state.creates.filter(item => item.kind === kind).length + 1;
      state.creates.push({ kind, attempt, activated: navigator.userActivation.isActive });
      options.monitor?.({ addEventListener(_name, listener) { listener({ loaded: .4 }); listener({ loaded: .8 }); } });
      const instance = { destroy() { state.destroyed++; },
        detect: async text => { state.inputs.push({ kind, text }); return [{ detectedLanguage: "en", confidence: .99 }]; },
        translate: async text => { state.inputs.push({ kind, text }); return `本地验证输出 ${attempt}:${text}`; } };
      if (kind === "translator" && state.failures > 0) {
        state.failures--;
        return Promise.reject(new DOMException("PRIVATE_ERROR_MESSAGE", "NotAllowedError"));
      }
      return state.hold ? new Promise(resolve => state.pending.push(() => resolve(instance))) : Promise.resolve(instance);
    };
    Object.defineProperty(globalThis, "LanguageDetector", { configurable: true, value: supported ? {
      availability: async () => "available", create: options => create("detector", options) } : undefined });
    Object.defineProperty(globalThis, "Translator", { configurable: true, value: supported ? {
      availability: async () => "available", create: options => create("translator", options) } : undefined });
  }, options);
  await page.goto(`chrome-extension://${harness.extensionId}/options.html#general`);
  const section = page.locator("#native-models");
  await expect(section).toBeVisible();
  return { page, section, errors };
}

test("Settings prepares both models with native Window timers and shares them across reading tabs", async ({ harness }, testInfo) => {
  const { page, section, errors } = await openSettings(harness);
  expect(await page.evaluate(() => __tfNativeSettings.creates)).toEqual([]);
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  await expect(section).toContainText("语言识别模型: 已通过校验");
  await expect(section).toContainText("翻译模型: 已通过校验");
  expect(await page.evaluate(() => __tfNativeSettings.creates)).toEqual([
    { kind: "detector", attempt: 1, activated: true }, { kind: "translator", attempt: 1, activated: true }
  ]);
  await section.screenshot({ path: testInfo.outputPath("native-models-ready.png") });
  // A hidden General panel must keep serving already-prepared models.
  await page.locator('.settings-nav a[href="#provider"]').click();
  await expect(section).toBeHidden();
  for (let i = 0; i < 2; i++) {
    const reader = await harness.open("/selection"); await harness.inject(reader);
    const tabId = await harness.tabId(reader);
    // Only the already-verified Settings host can serve these tabs.
    await harness.driver.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: () => {
      Object.defineProperty(globalThis, "Translator", { configurable: true, value: undefined });
      Object.defineProperty(globalThis, "LanguageDetector", { configurable: true, value: undefined });
    } }), tabId);
    await reader.locator("#technical-competition").evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await reader.locator(".tf-selection-chip").click();
    await expect(reader.locator(".tf-selection-primary")).toHaveText("本地验证输出 1:session");
    await reader.close();
  }
  expect(await page.evaluate(() => __tfNativeSettings.creates.length)).toBe(2);
  await page.locator('.settings-nav a[href="#general"]').click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  expect(harness.server.calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("Settings closes failed model states, shows safe diagnostics and retries successfully", async ({ harness }, testInfo) => {
  const { page, section, errors } = await openSettings(harness, { failures: 1 });
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByRole("button", { name: "重试准备", exact: true })).toBeEnabled();
  await expect(section).toContainText("翻译模型: 准备失败");
  await expect(section.getByRole("alert")).toHaveText("Chrome 未能完成本地模型准备，请重试或展开下方诊断信息。");
  await expect(section).not.toContainText("正在初始化");
  await section.getByText("Chrome 诊断信息", { exact: true }).click();
  await expect(section).toContainText("翻译模型 · BROWSER_PREPARE · NotAllowedError");
  await expect(section).not.toContainText("PRIVATE_ERROR_MESSAGE");
  await section.screenshot({ path: testInfo.outputPath("native-models-failed.png") });
  await section.getByRole("button", { name: "重试准备", exact: true }).click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  await expect(section.getByText("Chrome 诊断信息", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("cancelling and immediately retrying cannot display late model results", async ({ harness }) => {
  const { page, section, errors } = await openSettings(harness, { hold: true });
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByRole("progressbar")).toHaveCount(2);
  for (const progress of await section.getByRole("progressbar").all()) await expect(progress).toHaveAttribute("value", "0.8");
  await section.getByRole("button", { name: "取消", exact: true }).click();
  await expect(section).not.toContainText("正在初始化");
  await expect(section.getByRole("progressbar")).toHaveCount(0);
  await page.evaluate(() => { __tfNativeSettings.hold = false; });
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  const output = section.getByRole("textbox", { name: "本地模型实际输出" });
  await expect(output).toHaveValue(/^本地验证输出 2:/);
  await page.evaluate(() => { for (const resolve of __tfNativeSettings.pending.splice(0)) resolve(); });
  await expect.poll(() => page.evaluate(() => __tfNativeSettings.destroyed)).toBe(2);
  await expect(output).toHaveValue(/^本地验证输出 2:/);
  expect(errors).toEqual([]);
});

test("changing translation preferences preserves ready resources; changing the self-check pair clears stale verification", async ({ harness }) => {
  const { page, section, errors } = await openSettings(harness);
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  await page.getByRole("group", { name: "单词查词方式", exact: true }).getByRole("radio", { name: "词典", exact: true }).check();
  await page.getByRole("group", { name: "句段与全文翻译方式", exact: true }).getByRole("radio", { name: "免费在线", exact: true }).check();
  await page.locator("#mt-save").click();
  await expect(page.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => __tfNativeSettings.destroyed)).toBe(0);
  expect((await harness.getStorage(["translationPreferences"])).translationPreferences).toEqual({ version: 1, wordMethod: "dictionary", textMethod: "free-online" });
  await expect(page.locator("#browserTranslationEnabled")).toHaveCount(0);
  await section.getByRole("combobox", { name: "校验目标语言" }).selectOption("ja");
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toHaveCount(0);
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "准备并校验两个模型", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => __tfNativeSettings.creates.length)).toBe(2);
  expect(harness.server.calls).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("unsupported Settings APIs keep preparation disabled without model creation", async ({ harness }) => {
  const { page, section, errors } = await openSettings(harness, { supported: false });
  await expect(section).toContainText("当前设置页面未提供所需的两个 Chrome API");
  await expect(section.getByRole("button", { name: "准备并校验两个模型", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => __tfNativeSettings.creates)).toEqual([]);
  expect(errors).toEqual([]);
});

test("preparation continues while another settings category is visible", async ({ harness }) => {
  const { page, section, errors } = await openSettings(harness, { hold: true });
  await section.getByRole("button", { name: "准备并校验两个模型", exact: true }).click();
  await expect(section.getByRole("progressbar")).toHaveCount(2);
  await page.locator('.settings-nav a[href="#appearance"]').click();
  await expect(section).toBeHidden();
  expect(await page.evaluate(() => __tfNativeSettings.destroyed)).toBe(0);
  await page.evaluate(() => { for (const resolve of __tfNativeSettings.pending.splice(0)) resolve(); });
  await expect.poll(() => page.evaluate(() => __tfNativeSettings.inputs.length)).toBe(2);
  await page.locator('.settings-nav a[href="#general"]').click();
  await expect(section.getByText("语言识别与翻译自检通过", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => __tfNativeSettings.creates.length)).toBe(2);
  expect(errors).toEqual([]);
});
