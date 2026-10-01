import { test, expect } from "./support/extension-fixture.mjs";
import { BACKGROUND_MESSAGES } from "../src/shared/constants.js";
import { CURATED_DICTIONARIES } from "../src/shared/curated-dictionaries.js";

const ecdict = CURATED_DICTIONARIES.find((item) => item.id === "ecdict-en-zh-mdx-curated");

function richEntry(source, overrides = {}) {
  return {
    id: source.output.packId,
    title: source.mdx.title,
    fileName: source.mdx.fileName,
    format: "HTML",
    status: "ready",
    sourceSize: source.mdx.bytes,
    indexSize: 4_194_304,
    installedBytes: source.mdx.bytes + 4_194_304,
    entryCount: source.mdx.entryCount,
    resourceCount: 0,
    resourceBytes: 0,
    installedAt: Date.parse("2026-10-01T00:00:00Z"),
    catalog: {
      entryId: source.id,
      installedVersion: source.output.packId
    },
    curated: {
      recipeId: source.id,
      upstreamRevision: source.upstreamRevision,
      mdxSha256: source.mdx.sha256
    },
    ...overrides
  };
}

test.describe("Dictionary Library v2 presentation", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("separates source freshness, review, trust and installed lifecycle with accessible responsive UX", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.setViewportSize({ width: 390, height: 844 });
    await options.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

    const seeded = [
      richEntry(ecdict),
      {
        id: "user-partial-fixture",
        title: "本地测试词典",
        fileName: "sample.mdx",
        format: "HTML",
        status: "ready",
        packVersion: "user-mdx-v2",
        sourceSize: 4_096,
        indexSize: 1_024,
        installedBytes: 5_120,
        entryCount: 3,
        resourceCount: 1,
        resourceBytes: 2_048,
        installedAt: Date.parse("2026-09-29T00:00:00Z"),
        compatibility: {
          status: "partial",
          unsupportedCapabilities: ["mdx.compression.lzo"]
        }
      },
      {
        id: "user-corrupt-fixture",
        title: "检查失败的本地词典",
        fileName: "corrupt.mdx",
        status: "corrupt",
        entryCount: 4,
        sourceSize: 1_024
      },
      {
        id: "user-missing-fixture",
        title: "文件缺失的本地词典",
        fileName: "missing.mdx",
        status: "missing",
        entryCount: 4,
        sourceSize: 1_024
      }
    ];
    await options.addInitScript((config) => {
      window.__tfDictionaryRows = config.dictionaries;
      const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        const message = args[0] || {};
        if (message.type === config.packStatusMessage) {
          return Promise.resolve({ ok: true, state: { packs: {} } });
        }
        if (message.type === config.richListMessage) {
          return Promise.resolve({ ok: true, dictionaries: window.__tfDictionaryRows });
        }
        return originalSendMessage(...args);
      };
    }, {
      dictionaries: seeded,
      packStatusMessage: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS,
      richListMessage: BACKGROUND_MESSAGES.RICH_MDICT_LIST
    });

    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const curated = options.locator(
      `#curatedDictionaryList [data-recipe-id="${ecdict.id}"]`
    );
    await expect(curated).toBeVisible();
    await expect(curated).toContainText("精选上游 · 非官方");
    await expect(curated).toContainText("上游版本");
    await expect(curated).toContainText("1.0.28");
    await expect(curated).toContainText("发布日期");
    await expect(curated).toContainText("2017-09-20");
    await expect(curated).toContainText("词典内容日期");
    await expect(curated).toContainText("2017-06-03");
    await expect(curated).toContainText("兼容性审核日期");
    await expect(curated).toContainText("2026-10-01");
    await expect(curated).toContainText("内容日期较早");
    await expect(curated).toContainText("许可与使用条款");
    await expect(curated).toContainText("未注明 CC 版本");
    await expect(curated).toContainText("已安装 · 可用");
    await expect(curated).not.toContainText("当前版本");

    const installedRich = options.locator("#richMdictInstalledList");
    await expect(installedRich).toContainText("已安装上游版本 1.0.28 的本地副本");
    await expect(installedRich).toContainText("已安装大小");
    await expect(installedRich).toContainText("本地附件");
    const partial = installedRich.locator('[data-dictionary-id="user-partial-fixture"]');
    await expect(partial).toContainText("本地导入 · 用户提供 / 未验证");
    await expect(partial).toContainText("由你本机提供；请确认你有权使用");
    await expect(partial).toContainText("语言方向");
    await expect(partial).toContainText("本地安装版本");
    await expect(partial).toContainText("user-mdx-v2");
    await expect(partial).toContainText("本地安装日期");
    await expect(partial).toContainText("2026-09-29");
    await expect(partial).toContainText("可使用 · 部分功能受限");
    await expect(partial).toContainText("LZO 压缩");
    await expect(partial).toContainText("2.0 KiB");
    await expect(installedRich.locator('[data-dictionary-id="user-corrupt-fixture"]')).toContainText("检查失败");
    await expect(installedRich.locator('[data-dictionary-id="user-missing-fixture"]')).toContainText("文件缺失");

    const official = options.locator("#dictionaryPacksList");
    await expect(official).toContainText("当前没有符合发布条件的官方词典");
    await expect(official).not.toContainText("官方推荐");
    await expect(options.locator("#dictionary-packs")).not.toContainText(/OPFS|隔离区|查询索引|Rich Viewer|当前审核版本/u);

    const limitations = curated.locator("details");
    const summary = limitations.locator("summary");
    await summary.focus();
    await options.keyboard.press("Space");
    await expect(limitations).toHaveAttribute("open", "");
    expect(await summary.evaluate((element) => element.matches(":focus-visible"))).toBe(true);

    const display = await options.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      appBackground: getComputedStyle(document.documentElement).getPropertyValue("--tf-bg-app").trim(),
      buttonTransition: getComputedStyle(document.querySelector("#richMdictInstalledList button")).transitionDuration
    }));
    expect(display.width).toBeLessThanOrEqual(display.clientWidth);
    expect(display.appBackground).toBe("#1f261f");
    expect(display.buttonTransition).toMatch(/^0s(?:,\s*0s)*$/u);

    await options.evaluate(() => {
      const entry = window.__tfDictionaryRows[0];
      entry.curated.upstreamRevision = "1.0.27";
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
    });
    await expect(curated).toContainText("有已审核更新");
    await expect(curated.getByRole("button", { name: "更新 ECDICT 简明英汉增强版" })).toBeVisible();

    await options.evaluate(() => {
      window.__tfDictionaryRows[0].status = "corrupt";
      document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed"));
    });
    await expect(curated).toContainText("需要修复");
    await expect(curated.getByRole("button", { name: "重新安装 ECDICT 简明英汉增强版" })).toBeVisible();
  });
});
