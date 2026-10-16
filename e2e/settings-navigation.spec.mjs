import { test, expect } from "./support/extension-fixture.mjs";

const visiblePanels = page => page.locator(".settings-panel:not([hidden])");
const link = (page, id) => page.locator(`.settings-nav a[href="#${id}"]`);
async function open(harness, hash = "") {
  await harness.reset();
  const page = await harness.context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`chrome-extension://${harness.extensionId}/options.html${hash}`);
  await expect(visiblePanels(page)).toHaveCount(1);
  return page;
}

test("each settings link displays only its category with working focus and Escape", async ({ harness }, testInfo) => {
  const page = await open(harness);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "general");
  const ids = await page.locator("[data-settings-nav]").evaluateAll(nodes => nodes.map(node => node.hash.slice(1)));
  for (const id of ids) {
    const control = link(page, id);
    await control.focus(); await control.press("Enter");
    await expect(visiblePanels(page)).toHaveCount(1);
    await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", id);
    await expect(visiblePanels(page)).toBeFocused();
    await expect(control).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape"); await expect(control).toBeFocused();
    await expect(page.locator("#save")).toBeVisible();
    if (id === "provider") await expect(page.locator("#test")).toBeVisible();
    else await expect(page.locator("#test")).toHaveCount(0);
  }
  await link(page, "auto-sites").click();
  await expect(page.locator("#general")).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("settings-behavior-desktop.png"), fullPage: true });
  expect(harness.server.calls).toHaveLength(0);
});

test("switching categories preserves global and local drafts until the unified save", async ({ harness }) => {
  const page = await open(harness);
  const before = await harness.getStorage(["targetLanguage", "youtubeSubtitleMode"]);
  await page.locator("#targetLanguage").fill("Japanese");
  await link(page, "youtube").click();
  await page.locator("#youtubeSubtitleMode").selectOption("original");
  await link(page, "provider").click();
  await page.locator("#connectionName").fill("Unsaved connection draft");
  await link(page, "general").click();
  await expect(page.locator("#targetLanguage")).toHaveValue("Japanese");
  expect(await harness.getStorage(["targetLanguage", "youtubeSubtitleMode"])).toEqual(before);
  await link(page, "provider").click();
  await expect(page.locator("#connectionName")).toHaveValue("Unsaved connection draft");
  await link(page, "appearance").click();
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("全局设置已保存");
  expect(await harness.getStorage(["targetLanguage", "youtubeSubtitleMode"]))
    .toEqual({ targetLanguage: "Japanese", youtubeSubtitleMode: "original" });
  await page.reload();
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "appearance");
  await link(page, "general").click(); await expect(page.locator("#targetLanguage")).toHaveValue("Japanese");
  await link(page, "youtube").click(); await expect(page.locator("#youtubeSubtitleMode")).toHaveValue("original");
  expect(harness.server.calls).toHaveLength(0);
});

test("deep links, browser history and invalid routes work in a narrow dark layout", async ({ harness }, testInfo) => {
  const page = await open(harness, "#auto-sites");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "auto-sites");
  await link(page, "cache").click();
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "cache");
  await page.goBack();
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "auto-sites");
  await page.goForward();
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "cache");
  await page.reload();
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "cache");
  await expect(visiblePanels(page)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.locator("#cacheMaxMB")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("settings-cache-dark-narrow.png"), fullPage: true });
  await page.evaluate(() => { location.hash = "unknown-category"; });
  await expect(visiblePanels(page)).toHaveAttribute("data-settings-panel", "general");
  await expect(page).toHaveURL(/#general$/u);
});
