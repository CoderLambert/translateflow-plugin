import { test, expect } from "./support/extension-fixture.mjs";


test("corrupt user dictionaries show a diagnostic and translate only after an explicit fallback", async ({ harness }) => {
  await harness.reset();
  await harness.installUserDictionaries({ fault: "corrupt" });
  const page = await harness.open("/selection");
  await harness.inject(page);
  await selectElementText(page, "#ambiguous");
  await page.locator(".tf-selection-chip").click();
  await expect(page.locator(".tf-selection-status")).toContainText("本地词典校验失败");
  expect(harness.server.calls).toHaveLength(0);
  await page.getByText("切换方式", { exact: true }).click();
  await page.getByRole("button", { name: "用 AI 查词", exact: true }).click();
  await expect(page.locator(".tf-selection-primary")).not.toBeEmpty();
  await expect(page.getByRole("tab", { name: "译文", exact: true })).toBeVisible();
  expect(harness.server.calls).toHaveLength(1);
  const diagnostic = await harness.runtime({ type: "LEXICAL_LOOKUP", text: "persistent", pageUrl: page.url() });
  expect(diagnostic.ok).toBe(true);
  expect(diagnostic.status).toBe("error");
  expect(diagnostic.error.code).toBe("LEXICON_CORRUPT");
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
