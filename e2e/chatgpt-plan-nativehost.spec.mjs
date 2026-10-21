import { test, expect } from "./support/extension-fixture.mjs";

test.use({ nativeMessagingPregranted: true });

test.describe("ChatGPT Plan native host Settings", () => {
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  test("public WXT shows a GitHub developer guide rather than account controls", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    test.skip(manifest.version_name === `${manifest.version}-dev`, "Public edition only");
    const section = page.locator("#settings-panel-provider");
    await expect(section.getByText("ChatGPT 订阅 · 开发者预览")).toBeVisible();
    await expect(section.getByRole("link", { name: "GitHub 开发版及配置说明" }))
      .toHaveAttribute("href", "https://github.com/CoderLambert/translateflow-plugin/blob/main/docs/CHATGPT_DEVELOPMENT_BUILD.md");
    await expect(section.getByRole("button", { name: "检查状态并加载模型" })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "连接 ChatGPT 账号" })).toHaveCount(0);
    await expect(section.getByRole("option", { name: "ChatGPT 订阅", exact: true })).toHaveCount(0);
    await page.close();
  });

  test("the real WXT Settings surface recovers when the user-level host is absent", async ({ harness }, testInfo) => {
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    test.skip(manifest.version_name !== `${manifest.version}-dev`, "Developer edition only");
    const section = page.getByRole("heading", { name: "Provider · ChatGPT 订阅", exact: true }).locator("..");

    await expect(section).toBeVisible();
    await expect(section.getByRole("status")).toContainText("尚未检查连接");
    await section.getByRole("button", { name: "检查状态并加载模型" }).click();
    await expect(section.getByRole("status")).toContainText("当前用户尚未安装或注册 TranslateFlow native host");
    await expect(section.getByText("本地组件尚未发布公开安装包。请勿从未验证的来源下载或运行未签名候选文件。")).toBeVisible();
    await expect(section.getByRole("link", { name: /下载 TranslateFlow 本地组件/u })).toHaveCount(0);
    await section.getByText("开发版测试注册", { exact: true }).click();
    const version = await page.evaluate(() => chrome.runtime.getManifest().version);
    const buildCommand = `TF_CHROME_EXTENSION_ID=${harness.extensionId} TF_NATIVE_HOST_VERSION=${version} npm run build:native-host:candidate`;
    const binary = `./.output/native-host-candidate/translateflow-host-${version}-linux-amd64`;
    await expect(section.getByText(harness.extensionId, { exact: true })).toBeVisible();
    await expect(section.getByText(buildCommand, { exact: true })).toBeVisible();
    await expect(section.getByText(binary, { exact: true })).toBeVisible();
    await expect(section.getByText(`${binary} install --browser chromium`, { exact: true })).toBeVisible();
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
