import { test, expect } from "./support/extension-fixture.mjs";

test.use({ allSitesHostAccess: true });

async function selectLexical(page) {
  await page.evaluate(() => {
    const node = document.querySelector("#lexical").firstChild;
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

test("one all-sites permission makes Selection available on newly opened pages", async ({ harness }) => {
  await harness.reset();
  const enabled = await harness.driver.evaluate(() => chrome.runtime.sendMessage({ type: "SELECTION_ALL_SITES_ENABLE" }));
  expect(enabled).toMatchObject({ ok: true, enabled: true });

  const second = await harness.open("/selection");
  await selectLexical(second);
  await expect(second.locator(".tf-selection-chip")).toBeVisible();

  const secondTabId = await harness.tabId(second);
  await harness.driver.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), secondTabId);
  await harness.driver.reload();
  await expect(harness.driver.locator("#selectionSite")).toHaveAttribute("aria-checked", "true");
  await harness.driver.getByRole("switch", { name: "关闭全站划词查询" }).click();
  await expect(harness.driver.locator("#selectionSite")).toHaveAttribute("aria-checked", "false");

  const third = await harness.open("/selection");
  await selectLexical(third);
  await expect(third.locator(".tf-selection-chip")).toHaveCount(0);
});
