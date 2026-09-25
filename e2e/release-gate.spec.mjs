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
    const page = await harness.open("/article");
    const tabId = await harness.tabId(page);
    await harness.driver.evaluate(({ tabId }) => chrome.tabs.update(tabId, { active: true }), { tabId });

    await popup.locator("#translate").click();
    await expect.poll(() => page.locator(".abt-translation").count()).toBeGreaterThan(0);
    const translatedCount = await page.locator(".abt-translation").count();
    expect(harness.server.calls).toHaveLength(1);

    await popup.locator("details").first().locator("summary").click();
    await popup.locator("#toggle").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("abt-hide-translations"))).toBe(true);
    await popup.locator("#toggle").click();
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("abt-hide-translations"))).toBe(false);

    await popup.locator("#clear").click();
    await expect(page.locator(".abt-translation")).toHaveCount(0);

    await popup.locator("details").nth(1).locator("summary").click();
    await popup.locator("#restore").click();
    await expect(page.locator(".abt-translation")).toHaveCount(translatedCount);
    expect(harness.server.calls).toHaveLength(1);
  });

  test("Popup release layout stays readable at normal extension width", async ({ harness }) => {
    const popup = harness.driver;
    await popup.setViewportSize({ width: 420, height: 720 });
    await popup.reload();

    const bodyBox = await popup.locator("body").boundingBox();
    expect(Math.round(bodyBox?.width || 0)).toBe(360);
    const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const label = popup.locator(".control-row .control-copy strong").first();
    const toggle = popup.getByRole("switch", { name: /本站自动翻译/ });
    const appearance = popup.locator("#appearanceSelect");
    const [labelBox, toggleBox, appearanceBox] = await Promise.all([
      label.boundingBox(),
      toggle.boundingBox(),
      appearance.boundingBox()
    ]);
    expect(labelBox?.width || 0).toBeGreaterThan(60);
    expect(toggleBox?.width || 0).toBeGreaterThanOrEqual(44);
    expect(appearanceBox?.width || 0).toBeGreaterThanOrEqual(120);
    await expect(popup.locator("details[open]")).toHaveCount(0);
    await expect(popup.locator(".tf-button--primary")).toHaveCount(1);
  });

  test("Quick Control remains dismissible and readable in dark mode", async ({ harness }) => {
    const page = await harness.open("/article");
    await page.emulateMedia({ colorScheme: "dark" });
    await harness.inject(page);
    const shown = await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");
    expect(shown.ok).toBe(true);

    const trigger = page.getByRole("button", { name: /TranslateFlow Quick Control/ });
    await expect(trigger).toBeVisible();
    const motionless = await trigger.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(motionless.color).not.toBe(motionless.background);

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
