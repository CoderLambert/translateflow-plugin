import { test, expect } from "./support/extension-fixture.mjs";

test.describe("Chrome Commands MV3 routing", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("first-use translate injects the shipped bundle and the remaining commands toggle page state", async ({ harness }) => {
    const page = await harness.open("/commands");

    const translated = await routeCommand(harness, page, "translate-page");
    expect(translated?.ok).toBe(true);
    await expect(page.locator(".abt-translation")).toHaveCount(1);
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

  test("production router rejects protected tabs before send or injection", async ({ harness }) => {
    const result = await harness.driver.evaluate(async ({ extensionId }) => {
      const module = await import(`chrome-extension://${extensionId}/src/background/commands.js`);
      let sends = 0;
      let injections = 0;
      const route = module.createCommandRouter({
        queryActiveTab: async () => ({ id: 99, url: "chrome://extensions/" }),
        sendContentMessage: async () => { sends += 1; return { ok: true }; },
        injectContent: async () => { injections += 1; }
      });
      return {
        response: await route(module.COMMANDS.TRANSLATE_PAGE),
        sends,
        injections
      };
    }, { extensionId: harness.extensionId });

    expect(result).toEqual({
      response: { ok: false, unsupported: true },
      sends: 0,
      injections: 0
    });
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
