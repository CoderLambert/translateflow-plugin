import { test, expect } from "./support/extension-fixture.mjs";

test.use({ nativeMessagingPregranted: true });

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
    await expect(section.getByRole("link", { name: "下载 TranslateFlow 本地组件" })).toHaveAttribute("href", /github\.com\/CoderLambert\/translateflow-plugin\/releases\/latest/u);
    await section.getByRole("button", { name: "已经安装 · 重新检测" }).click();
    await expect(section.getByRole("status")).toContainText("当前用户尚未安装或注册 TranslateFlow native host");
    await expect(section.getByRole("button", { name: "重启本地组件" })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "连接 ChatGPT 账号" })).toHaveCount(0);

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
