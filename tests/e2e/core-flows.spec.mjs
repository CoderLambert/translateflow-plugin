import { test, expect } from "./fixtures.mjs";

test.describe("TranslateFlow MV3 smoke flows", () => {
  test("manual translation renders bilingual DOM and cache restore makes no second provider call", async ({ harness }) => {
    const page = await harness.openFixture("?flow=manual");

    const translated = await harness.translatePage(page);
    expect(translated?.ok).toBe(true);
    expect(translated?.apiTranslated).toBeGreaterThan(0);

    await expect(page.locator("#plain > .abt-translation")).toContainText("E2E 译文");
    const providerCalls = harness.server.calls.length;
    expect(providerCalls).toBeGreaterThan(0);

    const cleared = await harness.send(page, { type: "ABT_CLEAR_TRANSLATIONS" });
    expect(cleared?.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(0);

    const restored = await harness.send(page, { type: "ABT_RESTORE_CACHE" });
    expect(restored?.ok).toBe(true);
    expect(restored?.cacheHits).toBeGreaterThan(0);
    await expect(page.locator("#plain > .abt-translation")).toContainText("E2E 译文");
    expect(harness.server.calls.length).toBe(providerCalls);
  });

  test("automatic incremental translation sends only newly appended uncached content", async ({ harness }) => {
    const page = await harness.openFixture("?flow=incremental");

    const enabled = await harness.send(page, { type: "ABT_ENABLE_AUTO" });
    expect(enabled?.ok).toBe(true);

    await expect.poll(async () => {
      const status = await harness.send(page, { type: "ABT_STATUS" });
      return {
        count: status?.count || 0,
        running: Boolean(status?.running)
      };
    }).toEqual({ count: 4, running: false });

    harness.server.resetCalls();
    await page.evaluate(() => window.appendFixtureParagraph());

    await expect(page.locator("#dynamic-paragraph > .abt-translation")).toContainText("E2E 译文");
    await expect.poll(() => harness.server.calls.length).toBe(1);

    const sentText = harness.server.calls[0].segments.map((item) => item.text).join("\n");
    expect(sentText).toContain("newly appended paragraph");
    expect(sentText).not.toContain("keeps the original English source");
  });

  test("site profile resolves provider model target language and preset from real extension storage", async ({ harness }) => {
    const page = await harness.openFixture("?flow=profile");
    const origin = new URL(page.url()).origin;

    await harness.setConfig({
      siteProfiles: {
        [origin]: {
          provider: "openai-compatible",
          model: "site-e2e-model",
          targetLanguage: "Japanese",
          preset: "academic"
        }
      }
    });

    const context = await harness.contextFor(page.url());
    expect(context.origin).toBe(origin);
    expect(context.provider).toBe("openai-compatible");
    expect(context.model).toBe("site-e2e-model");
    expect(context.targetLanguage).toBe("Japanese");
    expect(context.presetId).toBe("academic");
    expect(context.presetSource).toBe("site");
  });

  test("selection translation shows popover result and second identical selection is cache-only", async ({ harness }) => {
    const page = await harness.openFixture("?flow=selection");
    const target = page.locator("#selection-target");

    await target.selectText();
    await target.dispatchEvent("mouseup");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();

    await expect(page.locator(".tf-selection-result")).toContainText("E2E 译文");
    const providerCalls = harness.server.calls.length;
    expect(providerCalls).toBeGreaterThan(0);

    await page.getByRole("button", { name: "关闭" }).click();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    await target.selectText();
    await target.dispatchEvent("mouseup");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("E2E 译文");

    expect(harness.server.calls.length).toBe(providerCalls);
  });

  test("auth failure is actionable, and 429/500 retries recover without a stuck task", async ({ harness }) => {
    const selectionPage = await harness.openFixture("?flow=auth-error");
    const target = selectionPage.locator("#selection-target");

    harness.server.failNext(401, 1, "invalid e2e key");
    await target.selectText();
    await target.dispatchEvent("mouseup");
    await expect(selectionPage.locator(".tf-selection-chip")).toBeVisible();
    await selectionPage.locator(".tf-selection-chip").click();

    await expect(selectionPage.locator(".tf-selection-status")).toContainText("invalid e2e key");
    await expect(selectionPage.getByRole("button", { name: "重试" })).toBeVisible();

    await selectionPage.getByRole("button", { name: "重试" }).click();
    await expect(selectionPage.locator(".tf-selection-result")).toContainText("E2E 译文");

    for (const status of [429, 500]) {
      harness.server.resetCalls();
      harness.server.failNext(status, 1, `transient ${status}`);

      const page = await harness.openFixture(`?flow=retry-${status}`);
      const result = await harness.translatePage(page);
      expect(result?.ok).toBe(true);
      await expect(page.locator("#plain > .abt-translation")).toContainText("E2E 译文");
      expect(harness.server.calls.length).toBeGreaterThanOrEqual(2);

      const taskStatus = await harness.send(page, {
        type: "TF_TASK_STATUS",
        taskId: result?.task?.id || ""
      });
      expect(["completed", undefined]).toContain(taskStatus?.task?.state);
      await page.close();
    }
  });

  test("rich inline translation reconstructs safe strong link and code semantics", async ({ harness }) => {
    const page = await harness.openFixture("?flow=rich");
    const result = await harness.translatePage(page);
    expect(result?.ok).toBe(true);

    const translation = page.locator("#rich > .abt-translation");
    await expect(translation).toContainText("E2E 译文");
    await expect(translation.locator("strong")).toHaveText("important statement");
    await expect(translation.locator("a")).toHaveAttribute("href", /\/docs$/);
    await expect(translation.locator("code")).toHaveText("fetch()");
  });

  test("glossary and preset both reach the effective prompt and cache versions remain reusable", async ({ harness }) => {
    const page = await harness.openFixture("?flow=glossary-preset");
    const origin = new URL(page.url()).origin;

    await harness.setConfig({
      siteProfiles: {
        [origin]: { preset: "technical" }
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

    let result = await harness.translatePage(page);
    expect(result?.ok).toBe(true);
    expect(harness.server.calls.length).toBeGreaterThan(0);

    const technicalCall = harness.server.calls.at(-1);
    expect(technicalCall.systemPrompt).toContain("Translation style preset: Technical");
    expect(technicalCall.systemPrompt).toContain("Terminology glossary");
    expect(technicalCall.systemPrompt).toContain('"repository" -> "仓库"');

    const technicalCallCount = harness.server.calls.length;
    await harness.send(page, { type: "ABT_CLEAR_TRANSLATIONS" });

    await harness.setConfig({
      siteProfiles: {
        [origin]: { preset: "news" }
      }
    });
    result = await harness.translatePage(page);
    expect(result?.ok).toBe(true);
    expect(harness.server.calls.length).toBeGreaterThan(technicalCallCount);
    expect(harness.server.calls.at(-1).systemPrompt).toContain("Translation style preset: News");

    const afterNewsCalls = harness.server.calls.length;
    await harness.send(page, { type: "ABT_CLEAR_TRANSLATIONS" });
    await harness.setConfig({
      siteProfiles: {
        [origin]: { preset: "technical" }
      }
    });

    result = await harness.translatePage(page);
    expect(result?.ok).toBe(true);
    expect(result?.cacheHits).toBeGreaterThan(0);
    expect(harness.server.calls.length).toBe(afterNewsCalls);
  });

  test("popup effective context can be read from the loaded extension without a real API key", async ({ harness }) => {
    const page = await harness.openFixture("?flow=context");
    const context = await harness.contextFor(page.url());

    expect(context.hostname).toBe("127.0.0.1");
    expect(context.provider).toBe("openai-compatible");
    expect(context.model).toBe("e2e-model");

    const stored = await harness.getConfig(["openAICompatible"]);
    expect(stored.openAICompatible.apiKey).toBe("e2e-key");
  });
});
