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

  test("dictionary library separates trust classes and stays usable at narrow width", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );

    const nav = page.getByRole("navigation", { name: "设置分类" });
    const dictionaryNav = nav.getByRole("link", { name: "词典库" });
    await expect(dictionaryNav).toBeVisible();
    await dictionaryNav.click();
    await expect(page.locator("#dictionary-packs")).toBeFocused();

    const library = page.locator("#dictionary-packs");
    await expect(library.getByRole("heading", { name: "词典库", exact: true })).toBeVisible();
    await expect(
      library.locator("h3").allTextContents()
    ).resolves.toEqual([
      "内置词典",
      "精选上游与官方词典",
      "已安装",
      "本地导入"
    ]);
    await expect(
      library.getByRole("heading", { name: "官方词典", exact: true })
    ).toBeVisible();
    await expect(
      library.getByRole("heading", { name: "精选上游", exact: true })
    ).toBeVisible();

    await expect(page.locator("#dictionaryPacksList"))
      .toContainText("当前没有符合发布条件的官方词典");
    const curated = page
      .locator("#curatedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(curated).toBeVisible();
    await expect(curated).toContainText("精选上游 · 非官方");
    await expect(
      curated.getByRole("link", { name: "访问上游项目" })
    ).toBeVisible();
    await expect(
      curated.getByRole("link", { name: "查看上游许可说明" })
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "本地导入", exact: true })).toBeVisible();
    await expect(page.locator("#localDictionaryChooseFiles")).toBeVisible();
    await expect(page.locator("#localDictionaryFiles")).toHaveAttribute("multiple", "");
    await expect(library).not.toContainText("OPFS");

    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);

    await page.locator("#refreshDictionaryPacks").focus();
    await expect(page.locator("#refreshDictionaryPacks")).toBeFocused();
    await page.close();
  });

});
