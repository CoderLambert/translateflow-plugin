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
  await expect.poll(() => harness.driver.evaluate(async () =>
    (await chrome.storage.local.get("selectionAllSites")).selectionAllSites)).toBe(true);
  await expect.poll(() => harness.driver.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).filter(item => item.id.includes("selection_all_sites")).length)).toBe(1);

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
