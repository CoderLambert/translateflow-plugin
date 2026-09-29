import { test, expect } from "./support/extension-fixture.mjs";

test.use({ lexiconPacks: "incompatible" });

test("incompatible bundled lexicon stays diagnostic, actionable and Provider-free", async ({ harness }) => {
  const page = await harness.open("/selection");
  await harness.inject(page);

  await selectElementText(page, "#ambiguous");
  await page.locator(".tf-selection-chip").click();

  const status = page.locator(".tf-selection-status");
  await expect(status).toHaveAttribute("data-kind", "error");
  await expect(status).toContainText("与当前扩展版本不兼容");
  await expect(status).toContainText("设置 > 本地词典");
  await expect(page.locator(".tf-selection-empty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用 AI 结合上下文详解" })).toBeHidden();
  expect(harness.server.calls).toHaveLength(0);
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
