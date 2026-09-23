import { test, expect } from "./support/extension-fixture.mjs";

test.describe("TranslateFlow MV3 smoke flows", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("manual translation renders bilingual DOM, preserves rich semantics and restores cache without another provider call", async ({ harness }) => {
    const page = await harness.open("/article");
    await harness.inject(page);

    const translated = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", {
      taskId: "e2e-manual"
    });
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
    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": {
          provider: "openai-compatible",
          model: "site-mock-model",
          targetLanguage: "Japanese",
          preset: "technical"
        }
      }
    });

    const response = await harness.runtime({
      type: "EFFECTIVE_CONTEXT",
      pageUrl: page.url()
    });

    expect(response.ok).toBe(true);
    expect(response.context).toMatchObject({
      hostname: "127.0.0.1",
      provider: "openai-compatible",
      model: "site-mock-model",
      targetLanguage: "Japanese",
      presetId: "technical",
      presetLabel: "Technical",
      presetSource: "site"
    });
  });

  test("selection translation shows a popover and the second invocation is served from cache", async ({ harness }) => {
    const page = await harness.open("/selection");
    await harness.inject(page);

    await selectElementText(page, "#selectable");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
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

    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": { preset: "technical" }
      },
      glossary: {
        version: 1,
        entries: [{
          id: "repository",
          source: "repository",
          target: "仓库",
          caseSensitive: false,
          enabled: true
        }]
      }
    });

    let response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", {
      taskId: "e2e-tech"
    });
    expect(response.ok).toBe(true);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[TECH|GLOSSARY]");
    await expect(page.locator("#glossary .abt-translation")).toContainText("仓库");
    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0].systemPrompt).toContain("Translation style preset: Technical");
    expect(harness.server.calls[0].systemPrompt).toContain("Terminology glossary");

    await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": { preset: "news" }
      }
    });

    response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", {
      taskId: "e2e-news"
    });
    expect(response.ok).toBe(true);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[NEWS|GLOSSARY]");
    expect(harness.server.calls).toHaveLength(2);

    await harness.sendContent(page, "ABT_CLEAR_TRANSLATIONS");
    await harness.setStorage({
      siteProfiles: {
        "http://127.0.0.1": { preset: "technical" }
      }
    });

    response = await harness.sendContent(page, "ABT_TRANSLATE_PAGE", {
      taskId: "e2e-tech-again"
    });
    expect(response.ok).toBe(true);
    expect(response.cacheHits).toBe(1);
    expect(response.apiTranslated).toBe(0);
    await expect(page.locator("#glossary .abt-translation")).toContainText("[TECH|GLOSSARY]");
    expect(harness.server.calls).toHaveLength(2);
  });
});

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}

async function clearSelection(page) {
  await page.evaluate(() => {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  });
}
