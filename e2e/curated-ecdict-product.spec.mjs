import {
  test,
  expect
} from "./support/extension-fixture.mjs";

test.describe("curated ECDICT product flow", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("visible Settings install activates the locked upstream pack for Selection without Provider calls", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );

    const row = options
      .locator("#curatedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("上游 / 社区");
    await expect(row).toContainText("ECDICT");
    await row
      .getByRole("button", { name: "下载并安装" })
      .click();

    await expect(row).toContainText("安装完成", {
      timeout: 150_000
    });

    const installed = options
      .locator("#installedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("上游 / 社区");

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "curated-ecdict-word";
      node.textContent = "hello";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#curated-ecdict-word");
    await page.locator(".tf-selection-chip").click();
    await expect(
      page.locator(".tf-selection-result")
    ).toBeVisible();

    const lookup = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "hello",
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(lookup.ok).toBe(true);
    expect(lookup.status).toBe("candidates");
    expect(
      lookup.candidates.some((candidate) =>
        candidate.senses?.some((sense) =>
          sense.sourceRefs?.some(
            (sourceRef) => sourceRef.sourceId === "ecdict"
          )
        )
      )
    ).toBe(true);
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
