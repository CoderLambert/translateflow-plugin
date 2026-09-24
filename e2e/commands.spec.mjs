import { test, expect } from "./support/extension-fixture.mjs";

test.describe("Chrome Commands MV3 routing", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("first-use translate injects the shipped bundle and the remaining commands toggle page state", async ({ harness }) => {
    const page = await harness.open("/article");

    const translated = await routeCommand(harness, page, "translate-page");
    expect(translated?.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(3);
    expect(harness.server.calls).toHaveLength(1);

    let hidden = await routeCommand(harness, page, "toggle-translations");
    expect(hidden).toMatchObject({ ok: true, hidden: true });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(true);

    hidden = await routeCommand(harness, page, "toggle-translations");
    expect(hidden).toMatchObject({ ok: true, hidden: false });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(false);

    let quick = await routeCommand(harness, page, "toggle-quick-control");
    expect(quick).toMatchObject({ ok: true, visible: true });
    await expect(page.getByRole("button", { name: "TranslateFlow Quick Control" })).toBeVisible();

    quick = await routeCommand(harness, page, "toggle-quick-control");
    expect(quick).toMatchObject({ ok: true, visible: false });
    await expect(page.getByRole("button", { name: "TranslateFlow Quick Control" })).toHaveCount(0);
  });

  test("protected Chrome pages are rejected before content injection", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.goto("chrome://extensions/");
    const result = await routeCommand(harness, page, "translate-page");
    expect(result).toEqual({ ok: false, unsupported: true });
  });
});

async function routeCommand(harness, page, command) {
  await page.bringToFront();
  await expect.poll(async () => harness.driver.evaluate(async ({ expectedUrl }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url === expectedUrl;
  }, { expectedUrl: page.url() })).toBe(true);

  return harness.driver.evaluate(async ({ extensionId, command }) => {
    const module = await import(`chrome-extension://${extensionId}/src/background/commands.js`);
    return module.routeCommand(command);
  }, { extensionId: harness.extensionId, command });
}
