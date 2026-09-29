import {
  test,
  expect
} from "./support/extension-fixture.mjs";
import {
  makeMdx
} from "../tests/helpers/mdict-fixture.mjs";

test.describe("strict MDict visible local import", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("Settings MDX import activates Selection with zero Provider calls and remains uninstallable", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );

    const mdx = makeMdx([
      ["issueonesevenmdict", "MDict 本地导入专用释义"],
      ["run", "跑；运行"]
    ]);
    const started = Date.now();

    await options.locator("#mdictFile").setInputFiles({
      name: "issue167.mdx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(mdx)
    });
    await expect(
      options.locator("#mdictInspectionMeta")
    ).toContainText("Issue 167 MDict");
    await expect(
      options.locator("#mdictInspectionMeta")
    ).toContainText("MDX 引擎");
    await expect(
      options.locator("#mdictInspectionMeta")
    ).toContainText("不渲染 HTML/CSS/JS");

    await options
      .locator("#mdictSemanticConfirmation")
      .check();
    await options.locator("#mdictImportButton").click();
    await expect(
      options.locator("#mdictImportProgress")
    ).toContainText("完成", { timeout: 90_000 });

    const progress = String(
      await options
        .locator("#mdictImportProgress")
        .textContent()
    ).trim();
    console.log(
      "[MDICT_PRODUCT_METRICS]",
      JSON.stringify({
        inputBytes: mdx.byteLength,
        output: progress,
        installMs: Date.now() - started
      })
    );

    const installed = options
      .locator("#installedDictionaryList .site-row")
      .filter({ hasText: "Issue 167 MDict" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("本地导入");
    await expect(installed).toContainText("MDict");
    await expect(installed).toContainText("用户提供 · 未验证");

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "issue-167-mdict-word";
      node.textContent = "issueonesevenmdict";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(
      page,
      "#issue-167-mdict-word"
    );
    await page.locator(".tf-selection-chip").click();
    await expect(
      page.locator(".tf-selection-result")
    ).toContainText("MDict 本地导入专用释义");
    expect(harness.server.calls).toHaveLength(0);

    const lookup = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "issueonesevenmdict",
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(lookup.ok).toBe(true);
    expect(lookup.status).toBe("candidates");
    expect(
      (lookup.candidates || []).some((candidate) =>
        candidate.provenance?.sourceRefs?.some(
          (sourceRef) =>
            sourceRef.sourceId?.startsWith("mdict-")
        )
      )
    ).toBe(true);
    expect(harness.server.calls).toHaveLength(0);

    await installed
      .getByRole("button", { name: "删除" })
      .click();
    await expect(installed).toHaveCount(0);

    const afterDelete = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "issueonesevenmdict",
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(
      (afterDelete.candidates || []).some((candidate) =>
        candidate.provenance?.sourceRefs?.some(
          (sourceRef) =>
            sourceRef.sourceId?.startsWith("mdict-")
        )
      )
    ).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}
