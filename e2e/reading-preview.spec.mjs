import { test, expect } from "./support/extension-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

const message = (page, method, fields = {}) => page.evaluate(request => chrome.runtime.sendMessage(request),
  { protocolVersion: 2, method, ...fields });

async function select(page, selector, selectedText) {
  await page.evaluate(({ selector, selectedText }) => {
    const node = document.querySelector(selector).firstChild, offset = node.nodeValue.indexOf(selectedText);
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + selectedText.length);
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange"));
  }, { selector, selectedText });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await page.locator(".tf-selection-chip").click();
}

async function pageSurface(page) {
  return page.evaluate(() => {
    const values = [];
    function visit(root) {
      for (const node of root.childNodes || []) {
        if (node.nodeType === Node.TEXT_NODE) values.push(node.nodeValue || "");
        if (node.nodeType === Node.ELEMENT_NODE) {
          for (const attribute of node.attributes) values.push(`${attribute.name}=${attribute.value}`);
          if (node.shadowRoot) visit(node.shadowRoot);
        }
        visit(node);
      }
    }
    visit(document); return values;
  });
}

test("saved assistant history reopens through page history without exposing answers in the host page", async ({ harness }, info) => {
  test.setTimeout(60000);
  await harness.reset();
  await harness.setStorage({ uiLocale: "en", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await center.getByRole("button", { name: "Enable recording", exact: true }).click();

  const original = await harness.open("/selection"); await harness.inject(original);
  await select(original, "#technical-competition", "session");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await original.getByRole("button", { name: "Explain with AI using the surrounding context", exact: true }).click();
  await expect(original.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  const listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  expect(listed.data.items).toHaveLength(1);
  const recordId = listed.data.items[0].recordId;

  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await center.getByRole("button", { name: "Enable site markers", exact: true }).click();
  const followUpQuestion = "Why is this terminal session reusable?";
  await center.getByRole("button", { name: "Ask a follow-up", exact: true }).click();
  await center.getByPlaceholder("Ask about this saved answer").fill(followUpQuestion);
  await center.getByRole("button", { name: "Send", exact: true }).click();
  await expect(center.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(center.getByText("streamed answer", { exact: true })).toHaveCount(2);

  await select(original, "#ambiguous", "persistent");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  const providerCalls = harness.server.calls.length;
  await original.close();

  const revisit = await harness.open("/selection"); await harness.inject(revisit);
  await revisit.setViewportSize({ width: 1280, height: 800 });
  await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(2);
  const sessionMarker = revisit.locator(`.tf-reading-page-marker[data-record-id="${recordId}"]`);
  await sessionMarker.click();
  await expect(revisit.locator(".tf-reading-page-panel")).toBeVisible();
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(0);
  const sessionRow = revisit.locator(`.tf-reading-page-panel article[data-record-id="${recordId}"]`);
  await expect(sessionRow).toContainText("session");
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain(followUpQuestion);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain("streamed answer");

  const detailPromise = harness.context.waitForEvent("page");
  await sessionRow.getByRole("button", { name: "View record", exact: true }).click();
  const detail = await detailPromise;
  await expect(detail.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(detail.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(detail.getByText("streamed answer", { exact: true })).toHaveCount(2);
  await detail.close();
  expect(harness.server.calls).toHaveLength(providerCalls);
  await revisit.screenshot({ path: info.outputPath("reading-page-history-ai.png"), fullPage: false });

  await harness.restartBrowser();
  const restartedCenter = await harness.context.newPage();
  await restartedCenter.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(restartedCenter.getByRole("button", { name: "Disable site markers", exact: true })).toBeVisible();
  const afterRestart = await harness.open("/selection"); await harness.inject(afterRestart);
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(2);
  await afterRestart.locator(`.tf-reading-page-marker[data-record-id="${recordId}"]`).click();
  await expect(afterRestart.locator(".tf-reading-page-panel")).toBeVisible();
  await expect(afterRestart.locator(".tf-reading-preview-frame")).toHaveCount(0);
  expect(harness.server.calls).toHaveLength(providerCalls);

  await restartedCenter.getByRole("button", { name: "Disable site markers", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(0);
  await expect(afterRestart.locator(".tf-reading-page-toggle")).toHaveCount(0);
  await restartedCenter.getByRole("button", { name: "Enable site markers", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(2);

  await restartedCenter.getByRole("button", { name: "Delete record", exact: true }).click();
  await restartedCenter.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(afterRestart.locator(`.tf-reading-page-marker[data-record-id="${recordId}"]`)).toHaveCount(0);
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(1);
  await expect(afterRestart.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
  expect(harness.server.calls).toHaveLength(providerCalls);
});
