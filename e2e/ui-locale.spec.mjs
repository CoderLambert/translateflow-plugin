import { test as base, expect, chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Consume a real built artifact. No runtime source or permissions are added.
// Run separately for dist/extension and .output/chrome-mv3.
const artifact = resolve(process.env.TF_I18N_ARTIFACT || "dist/extension");
const test = base.extend({
  browserUiLocale: ["en-US", { option: true }],
  localeHarness: async ({ browserUiLocale }, use) => {
    await readFile(join(artifact, "manifest.json"), "utf8");
    const temporary = await mkdtemp(join(tmpdir(), "translateflow-i18n-"));
    const extension = join(temporary, "extension");
    await cp(artifact, extension, { recursive: true });
    const context = await chromium.launchPersistentContext(join(temporary, "profile"), {
      headless: true, channel: "chromium", locale: browserUiLocale,
      env: { ...process.env, LANGUAGE: browserUiLocale.replaceAll("-", "_") },
      args: [`--lang=${browserUiLocale}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const external = [];
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    await context.route(/^https?:/, async (route) => {
      external.push(route.request().url());
      await route.abort();
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    async function openOptions() {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await expect(page.locator("#uiLocaleControl")).toBeVisible();
      return page;
    }
    try {
      await use({ context, openOptions, extensionId, errors, external });
      expect(external, "No Provider or external HTTP call").toEqual([]);
      expect(errors, "No uncaught page errors").toEqual([]);
    } finally {
      await context.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }
});

test("real Options stores only UI language, updates two pages and restores after reopening", async ({ localeHarness: h }) => {
  const page = await h.openOptions();
  expect(await page.evaluate(() => chrome.i18n.getUILanguage())).toMatch(/^en/);
  await page.evaluate(() => chrome.storage.local.remove("uiLocale"));
  await page.reload();
  expect(await page.evaluate(() => chrome.storage.local.get(["uiLocale"]))).toEqual({});
  await expect(page.locator("#uiLocale")).toHaveValue("auto");
  await expect(page.locator("#uiLocaleControl h2")).toHaveText("Interface language");
  await page.evaluate(() => chrome.storage.local.set({ targetLanguage: "Simplified Chinese", dictionaryLanguages: ["en", "fr"] }));
  const before = await page.evaluate(() => chrome.storage.local.get(null));
  const second = await h.openOptions();
  await page.locator("#uiLocale").selectOption("zh_CN");
  await expect(page.locator("#uiLocaleStatus")).toHaveText("界面语言已保存。");
  await expect(second.locator("#uiLocaleControl h2")).toHaveText("界面语言");
  await expect(second.locator("#uiLocale")).toHaveValue("zh_CN");
  const after = await page.evaluate(() => chrome.storage.local.get(null));
  expect(after).toEqual({ ...before, uiLocale: "zh_CN" });
  await page.close();
  const reopened = await h.openOptions();
  await expect(reopened.locator("#uiLocale")).toHaveValue("zh_CN");
  await expect(reopened.locator("#uiLocaleControl h2")).toHaveText("界面语言");
  await reopened.locator("#uiLocale").selectOption("en");
  await expect(second.locator("#uiLocaleControl h2")).toHaveText("Interface language");
  await expect.poll(() => second.evaluate(() => chrome.storage.local.get(["targetLanguage", "dictionaryLanguages"])))
    .toEqual({ targetLanguage: "Simplified Chinese", dictionaryLanguages: ["en", "fr"] });
  const manifest = await second.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe("TranslateFlow");
  expect(manifest.default_locale).toBe("en");
  await reopened.screenshot({ path: test.info().outputPath("ui-locale-en.png"), fullPage: true });
});

test("failed native storage write reports failure and keeps the committed language", async ({ localeHarness: h }) => {
  const page = await h.openOptions();
  await page.evaluate(() => {
    const original = chrome.storage.local.set;
    globalThis.__tfRestoreLocaleWrite = () => { chrome.storage.local.set = original; };
    chrome.storage.local.set = async () => { throw new Error("Synthetic storage write failure"); };
  });
  await page.locator("#uiLocale").selectOption("zh_CN");
  await expect(page.locator("#uiLocaleStatus")).toHaveText(/Could not save/);
  await expect(page.locator("#uiLocale")).toHaveValue("auto");
  await expect(page.locator("#uiLocaleRetry")).toBeVisible();
  await page.evaluate(() => globalThis.__tfRestoreLocaleWrite());
  await page.locator("#uiLocaleRetry").click();
  await expect(page.locator("#uiLocaleStatus")).toHaveText("");
  await page.locator("#uiLocale").selectOption("zh_CN");
  await expect(page.locator("#uiLocaleStatus")).toHaveText("界面语言已保存。");
});

test("failed native storage read is visible and retry restores an enabled control", async ({ localeHarness: h }) => {
  await h.context.addInitScript(() => {
    const original = chrome.storage.local.get;
    globalThis.__tfFailLocaleRead = true;
    chrome.storage.local.get = async (keys) => {
      if (globalThis.__tfFailLocaleRead && Array.isArray(keys) && keys.length === 1 && keys[0] === "uiLocale") {
        throw new Error("Synthetic storage read failure");
      }
      return original.call(chrome.storage.local, keys);
    };
  });
  const page = await h.openOptions();
  await expect(page.locator("#uiLocaleStatus")).toHaveText(/Could not load/);
  await expect(page.locator("#uiLocale")).toBeDisabled();
  await page.evaluate(() => { globalThis.__tfFailLocaleRead = false; });
  await page.locator("#uiLocaleRetry").click();
  await expect(page.locator("#uiLocale")).toBeEnabled();
  await expect(page.locator("#uiLocaleStatus")).toHaveText("");
});

test("the new control remains hidden while the initial stored language is pending", async ({ localeHarness: h }) => {
  const first = await h.openOptions();
  await first.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN" }));
  await h.context.addInitScript(() => {
    const original = chrome.storage.local.get;
    chrome.storage.local.get = async (keys) => {
      if (Array.isArray(keys) && keys.length === 1 && keys[0] === "uiLocale") {
        const value = await original.call(chrome.storage.local, keys);
        await new Promise((resolve) => { globalThis.__tfReleaseLocaleRead = resolve; });
        return value;
      }
      return original.call(chrome.storage.local, keys);
    };
  });
  const page = await h.context.newPage();
  await page.goto(`chrome-extension://${h.extensionId}/options.html`, { waitUntil: "commit" });
  await expect.poll(() => page.evaluate(() => typeof globalThis.__tfReleaseLocaleRead)).toBe("function");
  await expect(page.locator("#uiLocaleControl")).toBeHidden();
  await page.evaluate(() => globalThis.__tfReleaseLocaleRead());
  await expect(page.locator("#uiLocaleControl")).toBeVisible();
  await expect(page.locator("#uiLocaleControl h2")).toHaveText("界面语言");
});

test.describe("Chinese browser with an explicit English interface", () => {
  test.use({ browserUiLocale: "zh-CN" });
  test("UI override preserves Chinese translation target and browser-selected Manifest", async ({ localeHarness: h }) => {
    const page = await h.openOptions();
    expect(await page.evaluate(() => chrome.i18n.getUILanguage())).toMatch(/^zh/);
    await expect(page.locator("#uiLocaleControl h2")).toHaveText("界面语言");
    await page.evaluate(() => chrome.storage.local.set({ targetLanguage: "Simplified Chinese" }));
    const before = await page.evaluate(() => chrome.runtime.getManifest().description);
    expect(before).toContain("双语");
    await page.locator("#uiLocale").selectOption("en");
    await expect(page.locator("#uiLocaleControl h2")).toHaveText("Interface language");
    await expect(page.locator("#uiLocaleStatus")).toHaveText("Interface language saved.");
    expect(await page.evaluate(() => chrome.storage.local.get(["uiLocale", "targetLanguage"])))
      .toEqual({ uiLocale: "en", targetLanguage: "Simplified Chinese" });
    expect(await page.evaluate(() => chrome.runtime.getManifest().description)).toBe(before);
  });
});
