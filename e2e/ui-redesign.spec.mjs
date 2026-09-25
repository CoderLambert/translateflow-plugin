import { test, expect } from "./support/extension-fixture.mjs";

test.describe("UI redesign release gate", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("Popup is width-bounded, non-overflowing and keeps advanced controls collapsed", async ({ harness }) => {
    const popup = harness.driver;
    await popup.setViewportSize({ width: 420, height: 720 });
    await popup.reload();

    const bodyBox = await popup.locator("body").boundingBox();
    expect(Math.round(bodyBox?.width || 0)).toBe(360);

    const overflow = await popup.evaluate(() => ({
      root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth
    }));
    expect(overflow.root).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);

    await expect(popup.locator("details[open]")).toHaveCount(0);
    await expect(popup.locator(".tf-button--primary")).toHaveCount(1);
    await expect(popup.getByRole("switch", { name: /本站自动翻译/ })).toHaveAttribute("role", "switch");
  });

  test("Settings keeps active navigation, bounded desktop content and a usable narrow layout", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${harness.extensionId}/options.html`);

    const shell = page.locator(".settings-shell");
    await expect(shell).toBeVisible();
    const desktop = await shell.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        columns: style.gridTemplateColumns,
        width: node.getBoundingClientRect().width
      };
    });
    expect(desktop.columns).toContain("240px");
    expect(desktop.width).toBeLessThanOrEqual(1240);

    await expect(page.locator('.settings-nav a[href="#general"]')).toHaveAttribute("aria-current", "page");
    await page.locator('.settings-nav a[href="#appearance"]').click();
    await expect(page.locator('.settings-nav a[href="#appearance"]')).toHaveAttribute("aria-current", "page");

    const promptWidth = await page.locator("#prompt").evaluate((node) => node.getBoundingClientRect().width);
    expect(promptWidth).toBeLessThanOrEqual(760);

    await page.setViewportSize({ width: 700, height: 900 });
    const narrow = await shell.evaluate((node) => ({
      display: getComputedStyle(node).display,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    expect(narrow.display).toBe("block");
    expect(narrow.overflow).toBeLessThanOrEqual(0);
    await expect(page.locator("#cacheRestoreSitesList")).toBeVisible();

    await page.close();
  });

  test("reduced-motion preference removes nonessential Quick Control transitions", async ({ harness }) => {
    const page = await harness.open("/article");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await harness.inject(page);
    await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");

    const trigger = page.getByRole("button", { name: /TranslateFlow Quick Control/ });
    await expect(trigger).toBeVisible();

    const motion = await trigger.evaluate((node) => ({
      transitionDuration: getComputedStyle(node).transitionDuration,
      animationDuration: getComputedStyle(node).animationDuration
    }));
    expect(motion.transitionDuration).toBe("0s");
    expect(motion.animationDuration).toBe("0s");

    await page.close();
  });
});
