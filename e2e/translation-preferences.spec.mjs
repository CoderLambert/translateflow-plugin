import { mkdir } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";

const evidence = "docs/task-execution/local/translation-method/selection-ux";
const preferences = (wordMethod, textMethod = "ai") => ({ version: 1, wordMethod, textMethod });
const online = { version: 2, mode: "legacy", routing: "fixed", providerId: "mt-microsoft-web", sourceLanguage: "en" };
const consent = { version: 1, routing: "fixed", providerId: "mt-microsoft-web" };
async function select(page, selector) {
  await page.locator(selector).evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
  await expect(page.getByRole("button", { name: /^(查词|翻译选段)$/ })).toBeVisible();
  await page.getByRole("button", { name: /^(查词|翻译选段)$/ }).click();
}
async function native(h, page, action = "install") {
  const tabId = await h.tabId(page);
  return h.driver.evaluate(async ({ tabId, action }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [action], func: action => {
      if (action === "probe") { const { release, ...result } = globalThis.__preferencesNative; return result; }
      if (action === "hold") { globalThis.__preferencesNative.hold = true; return; }
      if (action === "release") { globalThis.__preferencesNative.release?.(); return; }
      const state = globalThis.__preferencesNative = { inputs: [], creates: 0, ports: 0, hold: false };
      const connect = chrome.runtime.connect.bind(chrome.runtime);
      chrome.runtime.connect = (...args) => { if (args[0]?.name === "tf-browser-native-v1") state.ports++; return connect(...args); };
      Object.defineProperty(globalThis, "Translator", { configurable: true, value: { availability: async () => "available", create: async () => {
        state.creates++; return { destroy() {}, async translate(text) {
          state.inputs.push(text);
          if (state.hold) return new Promise(resolve => { state.release = () => resolve(`本地合成:${text}`); });
          return `本地合成:${text}`;
        } };
      } } });
      Object.defineProperty(globalThis, "LanguageDetector", { configurable: true, value: { availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.99 }], destroy() {} }) } });
    } });
    return result.result;
  }, { tabId, action });
}
async function open(h) {
  const page = await h.open("/selection");
  await page.locator("main").evaluate(node => { node.insertAdjacentHTML("beforeend", '<p id="preferences-phrase">a synthetic phrase</p><p id="preferences-sentence">This synthetic sentence has enough words to exercise local translation.</p>'); });
  await h.inject(page); return page;
}
const onlineCalls = h => h.serviceWorker.evaluate(() => globalThis.__preferencesOnline.length);
test.beforeEach(async ({ harness: h }) => {
  await mkdir(evidence, { recursive: true }); await h.reset();
  await h.setStorage({ translationPreferences: preferences("free-online"), machineTranslation: online, machineTranslationConsent: consent });
  await h.serviceWorker.evaluate(() => {
    const original = globalThis.__preferencesOriginalFetch || fetch; globalThis.__preferencesOriginalFetch = original; globalThis.__preferencesOnline = [];
    globalThis.fetch = async (url, options) => {
      if (new URL(url).hostname !== "edge.microsoft.com") return original(url, options);
      const input = JSON.parse(options.body); globalThis.__preferencesOnline.push(input);
      return Response.json(input.map(text => ({ translations: [{ text: text === "multiple" ? "多重" : `在线合成:${text}` }] })));
    };
  });
});

test("word choice bypasses dictionaries; phrase uses text choice and cached results retain source", async ({ harness: h }) => {
  const page = await open(h);
  await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("在线合成:session");
  await expect(page.locator(".tf-selection-result")).toContainText("在线译文 · 微软翻译");
  expect(h.server.calls).toHaveLength(0); const count = await onlineCalls(h);
  await page.keyboard.press("Escape"); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("在线合成:session"); expect(await onlineCalls(h)).toBe(count);
  await page.keyboard.press("Escape"); await select(page, "#preferences-phrase");
  await expect(page.locator(".tf-selection-primary")).toContainText("[DEFAULT|PLAIN] a synthetic phrase");
  await expect(page.locator(".tf-selection-result")).toContainText("AI 译文");
  expect(h.server.calls.length).toBeGreaterThan(0); expect(await onlineCalls(h)).toBe(count);
  await page.screenshot({ path: `${evidence}/source-ai.png` }); await page.close();
});

test("Chrome local phrase and sentence run in Content without widening the shared word port", async ({ harness: h }) => {
  await h.setStorage({ translationPreferences: preferences("free-online", "browser-local"), browserSourceLanguage: "en" });
  const page = await open(h); await native(h, page);
  for (const selector of ["#preferences-phrase", "#preferences-sentence"]) {
    await select(page, selector);
    await expect(page.locator(".tf-selection-primary")).toContainText("本地合成:");
    await expect(page.locator(".tf-selection-result")).toContainText("Chrome 本地译文");
    await page.keyboard.press("Escape");
  }
  const probe = await native(h, page, "probe"); expect(probe.inputs.some(value => value.includes("synthetic sentence"))).toBe(true);
  expect(probe.ports).toBe(0); expect(h.server.calls).toHaveLength(0); expect(await onlineCalls(h)).toBe(0);
  await select(page, "#preferences-sentence");
  const count = (await native(h, page, "probe")).inputs.length;
  await expect(page.locator(".tf-selection-primary")).toContainText("本地合成:");
  expect((await native(h, page, "probe")).inputs.length).toBe(count);
  await page.screenshot({ path: `${evidence}/local-sentence.png` }); await page.close();
});

test("temporary dictionary miss stays local and another selection returns to the saved online method", async ({ harness: h }) => {
  const page = await open(h); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toContainText("在线合成:");
  const count = await onlineCalls(h);
  await page.getByText("切换方式", { exact: true }).click(); await page.getByRole("button", { name: "用词典查词", exact: true }).click();
  await expect(page.locator(".tf-selection-panel")).toContainText("本地词典");
  expect(await onlineCalls(h)).toBe(count); expect(h.server.calls).toHaveLength(0);
  await page.keyboard.press("Escape"); await select(page, "#ambiguous");
  await expect(page.locator(".tf-selection-primary")).toContainText("在线合成:");
  await expect(page.locator(".tf-selection-method-current")).toHaveText("免费在线");
  expect((await h.getStorage(["translationPreferences"])).translationPreferences.wordMethod).toBe("free-online");
  await page.close();
});

test("method chooser stays compact, edits without translating and supports keyboard and narrow themes", async ({ harness: h }) => {
  const page = await open(h);
  await page.locator("#technical-competition").evaluate(node => { node.textContent = "multiple"; });
  await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-primary")).toHaveText("多重");
  const summary = page.locator(".tf-selection-method-summary");
  const chooser = page.locator(".tf-selection-routing");
  const count = await onlineCalls(h);
  await expect(summary).toHaveAccessibleName("切换方式，当前：免费在线");
  await expect(chooser.locator("select")).toHaveCount(0);
  expect(await summary.evaluate(node => getComputedStyle(node).fontFamily)).toContain("ui-sans-serif");
  expect((await summary.boundingBox()).height).toBeLessThanOrEqual(44);
  await page.screenshot({ path: `${evidence}/word-compact.png` });
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(chooser).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "用免费在线查词", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "这是短语？改按选段翻译", exact: true }).click();
  await expect(page.getByRole("button", { name: "用词典查词", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "用 AI 翻译", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "这是单词？改按单词查词", exact: true }).click();
  await expect(page.getByRole("button", { name: "用词典查词", exact: true })).toBeVisible();
  expect(await onlineCalls(h)).toBe(count); expect(h.server.calls).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(chooser).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused(); await expect(page.locator(".tf-selection-panel")).toBeVisible();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await page.setViewportSize({ width: 375, height: 760 });
    await summary.click();
    const panel = page.locator(".tf-selection-panel");
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await chooser.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const rect = await panel.boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: `${evidence}/word-choices-${colorScheme}.png` });
    await page.keyboard.press("Escape");
    await summary.evaluate(node => node.blur());
    await page.screenshot({ path: `${evidence}/word-compact-${colorScheme}.png` });
  }
  expect(await onlineCalls(h)).toBe(count); expect(h.server.calls).toHaveLength(0);
  await summary.click(); await page.getByRole("button", { name: "这是短语？改按选段翻译", exact: true }).click();
  await page.getByRole("button", { name: "用 AI 翻译", exact: true }).click();
  await expect(page.locator(".tf-selection-result")).toContainText("AI 译文");
  await expect(page.locator(".tf-selection-method-context")).toHaveText("翻译选段");
  await expect(page.locator(".tf-selection-method-current")).toHaveText("AI");
  await expect(summary).toBeFocused();
  expect(h.server.calls).toHaveLength(1); expect(await onlineCalls(h)).toBe(count);
  expect((await h.getStorage(["translationPreferences"])).translationPreferences).toEqual(preferences("free-online"));
  await summary.click();
  const openedSettings = h.context.waitForEvent("page");
  await page.getByRole("button", { name: "修改默认方式", exact: true }).click();
  const settings = await openedSettings;
  await settings.waitForURL(`chrome-extension://${h.extensionId}/options.html#general`);
  await expect(settings.getByRole("button", { name: "保存翻译偏好", exact: true })).toBeVisible();
  expect(h.server.calls).toHaveLength(1); expect(await onlineCalls(h)).toBe(count);
  await settings.close(); await page.bringToFront();
  await summary.focus(); await page.keyboard.press("Escape");
  await page.keyboard.press("Escape"); await expect(page.locator(".tf-selection-panel")).toBeHidden();
  await page.close();
});

test("a new online default without consent performs zero network requests and retains selection", async ({ harness: h }) => {
  await h.setStorage({ machineTranslationConsent: null });
  const page = await open(h); await select(page, "#technical-competition");
  await expect(page.locator(".tf-selection-status")).toContainText("确认");
  expect(await onlineCalls(h)).toBe(0); expect(h.server.calls).toHaveLength(0);
  expect((await h.getStorage(["translationPreferences"])).translationPreferences.wordMethod).toBe("free-online");
  await page.close();
});

test("native cancellation and preference changes discard late sentence results", async ({ harness: h }) => {
  await h.setStorage({ translationPreferences: preferences("ai", "browser-local"), browserSourceLanguage: "en" });
  const page = await open(h); await native(h, page); await native(h, page, "hold");
  await select(page, "#preferences-sentence");
  await expect.poll(async () => (await native(h, page, "probe")).inputs.length).toBeGreaterThan(0);
  await page.keyboard.press("Escape"); await h.setStorage({ translationPreferences: preferences("ai", "ai") });
  await native(h, page, "release");
  await select(page, "#preferences-phrase");
  await expect(page.locator(".tf-selection-result")).toContainText("AI 译文");
  await expect(page.locator(".tf-selection-result")).not.toContainText("本地合成:");
  expect(await onlineCalls(h)).toBe(0); await page.close();
});

test("Options preserves both preferences across restart; editing remains local and old switches are absent", async ({ harness: h }) => {
  const options = await h.context.newPage(); await options.goto(`chrome-extension://${h.extensionId}/options.html#general`);
  await expect(options.locator('.mt-word-method:not(.mt-text-method) input[name="word-method"]').first()).toBeChecked();
  await options.getByRole("radio", { name: "词典", exact: true }).check();
  await options.locator('.mt-text-method input[value="browser-local"]').check();
  expect(await onlineCalls(h)).toBe(0); expect(h.server.calls).toHaveLength(0);
  await options.getByRole("button", { name: "保存翻译偏好", exact: true }).click();
  await expect(options.locator(".mt-settings .status")).toHaveText("翻译偏好已保存。");
  await expect(options.locator("#dictionaryEnabled,#browserTranslationEnabled")).toHaveCount(0);
  for (const colorScheme of ["light", "dark"]) {
    await options.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await options.setViewportSize({ width: 390, height: 800 });
    await options.locator("#mt-save").scrollIntoViewIfNeeded();
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await options.locator('.mt-word-method input[type="radio"]').evaluateAll(nodes => nodes.every(node => { const rect = node.getBoundingClientRect(); return rect.width <= 20 && rect.height <= 20; }))).toBe(true);
    await options.screenshot({ path: `${evidence}/preferences-${colorScheme}.png` });
  }
  await options.close(); await h.restartBrowser();
  expect((await h.getStorage(["translationPreferences"])).translationPreferences).toEqual(preferences("dictionary", "browser-local"));
});

test("real native capability probe never downloads; an available model translates a synthetic sentence", async ({ harness: h }, testInfo) => {
  const page = await open(h), tabId = await h.tabId(page);
  const status = await h.driver.evaluate(async tabId => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: async () => {
      try {
        const pair = { sourceLanguage: "en", targetLanguage: "zh" };
        return { translator: globalThis.Translator?.availability ? await Translator.availability(pair) : "unsupported",
          detector: globalThis.LanguageDetector?.availability ? await LanguageDetector.availability() : "unsupported" };
      } catch { return { translator: "unavailable", detector: "unknown" }; }
    } }); return result.result;
  }, tabId);
  console.log("[REAL_NATIVE_CAPABILITY]", JSON.stringify(status));
  await testInfo.attach("real-native-capability", { body: JSON.stringify(status), contentType: "application/json" });
  test.skip(status.translator !== "available" || status.detector !== "available", "Real models are not ready; no download or create was requested.");
  await h.setStorage({ translationPreferences: preferences("free-online", "browser-local"), browserSourceLanguage: "en" });
  await select(page, "#preferences-sentence");
  await expect(page.locator(".tf-selection-primary")).not.toBeEmpty();
  await expect(page.locator(".tf-selection-result")).toContainText("Chrome 本地译文");
  expect(h.server.calls).toHaveLength(0); expect(await onlineCalls(h)).toBe(0); await page.close();
});

test("upgrade initializes once and preserves visible site choices without treating the new word default as consent", async ({ harness: h }) => {
  const origin = new URL(h.server.baseUrl).origin.replace(/:\d+$/u, "");
  await h.setStorage({ translationPreferences: null, machineTranslation: { ...online, mode: "legacy" }, machineTranslationConsent: null,
    siteProfiles: { [origin]: { machineTranslation: { ...online, mode: "free-online" }, prompt: "retained prompt", appearance: "compact" } } });
  const state = await h.runtime({ type: "TRANSLATION_PREFERENCES_GET", pageUrl: h.server.baseUrl + "/article" });
  expect(state.ok).toBe(true); expect(state.preferences).toEqual(preferences("free-online", "ai"));
  expect(state.selected.method).toBe("free-online"); expect(state.globalConsent).toBe(false);
  const stored = await h.getStorage(["siteProfiles"]);
  expect(stored.siteProfiles[origin]).toMatchObject({ textMethod: "free-online", prompt: "retained prompt", appearance: "compact" });
  await h.restartBrowser();
  expect((await h.getStorage(["translationPreferences"])).translationPreferences).toEqual(state.preferences);
});
