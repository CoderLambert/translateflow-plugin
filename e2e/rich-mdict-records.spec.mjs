import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

const definition = (sentinel, color) => `<div id="shared-fragment" style="color:${color}">${sentinel}</div><a href="#shared-fragment">Jump ${sentinel}</a><input type="radio" name="shared-group" checked><script>window.__multiRecordExecuted=true</script><img src="https://attacker.invalid/records.png">`;

test("multiple terminal records render all sentinels in isolated viewers without shared fragments, controls or styles", async ({ harness }) => {
  test.setTimeout(120_000);
  await harness.reset();
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  const mdx = makeRichMdx([
    ["recordsfixture", definition("FIRST RECORD SENTINEL", "#123456")],
    ["recordsfixture", definition("SECOND RECORD SENTINEL", "#654321")],
    ["recordsfixture", "@@@LINK=recordstarget"],
    ["recordstarget", "@@@LINK=recordsfixture"],
    ["recordstarget", definition("THIRD RECORD SENTINEL", "#345678")]
  ], { title: "Synthetic Multiple Records", keyBlockEntryCounts: [2, 1, 2] });
  await options.locator("#localDictionaryFiles").setInputFiles({ name: "multiple-records.mdx", mimeType: "application/octet-stream", buffer: mdx });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Synthetic Multiple Records");
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
  const page = await harness.open("/selection");
  const externalRequests = [], pageErrors = [];
  page.on("request", (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) externalRequests.push(request.url()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.evaluate(() => {
    window.__multiRecordExecuted = false;
    const word = document.createElement("p"); word.id = "multi-record-word"; word.textContent = "recordsfixture"; document.body.appendChild(word);
  });
  await harness.inject(page);
  await page.locator("#multi-record-word").evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window }));
  });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await page.locator(".tf-selection-chip").click();
  const card = page.locator(".tf-selection-rich-record").filter({ hasText: "Synthetic Multiple Records" });
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
  const hosts = card.locator(".tf-selection-rich-text");
  await expect(hosts).toHaveCount(3);
  const viewers = hosts.locator(".tf-rich-viewer");
  for (const [index, marker] of ["FIRST RECORD SENTINEL", "SECOND RECORD SENTINEL", "THIRD RECORD SENTINEL"].entries()) {
    await expect(viewers.nth(index)).toContainText(marker);
  }
  const colors = await viewers.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node.querySelector("[data-rich-target-id='shared-fragment']")).color));
  expect(colors).toEqual(["rgb(18, 52, 86)", "rgb(101, 67, 33)", "rgb(52, 86, 120)"]);
  await expect(viewers.locator("input, script, img[src^='https:']")).toHaveCount(0);
  await viewers.nth(1).locator("button[data-rich-fragment-target='shared-fragment']").click();
  expect(await viewers.evaluateAll((nodes) => nodes.map((node) => {
    const target = node.querySelector("[data-rich-target-id='shared-fragment']");
    return target === node.getRootNode().activeElement;
  }))).toEqual([false, true, false]);
  await viewers.nth(0).locator("button[data-rich-fragment-target='shared-fragment']").click();
  expect(await viewers.evaluateAll((nodes) => nodes.map((node) => node.querySelector("[data-rich-target-id='shared-fragment']") === node.getRootNode().activeElement))).toEqual([true, false, false]);
  expect(await page.evaluate(() => window.__multiRecordExecuted)).toBe(false);
  expect(harness.server.calls).toHaveLength(0);
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
