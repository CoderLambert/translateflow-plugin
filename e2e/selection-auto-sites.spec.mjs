import { test, expect } from "./support/extension-fixture.mjs";

test("Selection is available on a newly opened web page without opening the Popup", async ({ harness }) => {
  const manifest = await harness.driver.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.host_permissions).toEqual(expect.arrayContaining(["http://*/*", "https://*/*"]));
  expect(manifest.content_scripts).toEqual([expect.objectContaining({
    matches: ["http://*/*", "https://*/*"],
    run_at: "document_idle"
  })]);

  const page = await harness.open("/selection");
  await expect.poll(async () => {
    try { return (await harness.sendContent(page, "ABT_STATUS"))?.ok === true; }
    catch { return false; }
  }).toBe(true);
  await page.evaluate(() => {
    const element = document.querySelector("#technical-competition");
    if (!element) throw new Error("Selection fixture is missing the expected text");
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });

  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  expect(await harness.driver.evaluate(() => chrome.scripting.getRegisteredContentScripts())).toEqual([]);
});
