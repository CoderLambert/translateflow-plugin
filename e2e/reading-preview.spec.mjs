import { test, expect } from "./support/extension-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

const message = (page, method, fields = {}) => page.evaluate(request => chrome.runtime.sendMessage(request),
  { protocolVersion: 2, method, ...fields });
async function select(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const node = document.querySelector(selector).firstChild, offset = node.nodeValue.indexOf(text);
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange"));
  }, { selector, text });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await page.locator(".tf-selection-chip").click();
}
async function bindGate(driver, url, action, method = M.PREVIEW_BIND) {
  return driver.evaluate(async ({ url, action, method, closeMethod, createMethod }) => {
    const tabId = (await chrome.tabs.query({})).find(tab => tab.url === url)?.id;
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [action, method, closeMethod, createMethod],
      func: (name, targetMethod, closeMethod, createMethod) => {
        const app = globalThis.__TRANSLATE_FLOW_CONTENT__, runtime = app?.modules.runtime;
        if (!runtime) return null;
        if (name === "install") {
          const original = runtime.sendRuntimeMessage; let release;
          const gate = new Promise(resolve => { release = resolve; });
          globalThis.__tfPreviewBindGate = { original, gate, release, started: false, completed: 0, created: [], closed: [] };
          runtime.sendRuntimeMessage = async request => {
            const result = await original(request);
            if (request.method === closeMethod) globalThis.__tfPreviewBindGate.closed.push(request.previewId);
            if (request.method === createMethod) globalThis.__tfPreviewBindGate.created.push(result?.data?.previewId || result?.previewId || null);
            if (!globalThis.__tfPreviewBindGate.started && request.method === targetMethod) {
              globalThis.__tfPreviewBindGate.started = true; await gate;
            }
            if (request.method === targetMethod) globalThis.__tfPreviewBindGate.completed++;
            return result;
          };
          return true;
        }
        if (name === "started") return globalThis.__tfPreviewBindGate?.started === true;
        if (name === "completed") return globalThis.__tfPreviewBindGate?.completed || 0;
        if (name === "created") return [...(globalThis.__tfPreviewBindGate?.created || [])];
        if (name === "closed") return [...(globalThis.__tfPreviewBindGate?.closed || [])];
        if (name === "release") { globalThis.__tfPreviewBindGate.release(); return true; }
        if (name === "restore") { runtime.sendRuntimeMessage = globalThis.__tfPreviewBindGate.original; return true; }
        return false;
      } });
    return injection.result;
  }, { url, action, method, closeMethod: M.PREVIEW_CLOSE, createMethod: M.PREVIEW_CREATE });
}
async function addPreviewCopySlot(page, id) {
  await page.evaluate(id => {
    const frame = document.createElement("iframe"); frame.id = id; frame.width = "320"; frame.height = "220";
    frame.style.cssText = "position:fixed;left:-400px;top:0"; frame.src = "about:blank"; document.body.append(frame);
  }, id);
}
async function copyPreviewIntoSlot(page, id, src) {
  await page.evaluate(({ id, src }) => document.getElementById(id).contentWindow.location.replace(src), { id, src });
}
async function moveLivePreviewToHistoryLayer(page) {
  return page.evaluate(() => {
    const shadow = document.querySelector("#translateflow-ui-root")?.shadowRoot;
    const frame = shadow?.querySelector("iframe.tf-reading-preview-frame"), destination = shadow?.querySelector('.tf-ui-layer[data-layer="reading-page-history"]');
    if (!frame || !destination || typeof destination.moveBefore !== "function") return { supported: false, moved: false };
    destination.moveBefore(frame, null);
    return { supported: true, moved: frame.parentElement === destination, connected: frame.isConnected };
  });
}
async function pageSurface(page) {
  return page.evaluate(() => {
    const values = [...(globalThis.__tfObservedMessages || [])];
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

 test("saved assistant history opens in an isolated revisit preview and stays bound to its live frame", async ({ harness }, info) => {
  test.setTimeout(60000);
  await harness.reset();
  await harness.setStorage({ uiLocale: "en", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await center.getByRole("button", { name: "Enable recording", exact: true }).click();
  await expect(center.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();

  const original = await harness.open("/selection"); await harness.inject(original);
  await select(original, "#technical-competition", "session");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await original.getByRole("button", { name: "Explain with AI using the surrounding context", exact: true }).click();
  await expect(original.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(original.locator(".tf-selection-ai-detail")).toContainText("streamed answer");
  const listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  expect(listed.data.items).toHaveLength(1);
  const recordId = listed.data.items[0].recordId;
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(center.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await center.getByRole("button", { name: "Enable site markers", exact: true }).click();
  await expect(center.getByRole("button", { name: "Disable site markers", exact: true })).toHaveAttribute("aria-pressed", "true");
  const followUpQuestion = "Why is this terminal session reusable?";
  await center.getByRole("button", { name: "Ask a follow-up", exact: true }).click();
  await center.getByPlaceholder("Ask about this saved answer").fill(followUpQuestion);
  await center.getByRole("button", { name: "Send", exact: true }).click();
  await expect(center.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(center.getByText("streamed answer", { exact: true })).toHaveCount(2);
  const detail = await message(center, M.GET_RECORD, { recordId });
  const turns = detail.data.artifacts.filter(value => value.kind === "assistant");
  expect(turns).toHaveLength(2);
  expect(turns.every(value => value.payload.completionStatus === "completed" && value.payload.assistantAnswer === "streamed answer")).toBe(true);
  const rootQuestion = turns[0].payload.userQuestion;
  expect(rootQuestion).toBeTruthy();
  expect(harness.server.calls).toHaveLength(2);

  // Add a second record on this page so a slow older location check cannot replace
  // a newer preview for a different record.
  await select(original, "#ambiguous", "persistent");
  await expect(original.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  const secondRecord = await message(center, M.LIST_RECORDS, { pageKey: null, query: "persistent", cursor: null, limit: 30 });
  expect(secondRecord.data.items).toHaveLength(1);
  const secondRecordId = secondRecord.data.items[0].recordId;
  expect(secondRecordId).not.toBe(recordId);
  const providerCalls = harness.server.calls.length;

  await original.close();
  const revisit = await harness.open("/selection");
  await addPreviewCopySlot(revisit, "forged-preview");
  await revisit.evaluate(() => {
    globalThis.__tfObservedMessages = [];
    addEventListener("message", event => { try { __tfObservedMessages.push(JSON.stringify(event.data)); } catch {} });
  });
  // The active host document got an evaluate listener above; this init script observes
  // messages addressed into the extension iframe created later.
  await revisit.addInitScript(() => {
    globalThis.__tfObservedMessages = [];
    addEventListener("message", event => { try { __tfObservedMessages.push(JSON.stringify(event.data)); } catch {} });
  });
  await harness.inject(revisit);
  await revisit.setViewportSize({ width: 1280, height: 800 });
  await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(2);

  const sessionMarker = revisit.locator(`.tf-reading-page-marker[data-record-id="${recordId}"]`);
  const secondMarker = revisit.locator(`.tf-reading-page-marker[data-record-id="${secondRecordId}"]`);

  // Delay the earlier click during page-summary confirmation. The later click's
  // validation finishes first and must remain the sole preview after the old reply.
  await bindGate(harness.driver, revisit.url(), "install", M.GET_PAGE_SUMMARY);
  await sessionMarker.click();
  await expect.poll(() => bindGate(harness.driver, revisit.url(), "started", M.GET_PAGE_SUMMARY)).toBe(true);
  await secondMarker.click();
  const secondPreview = revisit.frameLocator("iframe.tf-reading-preview-frame");
  await expect(secondPreview.getByRole("heading", { name: "persistent", exact: true })).toBeVisible();
  const validationRaceIds = await bindGate(harness.driver, revisit.url(), "created", M.GET_PAGE_SUMMARY);
  expect(validationRaceIds).toHaveLength(1);
  const secondPreviewUrl = await revisit.locator(".tf-reading-preview-frame").getAttribute("src");
  expect(new URL(secondPreviewUrl).searchParams.get("previewId")).toBe(validationRaceIds[0]);
  await bindGate(harness.driver, revisit.url(), "release", M.GET_PAGE_SUMMARY);
  await expect.poll(() => bindGate(harness.driver, revisit.url(), "completed", M.GET_PAGE_SUMMARY)).toBe(2);
  await expect(secondPreview.getByRole("heading", { name: "persistent", exact: true })).toBeVisible();
  expect(await bindGate(harness.driver, revisit.url(), "created", M.GET_PAGE_SUMMARY)).toHaveLength(1);
  await bindGate(harness.driver, revisit.url(), "restore", M.GET_PAGE_SUMMARY);
  await revisit.locator(".tf-reading-preview-shell .tf-ui-icon-button").click();
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(0);

  // Hold the first create reply so a second activation wins while the first is pending.
  await bindGate(harness.driver, revisit.url(), "install", M.PREVIEW_CREATE);
  await sessionMarker.click();
  await expect.poll(() => bindGate(harness.driver, revisit.url(), "started", M.PREVIEW_CREATE)).toBe(true);
  await sessionMarker.click();
  const truePreview = revisit.frameLocator("iframe.tf-reading-preview-frame");
  await expect(truePreview.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(truePreview.getByRole("heading", { name: rootQuestion, exact: true })).toBeVisible();
  await expect(truePreview.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(truePreview.getByText("streamed answer", { exact: true })).toHaveCount(2);

  const createdIds = await bindGate(harness.driver, revisit.url(), "created", M.PREVIEW_CREATE);
  expect(createdIds).toHaveLength(2);
  const livePreviewUrl = await revisit.locator(".tf-reading-preview-frame").getAttribute("src");
  const previewId = new URL(livePreviewUrl).searchParams.get("previewId");
  expect(previewId).toBe(createdIds[1]);
  await bindGate(harness.driver, revisit.url(), "release", M.PREVIEW_CREATE);
  await expect.poll(async () => (await bindGate(harness.driver, revisit.url(), "closed", M.PREVIEW_CREATE)).includes(createdIds[0])).toBe(true);
  await bindGate(harness.driver, revisit.url(), "restore", M.PREVIEW_CREATE);
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(1);
  await revisit.screenshot({ path: info.outputPath("reading-preview-live.png"), fullPage: false, animations: "allow", caret: "initial" });
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(1);
  await expect(truePreview.getByText("streamed answer", { exact: true })).toHaveCount(2);

  const hostMessages = await revisit.evaluate(() => globalThis.__tfObservedMessages.map(value => JSON.parse(value)));
  const frameMessages = await truePreview.locator("body").evaluate(() => globalThis.__tfObservedMessages || []);
  expect(hostMessages.some(value => value.type === "translateflow-reading-preview-claim")).toBe(true);
  expect(frameMessages.some(value => JSON.parse(value).type === "translateflow-reading-preview-bound")).toBe(true);
  const handshakeMessages = JSON.stringify([...hostMessages, ...frameMessages]);
  expect(handshakeMessages).not.toContain(rootQuestion);
  expect(handshakeMessages).not.toContain(followUpQuestion);
  expect(handshakeMessages).not.toContain("streamed answer");

  expect(JSON.stringify(await pageSurface(revisit))).not.toContain(rootQuestion);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain(followUpQuestion);
  expect(JSON.stringify(await pageSurface(revisit))).not.toContain("streamed answer");
  expect(harness.server.calls).toHaveLength(providerCalls);

  // The copied frame was inserted before content injection. Navigating that existing
  // frame does not mutate the source document while the legitimate frame is bound.
  await copyPreviewIntoSlot(revisit, "forged-preview", livePreviewUrl);
  const forged = revisit.frameLocator("#forged-preview");
  await expect(forged.getByText("Saved history could not be opened. Close this preview and try again.", { exact: true })).toBeVisible();
  const forgedRead = await forged.locator("body").evaluate(async (_body, id) => chrome.runtime.sendMessage({
    protocolVersion: 2, method: "reading.preview-read", previewId: id
  }), previewId);
  expect(forgedRead.ok).toBe(false);
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(1);
  await expect(truePreview.getByText("streamed answer", { exact: true })).toHaveCount(2);

  const crossPage = await harness.open("/selection"); await addPreviewCopySlot(crossPage, "copied-preview"); await harness.inject(crossPage);
  await copyPreviewIntoSlot(crossPage, "copied-preview", livePreviewUrl);
  const copied = crossPage.frameLocator("#copied-preview");
  await expect(copied.getByText("Saved history could not be opened. Close this preview and try again.", { exact: true })).toBeVisible();
  const copiedRead = await copied.locator("body").evaluate(async (_body, id) => chrome.runtime.sendMessage({
    protocolVersion: 2, method: "reading.preview-read", previewId: id
  }), previewId);
  expect(copiedRead.ok).toBe(false);
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(1);
  await expect(truePreview.getByText("streamed answer", { exact: true })).toHaveCount(2);

  const moved = await moveLivePreviewToHistoryLayer(revisit);
  expect(moved).toEqual({ supported: true, moved: true, connected: true });
  await expect(truePreview.getByText("streamed answer", { exact: true })).toHaveCount(2);
  await revisit.locator(".tf-reading-preview-shell .tf-ui-icon-button").click();
  await expect(revisit.locator(".tf-reading-preview-frame")).toHaveCount(0);
  await expect(revisit.locator(".tf-reading-preview-shell")).toHaveCount(0);

  // A real browser restart drops the in-memory preview session while keeping the saved record and marker choice.
  await harness.restartBrowser();
  const restartedCenter = await harness.context.newPage();
  await restartedCenter.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(restartedCenter.getByRole("button", { name: "Disable site markers", exact: true })).toBeVisible();
  const afterRestart = await harness.open("/selection"); await harness.inject(afterRestart);
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(2);
  const restartedSessionMarker = afterRestart.locator(`.tf-reading-page-marker[data-record-id="${recordId}"]`);
  await restartedSessionMarker.click();
  const restartedPreview = afterRestart.frameLocator("iframe.tf-reading-preview-frame");
  await expect(restartedPreview.getByRole("heading", { name: followUpQuestion, exact: true })).toBeVisible();
  await expect(restartedPreview.getByText("streamed answer", { exact: true })).toHaveCount(2);
  expect(harness.server.calls).toHaveLength(providerCalls);

  // Site-marker revocation closes the embedded detail; a delayed bind response cannot restore it.
  await afterRestart.keyboard.press("Escape");
  await bindGate(harness.driver, afterRestart.url(), "install");
  await restartedSessionMarker.click();
  await expect.poll(() => bindGate(harness.driver, afterRestart.url(), "started")).toBe(true);
  const movedForRevoke = await moveLivePreviewToHistoryLayer(afterRestart);
  expect(movedForRevoke).toEqual({ supported: true, moved: true, connected: true });
  await restartedCenter.getByRole("button", { name: "Disable site markers", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-preview-frame")).toHaveCount(0);
  await bindGate(harness.driver, afterRestart.url(), "release");
  await bindGate(harness.driver, afterRestart.url(), "restore");
  await expect(afterRestart.locator(".tf-reading-preview-frame")).toHaveCount(0);
  await expect(restartedCenter.getByRole("button", { name: "Enable site markers", exact: true })).toBeVisible();
  await restartedCenter.getByRole("button", { name: "Enable site markers", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(2);

  // Deleting the source record revokes an open preview and removes its location marker.
  await restartedSessionMarker.click();
  await expect(afterRestart.locator(".tf-reading-preview-frame")).toBeVisible();
  await expect(afterRestart.frameLocator("iframe.tf-reading-preview-frame").getByText("streamed answer", { exact: true })).toHaveCount(2);
  const movedForDelete = await moveLivePreviewToHistoryLayer(afterRestart);
  expect(movedForDelete).toEqual({ supported: true, moved: true, connected: true });
  await restartedCenter.getByRole("button", { name: "Delete record", exact: true }).click();
  await restartedCenter.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(afterRestart.locator(".tf-reading-preview-frame")).toHaveCount(0);
  await expect(restartedSessionMarker).toHaveCount(0);
  await expect(afterRestart.locator(".tf-reading-page-marker")).toHaveCount(1);
  await expect(afterRestart.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
  expect(harness.server.calls).toHaveLength(providerCalls);
});
