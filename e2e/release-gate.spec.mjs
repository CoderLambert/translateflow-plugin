import { test, expect } from "./support/extension-fixture.mjs";

test.describe("v0.8 release-gate browser flows", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.afterEach(async ({ harness }) => {
    for (const page of harness.context.pages()) {
      if (page !== harness.driver && !page.isClosed()) await page.close();
    }
  });

  test("Popup drives translate, visibility, removal and cache-only restore on the active page", async ({ harness }) => {
    const popup = await harness.context.newPage();
    await popup.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    const page = await harness.open("/release-popup");
    const tabId = await harness.tabId(page);

    await harness.driver.evaluate(({ tabId }) => chrome.tabs.update(tabId, { active: true }), { tabId });

    await popup.evaluate(() => document.getElementById("translate").click());
    await expect(page.locator(".abt-translation")).toHaveCount(1);
    expect(harness.server.calls).toHaveLength(1);
    await expect(popup.locator("#status")).not.toHaveText("准备就绪");

    await popup.evaluate(() => document.getElementById("toggle").click());
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(true);
    await popup.evaluate(() => document.getElementById("toggle").click());
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains("abt-hide-translations")
    )).toBe(false);

    await popup.evaluate(() => document.getElementById("clear").click());
    await expect(page.locator(".abt-translation")).toHaveCount(0);

    await popup.evaluate(() => document.getElementById("restore").click());
    await expect(page.locator(".abt-translation")).toHaveCount(1);
    expect(harness.server.calls).toHaveLength(1);
  });

  test("Popup keeps primary preference controls readable without vertical label collapse", async ({ harness }) => {
    const popup = await harness.context.newPage();
    await popup.setViewportSize({ width: 400, height: 700 });
    await popup.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    const row = popup.locator(".control-row").first();
    const label = row.locator("strong");
    const button = row.locator(".compact-btn");
    await expect(row).toBeVisible();
    const [labelBox, buttonBox] = await Promise.all([label.boundingBox(), button.boundingBox()]);
    expect(labelBox.width).toBeGreaterThan(80);
    expect(buttonBox.width).toBeGreaterThanOrEqual(120);
    await expect(popup.locator("#appearanceSelect")).toBeVisible();
  });

  test("Quick Control supports keyboard dismissal, click-outside and dark-mode readable controls", async ({ harness }) => {
    const page = await harness.open("/release-ui");
    await page.emulateMedia({ colorScheme: "dark" });
    await harness.inject(page);
    const shown = await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");
    expect(shown.ok).toBe(true);

    const trigger = page.getByRole("button", { name: "TranslateFlow Quick Control" });
    await expect(trigger).toBeVisible();
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);

    const colors = await trigger.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(colors.color).not.toBe(colors.background);
    expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "TranslateFlow Quick Control" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.locator("main").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
  });
});
