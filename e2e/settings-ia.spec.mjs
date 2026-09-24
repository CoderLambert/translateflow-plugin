import { test, expect } from "./support/extension-fixture.mjs";

test.describe("Settings information architecture", () => {
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  test("section navigation is keyboard-focusable and YouTube defaults persist after reload", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/options.html`);

    const nav = page.getByRole("navigation", { name: "设置分类" });
    await expect(nav.getByRole("link", { name: "通用" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "YouTube" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Provider" })).toBeVisible();

    await nav.getByRole("link", { name: "YouTube" }).click();
    await expect(page.locator("#youtube")).toBeFocused();

    await page.locator("#youtubeSubtitleMode").selectOption("original");
    await page.locator("#youtubeSubtitleSize").selectOption("large");
    await page.getByRole("button", { name: "保存全局设置" }).click();
    await expect(page.locator("#status")).toContainText("全局设置已保存");

    await page.reload();
    await expect(page.locator("#youtubeSubtitleMode")).toHaveValue("original");
    await expect(page.locator("#youtubeSubtitleSize")).toHaveValue("large");

    const stored = await harness.getStorage(["youtubeSubtitleMode", "youtubeSubtitleSize"]);
    expect(stored).toEqual({ youtubeSubtitleMode: "original", youtubeSubtitleSize: "large" });
    await page.close();
  });
});
