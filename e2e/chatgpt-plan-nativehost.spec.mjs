import { test, expect } from "./support/extension-fixture.mjs";

test.describe("ChatGPT Plan native host Settings", () => {
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  test("the real WXT Settings surface recovers when the user-level host is absent", async ({ harness }, testInfo) => {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
    const section = page.getByRole("heading", { name: "Provider · ChatGPT 订阅", exact: true }).locator("..");

    await expect(section).toBeVisible();
    await expect(section.getByRole("status")).toContainText("尚未检查连接");
    await section.getByRole("button", { name: "检查状态并加载模型" }).click();
    await expect(section.getByRole("status")).toContainText("当前用户尚未安装或注册 TranslateFlow native host");
    await expect(section.getByRole("button", { name: "连接 ChatGPT 账号" })).toBeEnabled();
    await expect(section.getByRole("button", { name: "添加其他账号" })).toBeEnabled();

    await page.setViewportSize({ width: 390, height: 780 });
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);
    await section.screenshot({ path: testInfo.outputPath("chatgpt-host-missing-narrow.png"), caret: "initial" });
    await page.close();
  });
});
