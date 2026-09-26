import { test, expect } from "./support/extension-fixture.mjs";

test.describe("TranslateFlow MV3 smoke flows", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("manual translation renders bilingual DOM, preserves rich semantics and restores cache without another provider call", async ({ harness }) => {
    const page = await harness.open("/article");
    await harness.inject(page);

    const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-manual" });
    expect(translated.ok).toBe(true);
    expect(translated.apiTranslated).toBe(3);
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);

    const richTranslation = page.locator("#rich .abt-translation");
    await expect(richTranslation.locator("a")).toHaveAttribute("href", "/docs");
    await expect(richTranslation.locator("a")).toContainText("API documentation");
    await expect(richTranslation.locator("code")).toHaveText("npm test");
    await expect(richTranslation).not.toContainText("⟦TF:");

    const cleared = await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    expect(cleared.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(0);

    const restored = await harness.sendContent(page, "ABT_RESTORE_CACHE");
    expect(restored.ok).toBe(true);
    expect(restored.cacheHits).toBe(3);
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);
  });

  test("Quick-Control-only persistent injection does not auto-restore cached page translations", async ({ harness }) => {
    const page = await harness.open("/article");
    await harness.inject(page);

    const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-quick-only-seed" });
    expect(translated.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);
    await page.close();

    await harness.setStorage({
      cacheRestoreSites: [],
      autoSites: [],
      quickControlSites: ["http://127.0.0.1"]
    });

    const reopened = await harness.open("/article");
    await harness.inject(reopened);
    await reopened.waitForTimeout(600);

    await expect(reopened.locator(".abt-translation")).toHaveCount(0);
    expect(harness.server.calls).toHaveLength(1);
    await reopened.close();
  });

  test("restore-only mode incrementally restores dynamic cache hits and never translates misses", async ({ harness }) => {
    const dynamicText = "A dynamically appended English paragraph should be restored from cache without contacting the translation provider.";
    const missingText = "This brand new paragraph is intentionally absent from the translation cache and must remain untranslated.";

    const seed = await harness.open("/incremental");
    await harness.inject(seed);

    let response = await harness.sendContent(seed, "ABT_TRANSLATE_PAGE", { taskId: "e2e-cache-restore-seed-initial" });
    expect(response.ok).toBe(true);
    expect(harness.server.calls).toHaveLength(1);

    await seed.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "seed-dynamic";
      paragraph.textContent = text;
      document.querySelector("main").appendChild(paragraph);
    }, dynamicText);

    response = await harness.sendContent(seed, "ABT_TRANSLATE_PAGE", { taskId: "e2e-cache-restore-seed-dynamic" });
    expect(response.ok).toBe(true);
    expect(response.cacheHits).toBeGreaterThanOrEqual(1);
    expect(response.apiTranslated).toBe(1);
    expect(harness.server.calls).toHaveLength(2);
    await seed.close();

    await harness.setStorage({
      cacheRestoreSites: ["http://127.0.0.1"],
      autoSites: []
    });

    const page = await harness.open("/incremental");
    await harness.inject(page);
    await expect(page.locator("#initial .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(2);

    await page.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "restored-dynamic";
      paragraph.textContent = text;
      document.querySelector("main").appendChild(paragraph);
    }, dynamicText);

    await expect(page.locator("#restored-dynamic .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(2);

    await page.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "restore-miss";
      paragraph.textContent = text;
      document.querySelector("main").appendChild(paragraph);
    }, missingText);

    await page.waitForTimeout(800);
    await expect(page.locator("#restore-miss .abt-translation")).toHaveCount(0);
    expect(harness.server.calls).toHaveLength(2);

    await harness.setStorage({ cacheRestoreSites: [] });
    await page.waitForTimeout(100);
    await page.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "restore-disabled";
      paragraph.textContent = text;
      document.querySelector("main").appendChild(paragraph);
    }, dynamicText);

    await page.waitForTimeout(800);
    await expect(page.locator("#restore-disabled .abt-translation")).toHaveCount(0);
    expect(harness.server.calls).toHaveLength(2);
  });

  test("reading appearance changes presentation without rebuilding translated DOM or calling the Provider", async ({ harness }) => {
    const page = await harness.open("/article");
    await harness.inject(page);

    const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-appearance" });
    expect(translated.ok).toBe(true);
    expect(harness.server.calls).toHaveLength(1);
    await expect(page.locator(".abt-translation")).toHaveCount(3);

    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-line-height").trim()
    )).toBe("1.65");

    const rich = page.locator("#rich .abt-translation");
    await rich.evaluate((node) => { node.dataset.appearanceIdentity = "preserve"; });

    await harness.setStorage({ appearance: "compact" });
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-line-height").trim()
    )).toBe("1.45");
    const compactMetrics = await rich.evaluate((node) => {
      const style = getComputedStyle(node);
      return { paddingTop: style.paddingTop, lineHeight: style.lineHeight, borderLeftWidth: style.borderLeftWidth };
    });
    expect(await rich.getAttribute("data-appearance-identity")).toBe("preserve");
    expect(harness.server.calls).toHaveLength(1);

    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": { appearance: "reading" }
      }
    });
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-line-height").trim()
    )).toBe("1.8");
    const readingMetrics = await rich.evaluate((node) => {
      const style = getComputedStyle(node);
      return { paddingTop: style.paddingTop, lineHeight: style.lineHeight, borderLeftWidth: style.borderLeftWidth };
    });

    expect(readingMetrics.paddingTop).not.toBe(compactMetrics.paddingTop);
    expect(readingMetrics.lineHeight).not.toBe(compactMetrics.lineHeight);
    expect(await rich.getAttribute("data-appearance-identity")).toBe("preserve");
    await expect(rich.locator("a")).toHaveAttribute("href", "/docs");
    await expect(rich.locator("code")).toHaveText("npm test");
    expect(harness.server.calls).toHaveLength(1);

    const readingContext = await harness.runtime({ type: "EFFECTIVE_CONTEXT", pageUrl: page.url() });
    expect(readingContext.ok).toBe(true);
    expect(readingContext.context).toMatchObject({
      appearanceId: "reading",
      appearanceLabel: "Reading",
      appearanceSource: "site"
    });

    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": { appearance: "minimal" }
      }
    });
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-border-width").trim()
    )).toBe("0px");
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-background").trim()
    )).toBe("transparent");
    expect(await rich.getAttribute("data-appearance-identity")).toBe("preserve");
    await expect(rich.locator("a")).toHaveAttribute("href", "/docs");
    await expect(rich.locator("code")).toHaveText("npm test");
    expect(harness.server.calls).toHaveLength(1);

    const minimalContext = await harness.runtime({ type: "EFFECTIVE_CONTEXT", pageUrl: page.url() });
    expect(minimalContext.ok).toBe(true);
    expect(minimalContext.context).toMatchObject({
      appearanceId: "minimal",
      appearanceLabel: "Minimal",
      appearanceSource: "site"
    });
  });

  test("Quick Control is Shadow-isolated, reuses task state, supports retry/cancel and yields to selection UI", async ({ harness }) => {
    const page = await harness.open("/article");
    await page.addStyleTag({ content: `button, select, .tf-quick-trigger, .tf-quick-panel { display: none !important; font-size: 1px !important; }` });
    await harness.inject(page);
    const shown = await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");
    expect(shown.ok).toBe(true);

    const trigger = page.getByRole("button", { name: "TranslateFlow Quick Control" });
    await expect(trigger).toBeVisible();
    expect(await trigger.evaluate((node) => getComputedStyle(node).fontSize)).not.toBe("1px");
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.width).toBeGreaterThanOrEqual(48);
    expect(triggerBox?.width).toBeLessThanOrEqual(56);
    expect(triggerBox?.height).toBeGreaterThanOrEqual(48);
    expect(triggerBox?.height).toBeLessThanOrEqual(56);

    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "TranslateFlow Quick Control" });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox?.width).toBeGreaterThanOrEqual(320);
    expect(dialogBox?.width).toBeLessThanOrEqual(360);
    await expect(page.getByLabel("翻译模式")).toContainText("Technical");
    await expect(page.getByLabel("阅读外观")).toContainText("Reading");
    await expect(page.getByRole("button", { name: "切换本页自动翻译" })).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.locator("main").click({ position: { x: 4, y: 4 } });
    await expect(dialog).toBeHidden();

    await trigger.click();
    await expect(dialog).toBeVisible();

    harness.server.setFailures([401]);
    await page.getByRole("button", { name: "翻译 / 重翻" }).click();
    await expect(page.locator(".tf-quick-status")).toContainText("mock failure 401");
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();

    harness.server.setFailures([]);
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.locator(".tf-quick-status")).toContainText("翻译完成");
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls.map((call) => call.plannedStatus)).toEqual([401, 200]);

    await page.getByLabel("阅读外观").selectOption("reading");
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--tf-translation-line-height").trim()
    )).toBe("1.8");
    expect(harness.server.calls).toHaveLength(2);

    await harness.sendContent(page, "ABT_CLEAR_PAGE_CACHE");
    await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    harness.server.setDelay(700);
    await page.getByRole("button", { name: "翻译 / 重翻" }).click();
    await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.locator(".tf-quick-status")).toContainText("翻译已取消");

    harness.server.setDelay(0);
    await page.getByRole("button", { name: "关闭 Quick Control" }).click();
    await selectElementText(page, "#intro");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await expect(trigger).not.toBeVisible();
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await expect(trigger).toBeVisible();
  });

  test("automatic mode translates incremental content and sends only the new paragraph to the provider", async ({ harness }) => {
    const page = await harness.open("/incremental");
    await harness.inject(page);
    const enabled = await harness.sendContent(page, "ABT_ENABLE_AUTO");
    expect(enabled.ok).toBe(true);
    await expect(page.locator("#initial .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(1);

    const dynamicText = "A dynamically appended English paragraph should be translated without resending content that is already cached and rendered.";
    await page.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "dynamic";
      paragraph.textContent = text;
      document.querySelector("main").appendChild(paragraph);
    }, dynamicText);

    await expect(page.locator("#dynamic .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(2);
    expect(harness.server.calls[1].segments).toHaveLength(1);
    expect(harness.server.calls[1].segments[0].text).toContain("dynamically appended English paragraph");
    await harness.sendContent(page, "ABT_DISABLE_AUTO");
  });

  test("site profile resolves the expected provider, model, target language and preset", async ({ harness }) => {
    const page = await harness.open("/article");
    await harness.setStorage({ siteProfiles: { "http://127.0.0.1": { provider: "openai-compatible", model: "site-mock-model", targetLanguage: "Japanese", preset: "technical" } } });
    const response = await harness.runtime({ type: "EFFECTIVE_CONTEXT", pageUrl: page.url() });
    expect(response.ok).toBe(true);
    expect(response.context).toMatchObject({ hostname: "127.0.0.1", provider: "openai-compatible", model: "site-mock-model", targetLanguage: "Japanese", presetId: "technical", presetLabel: "Technical", presetSource: "site" });
  });

  test("selection controls are isolated from hostile page CSS and cache repeated translation", async ({ harness }) => {
    const page = await harness.open("/selection");
    await page.addStyleTag({ content: `button, .tf-selection-chip, .tf-selection-panel { display: none !important; color: rgb(255, 0, 0) !important; font-size: 1px !important; }` });
    await harness.inject(page);

    await selectElementText(page, "#selectable");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((node) => getComputedStyle(node).fontSize)).not.toBe("1px");
    await chip.click();
    await expect(page.locator(".tf-selection-result")).toContainText("[DEFAULT|PLAIN]");
    expect(harness.server.calls).toHaveLength(1);

    await page.getByRole("button", { name: "关闭" }).click();
    await clearSelection(page);
    await selectElementText(page, "#selectable");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("[DEFAULT|PLAIN]");
    expect(harness.server.calls).toHaveLength(1);
  });

  test("selection failure is actionable and transient 429/500 failures recover without a stuck state", async ({ harness }) => {
    const page = await harness.open("/failure");
    await harness.inject(page);
    harness.server.setFailures([401]);
    await selectElementText(page, "#auth");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-status")).toContainText("mock failure 401");
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    expect(harness.server.calls.map((call) => call.plannedStatus)).toEqual([401]);

    harness.server.setFailures([]);
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.locator(".tf-selection-result")).toContainText("[DEFAULT|PLAIN]");
    expect(harness.server.calls.map((call) => call.plannedStatus)).toEqual([401, 200]);
    await page.getByRole("button", { name: "关闭" }).click();
    await clearSelection(page);

    harness.server.setFailures([429, 500]);
    await selectElementText(page, "#transient");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("[DEFAULT|PLAIN]", { timeout: 8_000 });
    expect(harness.server.calls.map((call) => call.plannedStatus)).toEqual([401, 200, 429, 500, 200]);
  });

  test("glossary and preset change effective behavior while switching back reuses the prior cache version", async ({ harness }) => {
    const page = await harness.open("/glossary");
    await harness.inject(page);
    await harness.setStorage({ siteProfiles: { "http://127.0.0.1": { preset: "technical" } }, glossary: { version: 1, entries: [{ id: "repository", source: "repository", target: "仓库", caseSensitive: false, enabled: true }] } });

    let response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-tech" });
    expect(response.ok).toBe(true);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[TECH|GLOSSARY]");
    await expect(page.locator("#glossary .abt-translation")).toContainText("仓库");
    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0].systemPrompt).toContain("Translation style preset: Technical");
    expect(harness.server.calls[0].systemPrompt).toContain("Terminology glossary");

    await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    await harness.setStorage({ siteProfiles: { "http://127.0.0.1": { preset: "news" } } });
    response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-news" });
    expect(response.ok).toBe(true);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[NEWS|GLOSSARY]");
    expect(harness.server.calls).toHaveLength(2);

    await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    await harness.setStorage({ siteProfiles: { "http://127.0.0.1": { preset: "technical" } } });
    response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", { taskId: "e2e-tech-again" });
    expect(response.ok).toBe(true);
    expect(response.cacheHits).toBe(1);
    expect(response.apiTranslated).toBe(0);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[TECH|GLOSSARY]");
    expect(harness.server.calls).toHaveLength(2);
  });
  test("lexical gateway reads bundled TFLex locally without Provider calls", async ({ harness }) => {
    const page = await harness.open("/article");
    expect(harness.server.calls).toHaveLength(0);

    const word = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "persistent",
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(word.ok).toBe(true);
    expect(word.status).toBe("candidates");
    expect(word.candidates).toHaveLength(2);
    expect(word.candidates[0].provenance.packId).toBe("core-semantic-en-zh-runtime-fixture");
    expect(harness.server.calls).toHaveLength(0);

    const phrase = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "terminal multiplexer",
      pageUrl: page.url()
    });
    expect(phrase.ok).toBe(true);
    expect(phrase.status).toBe("candidates");
    expect(phrase.candidates[0].translations).toEqual(["终端复用器"]);
    expect(harness.server.calls).toHaveLength(0);

    const alias = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "stateful",
      pageUrl: page.url()
    });
    expect(alias.ok).toBe(true);
    expect(alias.status).toBe("candidates");
    expect([...new Set(alias.candidates.map((candidate) => candidate.headword))]).toEqual(["persistent", "session"]);
    expect(alias.candidates).toHaveLength(3);
    expect(alias.candidates.every((candidate) => candidate.matchedBy === "alias")).toBe(true);
    expect(harness.server.calls).toHaveLength(0);

    const unsupported = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "persistent",
      pageUrl: page.url(),
      sourceLanguage: "ja",
      targetLanguage: "zh-CN"
    });
    expect(unsupported.status).toBe("unsupported");

    const miss = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "TFNoSuchLexeme",
      pageUrl: page.url()
    });
    expect(miss.status).toBe("no-hit");
    expect(harness.server.calls).toHaveLength(0);
    await page.close();
  });

});

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });
}

async function clearSelection(page) {
  await page.evaluate(() => {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
}
