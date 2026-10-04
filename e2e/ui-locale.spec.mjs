import { test as base, expect, chromium } from "@playwright/test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeMdx } from "../tests/helpers/mdict-fixture.mjs";

// Consume a real built artifact. No runtime source or permissions are added.
// Default to the WXT artifact built by CI; select dist/extension explicitly for legacy comparison.
const artifact = resolve(process.env.TF_I18N_ARTIFACT || ".output/chrome-mv3");
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
      // A serviceworker target is not completion of its native install handler.
      // Finish the fresh-profile defaults write before injecting read/write
      // failures; a late uiLocale onChanged would otherwise recover/hide retry.
      const initialLocale = await worker.evaluate(() => chrome.storage.local.get(["uiLocale"]));
      let readinessReads = 0;
      await expect.poll(async () => {
        readinessReads++;
        return worker.evaluate(() => chrome.storage.local.get(["uiLocale"]));
      }).toEqual({ uiLocale: "auto" });
      console.log("[I18N_NATIVE_DEFAULTS_READY]", JSON.stringify({ artifact, initialLocale, readinessReads, uiLocale: "auto", storageWritesByHarness: 0 }));
      await use({ context, openOptions, extensionId, worker, errors, external });
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
    if (location.protocol !== "chrome-extension:" || !chrome.storage?.local) return;
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
    if (location.protocol !== "chrome-extension:" || !chrome.storage?.local) return;
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

test("mounted Quick Control, Selection and subtitle controls follow one live Content locale", async ({ localeHarness: h }) => {
  await h.context.route("https://i18n.fixture.test/**", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body><p id='selection'>synthetic selection text</p></body></html>"
  }));
  const page = await h.context.newPage();
  await page.goto("https://i18n.fixture.test/content");
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__TRANSLATE_FLOW_CONTENT__?.loaded))).toBe(true);
  await h.worker.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) throw new Error("Content locale fixture tab is missing");
    await chrome.tabs.sendMessage(tab.id, { type: "TF_QUICK_CONTROL_SHOW" });
  }, page.url());
  await expect(page.locator(".tf-quick-subtitle")).toHaveText("Page translation");
  await expect(page.locator(".tf-quick-auto strong")).toHaveText("Automatic translation");

  await h.worker.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN" }));
  await expect(page.locator(".tf-quick-subtitle")).toHaveText("页面翻译");
  await expect(page.locator(".tf-quick-translate")).toHaveText("翻译 / 重翻");
  await page.evaluate(() => {
    const target = document.querySelector("#selection");
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "处理所选文本" })).toBeVisible();
  await h.worker.evaluate(() => chrome.storage.local.set({ uiLocale: "en" }));
  await expect(page.getByRole("button", { name: "Process selected text" })).toBeVisible();

  await h.context.route("https://www.youtube.com/watch**", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body><div class='html5-video-player' style='position:relative;width:640px;height:360px'></div></body></html>"
  }));
  const youtube = await h.context.newPage();
  await youtube.goto("https://www.youtube.com/watch?v=tf-i18n");
  const subtitleHost = youtube.locator('[data-tf-extension-ui="youtube-subtitles"]');
  await expect(subtitleHost).toBeAttached();
  await expect(youtube.getByRole("combobox", { name: "TranslateFlow subtitle mode" })).toHaveValue("bilingual");
  await expect(youtube.getByRole("combobox", { name: "TranslateFlow subtitle mode" }).locator("option")).toHaveText(["Bilingual", "Original captions", "Off"]);
  await h.worker.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN" }));
  await expect(youtube.getByRole("combobox", { name: "TranslateFlow 字幕模式" }).locator("option")).toHaveText(["双语", "原字幕", "关闭"]);
});

test("Options Glossary and local dictionary preflight update in both languages without changing entered files", async ({ localeHarness: h }) => {
  const page = await h.openOptions();
  await expect(page.locator("#glossary h2")).toHaveText("Glossary");
  await expect(page.locator("#dictionary-packs h2")).toHaveText("Dictionary library");
  await page.locator("#glossarySource").fill("fixture-source");
  await page.locator("#glossaryTarget").fill("fixture-target");
  await page.locator("#saveGlossaryEntry").click();
  await expect(page.locator("#status")).toContainText("Term saved");
  await expect(page.locator("#glossaryList")).toContainText("fixture-source → fixture-target");

  await page.locator("#localDictionaryFiles").setInputFiles({
    name: "locale-fixture.mdx", mimeType: "application/octet-stream",
    buffer: makeMdx([["locale-fixture", "Synthetic local definition."]], { generatedVersion: "2.0", styleSheet: "" })
  });
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("Supported");
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("Rich-text MDX dictionary");

  await page.locator("#uiLocale").selectOption("zh_CN");
  await expect(page.locator("#uiLocaleStatus")).toHaveText("界面语言已保存。");
  await expect(page.locator("#glossary h2")).toHaveText("术语表");
  await expect(page.locator("label[for='glossarySource']")).toHaveText("来源术语");
  await expect(page.locator("#glossaryList")).toContainText("fixture-source → fixture-target");
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("可用");
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("MDX 富文本词典");
  await expect(page.locator("#localDictionaryFileList")).toContainText("locale-fixture.mdx");

  await page.locator("#uiLocale").selectOption("en");
  await expect(page.locator("#glossary h2")).toHaveText("Glossary");
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("Supported");
  await expect(page.locator("#localDictionaryFileList")).toContainText("locale-fixture.mdx");
  await page.locator("#localDictionaryFiles").setInputFiles({
    name: "broken-fixture.mdx", mimeType: "application/octet-stream", buffer: Buffer.from("not an MDX file")
  });
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("MDX file is corrupt or its structure cannot be read.");
  await expect(page.locator("#localDictionaryImportButton")).toBeDisabled();
  await page.locator("#uiLocale").selectOption("zh_CN");
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("MDX 文件损坏或结构无法读取。");
  await page.locator("#localDictionaryFiles").setInputFiles({
    name: "locale-fixture.mdx", mimeType: "application/octet-stream",
    buffer: makeMdx([["locale-fixture", "Synthetic local definition."]], { generatedVersion: "2.0", styleSheet: "" })
  });
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("可用");
  await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
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
