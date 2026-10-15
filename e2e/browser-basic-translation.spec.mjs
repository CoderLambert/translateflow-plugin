import { normalizeOrigin } from "../src/shared/url.js";
import { test, expect } from "./support/extension-fixture.mjs";

async function isolated(harness, page, action, input = {}) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, action, input }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [action, input], func: (action, input) => {
      if (action === "install") {
        const state = globalThis.__tfBasicMock = { creates: 0, destroyed: 0, inputs: [], pairs: [], fail: input.fail || false, hold: false, availability: input.availability || "downloadable" };
        Object.defineProperty(globalThis, "Translator", { configurable: true, value: {
          availability: async () => state.availability,
          create(options) {
            state.creates++; state.pairs.push({ sourceLanguage: options.sourceLanguage, targetLanguage: options.targetLanguage });
            options.monitor?.({ addEventListener(_name, listener) { listener({ loaded: 0.5 }); } });
            if (state.fail) { state.fail = false; return Promise.reject(new Error("synthetic download failure")); }
            return Promise.resolve({ destroy() { state.destroyed++; }, async translate(text) {
              state.inputs.push(text);
              if (state.hold) return new Promise(resolve => { state.release = () => resolve(`基础:${text}`); });
              return `基础:${text}`;
            } });
          }
        } });
        Object.defineProperty(globalThis, "LanguageDetector", { configurable: true, value: input.detectorUnavailable ? undefined : { availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.99 }], destroy() {} }) } });
        return true;
      }
      if (action === "probe") { const { release, ...state } = globalThis.__tfBasicMock; return state; }
      if (action === "hold") { globalThis.__tfBasicMock.hold = true; return true; }
      if (action === "release") { globalThis.__tfBasicMock.release?.(); return true; }
      if (action === "subtitle") {
        const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
        return app.modules.runtime.sendRuntimeMessage({ type: "SUBTITLE_TRANSLATE_BATCH", requestId: "synthetic-subtitle", pageUrl: location.href,
          units: [{ id: "cue", mediaId: "synthetic-video", text: "Bonjour tout le monde", source: "text-track", track: { language: "fr" }, cue: { startTime: 1, endTime: 2 } }] });
      }
    } });
    return result.result;
  }, { tabId, action, input });
}
async function noAi(harness, patch = {}) {
  await harness.setStorage({ provider: "deepseek", apiKey: "", providerConnections: {}, providerCredentials: {}, defaultService: null,
    aiServiceConfigured: null, openAICompatible: { apiKey: "", baseUrl: "", model: "" }, dictionaryEnabled: false, browserTranslationEnabled: true, ...patch });
}
async function select(page, selector = "#technical-competition") {
  await page.locator(selector).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.locator(".tf-selection-chip")).toBeVisible(); await page.locator(".tf-selection-chip").click();
}
const basicPanel = page => page.locator('[data-basic-translation="prompt"]');

test("without AI or dictionaries Selection prepares only from a click, retries downloads and reuses cache", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install", { fail: true });
  expect((await isolated(harness, page, "probe")).creates).toBe(0);
  await page.setViewportSize({ width: 375, height: 720 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await select(page);
  await expect(basicPanel(page)).toBeVisible(); expect((await isolated(harness, page, "probe")).creates).toBe(0);
  const bounds = await basicPanel(page).boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
  await page.screenshot({ path: "docs/task-execution/local/browser-basic-translation/prepare-dark-narrow.png" });
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect(basicPanel(page)).toContainText("语言包准备失败");
  await basicPanel(page).getByRole("button", { name: "重试准备", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:session");
  await expect(page.locator(".tf-selection-result")).toContainText("浏览器基础翻译");
  await expect(page.getByRole("tab", { name: "译文", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "复制", exact: true })).toBeVisible();
  expect(harness.server.calls.length).toBe(0);
  const count = (await isolated(harness, page, "probe")).inputs.length;
  await page.keyboard.press("Escape"); await select(page);
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:session");
  expect((await isolated(harness, page, "probe")).inputs.length).toBe(count);
  await page.screenshot({ path: "docs/task-execution/local/browser-basic-translation/selection-mock.png" });
});

test("page translation preserves markers, links and code; disabling releases models and prevents further initialization", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/article"); await harness.inject(page); await isolated(harness, page, "install");
  const running = harness.sendContent(page, "ABT_TRANSLATE_PAGE");
  await expect(basicPanel(page)).toBeVisible(); await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  expect((await running).ok).toBe(true);
  await expect(page.locator("#rich .abt-translation a")).toHaveAttribute("href", "/docs");
  await expect(page.locator("#rich .abt-translation code")).toHaveText("npm test");
  const initial = await isolated(harness, page, "probe"); expect(initial.inputs.some(text => /TF:|npm test/.test(text))).toBe(false);
  expect((await harness.sendContent(page, "ABT_TRANSLATE_PAGE")).ok).toBe(true);
  expect((await isolated(harness, page, "probe")).inputs.length).toBe(initial.inputs.length);
  await harness.setStorage({ browserTranslationEnabled: false });
  await expect.poll(async () => (await isolated(harness, page, "probe")).destroyed).toBe(1);
  const retry = harness.sendContent(page, "ABT_TRANSLATE_PAGE");
  await expect(basicPanel(page)).toContainText("基础翻译已关闭");
  await basicPanel(page).getByRole("button", { name: "取消", exact: true }).click(); await retry;
  expect((await isolated(harness, page, "probe")).creates).toBe(initial.creates);
});

test("AI stays preferred; failures switch only on click and begin a new basic task", async ({ harness }) => {
  await harness.reset(); await harness.setStorage({ dictionaryEnabled: false });
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install");
  await select(page, "#ambiguous");
  await expect(page.locator(".tf-selection-primary")).not.toBeEmpty();
  expect((await isolated(harness, page, "probe")).creates).toBe(0);
  await page.keyboard.press("Escape");
  harness.server.setFailures([401]); await select(page);
  await expect(basicPanel(page)).toContainText("AI 翻译失败");
  expect(harness.server.calls.length).toBe(2); expect((await isolated(harness, page, "probe")).creates).toBe(0);
  await basicPanel(page).getByRole("button", { name: "使用基础翻译", exact: true }).click();
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:session"); expect(harness.server.calls.length).toBe(2);
  await page.keyboard.press("Escape"); await select(page, "#ambiguous");
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:persistent");
  expect((await isolated(harness, page, "probe")).inputs).toContain("persistent"); expect(harness.server.calls.length).toBe(2);
});

test("subtitle language comes from its track and site target overrides apply", async ({ harness }) => {
  await harness.reset(); await noAi(harness, { siteProfiles: { [normalizeOrigin(harness.server.baseUrl)]: { targetLanguage: "Japanese" } } });
  const page = await harness.open("/article"); await harness.inject(page); await isolated(harness, page, "install");
  const running = isolated(harness, page, "subtitle");
  await expect(basicPanel(page)).toBeVisible(); await expect(basicPanel(page).getByRole("combobox")).toHaveValue("fr");
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  const result = await running; expect(result.ok).toBe(true); expect(result.translations[0].text).toContain("基础:Bonjour");
  expect((await isolated(harness, page, "probe")).pairs[0]).toEqual({ sourceLanguage: "fr", targetLanguage: "ja" });
});

test("closing Selection rejects a late browser result before cache store", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install"); await isolated(harness, page, "hold");
  await select(page); await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect.poll(async () => (await isolated(harness, page, "probe")).inputs.length).toBe(1);
  await page.keyboard.press("Escape"); await isolated(harness, page, "release");
  await expect(page.locator(".tf-selection-panel")).toBeHidden();
  const cache = await harness.runtime({ type: "CACHE_STATS" }); expect(cache.segmentCount).toBe(0);
  expect(harness.server.calls.length).toBe(0);
});

test("source correction restarts with a new pair; unavailable model has a settings recovery action", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install");
  await select(page);
  await basicPanel(page).getByRole("combobox").selectOption("de");
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:session");
  expect((await isolated(harness, page, "probe")).pairs).toEqual([{ sourceLanguage: "de", targetLanguage: "zh" }]);
  const another = await harness.open("/article"); await harness.inject(another); await isolated(harness, another, "install", { availability: "unavailable" });
  const pending = harness.sendContent(another, "ABT_TRANSLATE_PAGE");
  await expect(basicPanel(another)).toContainText("此处无法使用基础翻译");
  await expect(basicPanel(another).getByRole("button", { name: "翻译设置 / 配置 AI" })).toBeVisible();
  expect((await isolated(harness, another, "probe")).creates).toBe(0);
  await basicPanel(another).getByRole("button", { name: "取消", exact: true }).click(); await pending;
});

test("English Selection is detected independently of a Chinese website UI", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install");
  await page.evaluate(() => { document.documentElement.lang = "zh-CN"; document.querySelector("#technical-competition").textContent = "Actually"; });
  await select(page);
  await expect(basicPanel(page)).toContainText("准备基础翻译");
  await expect(basicPanel(page).getByRole("combobox")).toHaveValue("en");
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:Actually");
  expect((await isolated(harness, page, "probe")).pairs[0]).toEqual({ sourceLanguage: "en", targetLanguage: "zh" });
});
test("Selection with no detector asks for its own language instead of using the page language", async ({ harness }) => {
  await harness.reset(); await noAi(harness);
  const page = await harness.open("/selection"); await harness.inject(page); await isolated(harness, page, "install", { detectorUnavailable: true });
  await page.evaluate(() => { document.documentElement.lang = "es"; });
  await select(page);
  await expect(basicPanel(page)).toContainText("划词语言独立于网站界面语言");
  await expect(basicPanel(page).getByRole("combobox")).toHaveValue("");
  expect((await isolated(harness, page, "probe")).creates).toBe(0);
  await basicPanel(page).getByRole("combobox").selectOption("en");
  await basicPanel(page).getByRole("button", { name: "使用此源语言", exact: true }).click();
  await basicPanel(page).getByRole("button", { name: "准备基础翻译", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).toContainText("基础:session");
});
