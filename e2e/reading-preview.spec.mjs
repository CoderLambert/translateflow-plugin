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

test("saved lookup details reopen from the highlighted word without exposing answers in the host page", async ({ harness }, info) => {
  test.setTimeout(60000);
  await harness.reset();
  await harness.setStorage({ uiLocale: "en", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  const recording = await message(center, M.GET_RECORDING_STATE);
  if (!recording.data.enabled) {
    expect((await message(center, M.SET_RECORDING, { enabled: true,
      expectedConsentGeneration: recording.data.consentGeneration })).ok).toBe(true);
  }

  const original = await harness.open("/selection"); await harness.inject(original);
  await select(original, "#technical-competition", "session");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await original.getByRole("tab", { name: "AI understand: explain what this means here", exact: true }).click();
  await expect(original.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  const listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  expect(listed.data.items).toHaveLength(1);
  const recordId = listed.data.items[0].recordId;

  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(center.getByRole("button", { name: /site markers/i })).toHaveCount(0);
  const followUpQuestion = "Why is this terminal session reusable?";
  await center.getByRole("button", { name: "Ask a follow-up", exact: true }).click();
  await center.getByPlaceholder("Ask about this saved answer").fill(followUpQuestion);
  await center.getByRole("button", { name: "Send", exact: true }).click();
  await expect(center.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(center.getByText("streamed answer", { exact: true })).toHaveCount(2);

  await select(original, "#technical-competition-second", "session");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await select(original, "#ambiguous", "persistent");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  const providerCalls = harness.server.calls.length;
  await original.close();

  const revisit = await harness.open("/selection"); await harness.inject(revisit);
  await revisit.setViewportSize({ width: 1280, height: 800 });
  await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(3);
  await expect(revisit.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);
  await revisit.evaluate(() => { document.querySelector("#technical-competition").textContent = "The original saved location moved away."; });
  await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(2);
  await revisit.locator("#technical-competition-second").hover();
  const hoverPreview = revisit.frameLocator("iframe.tf-reading-hover-frame");
  await expect(hoverPreview.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(hoverPreview.getByRole("heading", { name: "Saved context", exact: true })).toBeVisible();
  await expect(hoverPreview.getByText("A second session keeps another saved lookup on this page.", { exact: true })).toBeVisible();
  await expect(hoverPreview.getByRole("heading", { name: "AI explanation", exact: true })).toBeVisible();
  await expect(hoverPreview.getByRole("heading", { name: "Follow-up", exact: true })).toBeVisible();
  await expect(hoverPreview.getByText("streamed answer", { exact: true })).toHaveCount(2);
  await expect(hoverPreview.getByText("streamed answer", { exact: true }).first()).toBeVisible();
  await expect(hoverPreview.getByText(followUpQuestion, { exact: true })).toBeVisible();
  await expect(revisit.locator(".tf-reading-hover-preview")).toBeVisible();
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain(followUpQuestion);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain("streamed answer");
  expect(harness.server.calls).toHaveLength(providerCalls);
  await hoverPreview.getByRole("button", { name: "Close", exact: false }).click();
  await expect(revisit.locator(".tf-reading-hover-preview")).toHaveCount(0);
  await revisit.setViewportSize({ width: 360, height: 420 });
  await revisit.locator("#technical-competition-second").hover();
  await expect(hoverPreview.getByText(followUpQuestion, { exact: true })).toBeVisible();
  await expect.poll(async () => revisit.locator(".tf-reading-hover-preview").evaluate(node => {
    const box = node.getBoundingClientRect(), viewport = visualViewport;
    const left = (viewport?.offsetLeft || 0) + 7, top = (viewport?.offsetTop || 0) + 7;
    const right = (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth) - 7;
    const bottom = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - 7;
    const value = { inside: box.left >= left && box.right <= right && box.top >= top && box.bottom <= bottom,
      innerWidth, innerHeight,
      viewport: viewport ? { width: viewport.width, height: viewport.height, offsetLeft: viewport.offsetLeft,
        offsetTop: viewport.offsetTop, scale: viewport.scale } : null,
      bounds: { left, top, right, bottom },
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      style: { left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height,
        maxWidth: node.style.maxWidth, maxHeight: node.style.maxHeight } };
    return value.inside ? "inside" : JSON.stringify(value);
  })).toBe("inside");
  await expect(hoverPreview.getByRole("button", { name: "Close", exact: false })).toBeVisible();
  await revisit.screenshot({ path: info.outputPath("reading-highlight-hover-details.png"), fullPage: false });
  const hoverBox = await revisit.locator(".tf-reading-hover-preview").boundingBox();
  expect(hoverBox).not.toBeNull();
  await revisit.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
  await hoverPreview.getByRole("button", { name: "Close", exact: false }).click();
  await expect(revisit.locator(".tf-reading-hover-preview")).toHaveCount(0);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain(followUpQuestion);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain("streamed answer");
  expect(harness.server.calls).toHaveLength(providerCalls);

  await harness.restartBrowser();
  const restartedCenter = await harness.context.newPage();
  await restartedCenter.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(restartedCenter.getByRole("button", { name: /site markers/i })).toHaveCount(0);
  const afterRestart = await harness.open("/selection"); await harness.inject(afterRestart);
  await expect(afterRestart.locator(".tf-reading-page-highlight")).toHaveCount(3);
  await expect(afterRestart.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);
  await afterRestart.locator("#technical-competition-second").hover();
  await expect(afterRestart.frameLocator("iframe.tf-reading-hover-frame").getByText(followUpQuestion, { exact: true })).toBeVisible();
  expect(harness.server.calls).toHaveLength(providerCalls);

  await restartedCenter.getByRole("button", { name: "Delete record", exact: true }).click();
  await restartedCenter.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-page-highlight")).toHaveCount(2);
  await expect(afterRestart.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);
  expect(harness.server.calls).toHaveLength(providerCalls);
});

test("multiple highlights on the same line show independent previews on hover and preserve page interactivity", async ({ harness }) => {
  test.setTimeout(60000);
  await harness.resetProfile();
  await harness.reset();
  await harness.setStorage({ uiLocale: "en", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  const enableRecording = center.getByRole("button", { name: "Enable recording", exact: true });
  if (await enableRecording.isVisible()) await enableRecording.click();

  const original = await harness.open("/selection"); await harness.inject(original);

  // Select foundation
  await select(original, "#foundation", "foundation");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await original.locator("button.tf-selection-icon-button").first().click(); // Close popup
  await expect(original.locator(".tf-selection-chip")).toHaveCount(0);

  // Select production-grade
  await select(original, "#production-grade", "production-grade");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await original.locator("button.tf-selection-icon-button").first().click(); // Close popup
  await expect(original.locator(".tf-selection-chip")).toHaveCount(0);

  const providerCalls = harness.server.calls.length;
  await original.close();

  const revisit = await harness.open("/selection"); await harness.inject(revisit);
  await revisit.setViewportSize({ width: 1280, height: 800 });
  await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(2);
  await expect(revisit.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);

  // Verify site markers are on by default and switch doesn't exist
  await center.bringToFront();
  await center.reload();
  await expect(center.getByRole("button", { name: /site markers/i })).toHaveCount(0);

  await revisit.bringToFront();

  // Hover foundation highlight
  await revisit.locator("#foundation").hover();

  const hoverPreview = revisit.frameLocator("iframe.tf-reading-hover-frame");
  await expect(hoverPreview.getByRole("heading", { name: "foundation", exact: true })).toBeVisible();
  await expect(hoverPreview.getByRole("heading", { name: "Saved context", exact: true })).toBeVisible();
  await expect(hoverPreview.getByText("No saved AI activity", { exact: true })).toBeVisible();
  await expect(hoverPreview.locator(".reading-preview-info")).toHaveAttribute("title", /Completed AI explanations/);

  // Ensure we can move to the preview card without it closing
  const shellBox = await revisit.locator(".tf-reading-hover-preview").boundingBox();
  expect(shellBox.height).toBeLessThan(560);
  await revisit.mouse.move(shellBox.x + 5, shellBox.y + 5);
  await expect(hoverPreview.getByRole("heading", { name: "foundation", exact: true })).toBeVisible();
  const stableFrame = revisit.locator("iframe.tf-reading-hover-frame");
  const stablePreviewUrl = await stableFrame.getAttribute("src");
  const stableSince = Date.now();
  await expect.poll(async () => {
    const urls = await revisit.locator("iframe.tf-reading-hover-frame").evaluateAll(nodes => nodes.map(node => node.getAttribute("src")));
    return Date.now() - stableSince >= 600 && urls.length === 1 && urls[0] === stablePreviewUrl ? "stable" : JSON.stringify(urls);
  }, { timeout: 1500 }).toBe("stable");

  // Move mouse away to close the first preview card
  await revisit.mouse.move(0, 0);
  await expect(revisit.locator(".tf-reading-hover-preview")).toHaveCount(0);

  // Hover production-grade highlight
  await revisit.locator("#production-grade").hover();

  await expect(hoverPreview.getByRole("heading", { name: "production-grade", exact: true })).toBeVisible();

  // Verify provider calls hasn't increased (no network request on hover)
  expect(harness.server.calls.length).toBe(providerCalls);

  // Click a normal link on the page (verifies pointer-events doesn't block clicks)
  let linkClicked = false;
  await revisit.exposeFunction("setLinkClicked", () => { linkClicked = true; });
  await revisit.evaluate(() => {
    document.getElementById("test-link").addEventListener("click", (e) => { e.preventDefault(); window.setLinkClicked(); });
  });
  await revisit.locator("#test-link").click();
  expect(linkClicked).toBe(true);

  // Select some normal text (verifies pointer-events doesn't block selection)
  await revisit.evaluate(() => {
    const node = document.querySelector("#dual-source").firstChild;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 3);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  const selectionText = await revisit.evaluate(() => getSelection().toString());
  expect(selectionText).toBe("The");

  // Delete foundation record
  const records = await message(center, M.LIST_RECORDS, { pageKey: null, query: "", cursor: null, limit: 30 });
  const foundationRecord = records.data.items.find(i => i.itemText === "foundation");

  await center.bringToFront();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${foundationRecord.recordId}`);
  await center.getByRole("button", { name: "Delete record", exact: true }).click();
  await center.getByRole("button", { name: "Confirm", exact: true }).click();

  // Verify only production-grade remains
  await revisit.bringToFront();
  await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(0);
  await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(1);

  // Restart browser and verify consistency
  await harness.restartBrowser();
  const afterRestart = await harness.open("/selection"); await harness.inject(afterRestart);
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(0);
  await expect(afterRestart.locator(".tf-reading-page-highlight")).toHaveCount(1);
});

test("a new lookup on a page with live highlights keeps the refreshed word preview stable", async ({ harness }) => {
  test.setTimeout(60000);
  await harness.resetProfile();
  await harness.reset();
  await harness.setStorage({ uiLocale: "en" });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  const enableRecording = center.getByRole("button", { name: "Enable recording", exact: true });
  if (await enableRecording.isVisible()) await enableRecording.click();

  const page = await harness.open("/selection"); await harness.inject(page);
  await select(page, "#foundation", "foundation");
  await expect(page.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await page.locator("button.tf-selection-icon-button").first().click();
  await expect(page.locator(".tf-reading-page-highlight")).toHaveCount(1);
  await expect(page.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);

  await page.locator("#foundation").hover();
  const firstPreview = page.locator("iframe.tf-reading-hover-frame");
  await expect(page.frameLocator("iframe.tf-reading-hover-frame").getByRole("heading", { name: "foundation", exact: true })).toBeVisible();
  const firstPreviewUrl = await firstPreview.getAttribute("src");
  const firstStableSince = Date.now();
  await expect.poll(async () => {
    const urls = await page.locator("iframe.tf-reading-hover-frame").evaluateAll(nodes => nodes.map(node => node.getAttribute("src")));
    return Date.now() - firstStableSince >= 600 && urls.length === 1 && urls[0] === firstPreviewUrl ? "stable" : JSON.stringify(urls);
  }, { timeout: 1500 }).toBe("stable");
  await page.frameLocator("iframe.tf-reading-hover-frame").getByRole("button", { name: "Close", exact: false }).click();

  await select(page, "#production-grade", "production-grade");
  await expect(page.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await page.locator("button.tf-selection-icon-button").first().click();
  await expect(page.locator(".tf-reading-page-highlight")).toHaveCount(2);

  const records = await message(center, M.LIST_RECORDS, { pageKey: null, query: "production-grade", cursor: null, limit: 30 });
  const refreshedRecord = records.data.items.find(item => item.itemText === "production-grade");
  expect(refreshedRecord).toBeTruthy();
  await page.locator("#production-grade").hover();
  await expect(page.frameLocator("iframe.tf-reading-hover-frame").getByRole("heading", { name: "production-grade", exact: true })).toBeVisible();
  const refreshedPreview = page.locator("iframe.tf-reading-hover-frame"), refreshedPreviewUrl = await refreshedPreview.getAttribute("src");
  const refreshedStableSince = Date.now();
  await expect.poll(async () => {
    const urls = await page.locator("iframe.tf-reading-hover-frame").evaluateAll(nodes => nodes.map(node => node.getAttribute("src")));
    return Date.now() - refreshedStableSince >= 600 && urls.length === 1 && urls[0] === refreshedPreviewUrl ? "stable" : JSON.stringify(urls);
  }, { timeout: 1500 }).toBe("stable");
});
