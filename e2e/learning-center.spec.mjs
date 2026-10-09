import { test, expect } from "./support/extension-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";
import { writeFile } from "node:fs/promises";
async function select(page, selector, text) {
  await page.evaluate(({ selector, text }) => {
    const node = document.querySelector(selector).firstChild;
    const offset = node.nodeValue.indexOf(text), range = document.createRange();
    range.setStart(node, offset); range.setEnd(node, offset + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, text });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await page.locator(".tf-selection-chip").click();
}
async function waitForStableReturnCard(page, quietMs = 300) {
  await page.locator(".tf-reading-return-card").evaluate((card, quietMs) => new Promise(resolve => {
    let timer;
    const finish = () => { observer.disconnect(); resolve(); };
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(finish, quietMs); });
    observer.observe(card, { subtree: true, childList: true, characterData: true, attributes: true });
    timer = setTimeout(finish, quietMs);
  }), quietMs);
}
const message = (page, method, fields = {}) => page.evaluate(request => chrome.runtime.sendMessage(request), { protocolVersion: 2, method, ...fields });
async function trace(page) {
  await page.evaluate(() => {
    window.readingRequests = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = request => { if (request.method) window.readingRequests.push(request.method); return send(request); };
  });
}

test("real toolbar Popup reports success when opening the learning center closes it", async ({ harness }) => {
  await harness.reset();
  await harness.serviceWorker.evaluate(() => chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.method === "reading.open-learning-center") globalThis.__toolbarPopupSender = {
      id: sender.id, url: sender.url, origin: sender.origin, documentId: sender.documentId,
      documentLifecycle: sender.documentLifecycle, frameId: sender.frameId,
      tab: sender.tab ? { id: sender.tab.id, incognito: sender.tab.incognito, url: sender.tab.url } : null
    };
  }));
  const cdp = await harness.context.newCDPSession(harness.driver);
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await harness.driver.evaluate(() => {
    const button = document.createElement("button");
    button.id = "open-real-popup";
    button.textContent = "Open real popup";
    button.addEventListener("click", () => chrome.action.openPopup());
    document.body.append(button);
  });
  await harness.driver.locator("#open-real-popup").click();
  await expect.poll(() => harness.driver.evaluate(async () =>
    (await chrome.runtime.getContexts({ contextTypes: ["POPUP"] })).length)).toBe(1);
  const popupContexts = await harness.driver.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["POPUP"] }));
  expect(popupContexts).toHaveLength(1);
  const popupUrl = `chrome-extension://${harness.extensionId}/popup.html`;
  const targets = await cdp.send("Target.getTargets");
  const popupTarget = targets.targetInfos.find(target => target.url === popupUrl);
  expect(popupTarget).toBeTruthy();
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: popupTarget.targetId });
  const evaluateId = 1;
  await cdp.send("Target.sendMessageToTarget", { sessionId,
    message: JSON.stringify({ id: evaluateId, method: "Runtime.evaluate",
      params: { expression: `chrome.runtime.sendMessage({
        protocolVersion: 2, method: "reading.open-learning-center"
      })`, awaitPromise: true, returnByValue: true } }) });
  const centerUrl = `chrome-extension://${harness.extensionId}/learning-center.html`;
  await expect.poll(() => harness.context.pages().filter(page => page.url() === centerUrl).length).toBe(1);
  const sender = await harness.serviceWorker.evaluate(() => globalThis.__toolbarPopupSender);
  expect(sender).toMatchObject({ id: harness.extensionId, url: popupUrl,
    origin: `chrome-extension://${harness.extensionId}`, tab: null });
  expect(sender.frameId).toBeUndefined();
  expect(sender.documentId).toBeUndefined();
  expect(await harness.driver.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["POPUP"] })).length)).toBe(0);
  await cdp.detach();
});

test("Actual React product: Popup/selection, consent, real save, history, site policy, delete and JSON download", async ({ harness }, info) => {
  test.setTimeout(120000);
  await harness.reset();
  await harness.driver.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN" }));
  await harness.driver.reload();
  const opened = harness.context.waitForEvent("page");
  await harness.driver.getByRole("button", { name: "学习中心" }).click();
  const center = await opened;
  await center.waitForURL(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await expect(center.getByRole("heading", { name: "学习中心", exact: true })).toBeVisible();
  await expect(center.getByRole("button", { name: "开启记录", exact: true })).toBeEnabled();
  await center.getByRole("button", { name: "暂不开启", exact: true }).click();
  expect((await message(center, M.GET_RECORDING_STATE)).data.enabled).toBe(false);
  const content = await harness.open("/selection"); await harness.inject(content);
  const contentTab = await harness.tabId(content);
  await harness.driver.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    globalThis.readingTrace = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (request, callback) => send(request, response => {
      if (request.method) globalThis.readingTrace.push({ method: request.method, response });
      callback?.(response);
    });
  } }), contentTab);
  await select(content, "#technical-competition", "session");
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "invite");
  const selectionOpened = harness.context.waitForEvent("page");
  await content.getByRole("button", { name: "在学习中心开启阅读记录" }).click();
  const consent = await selectionOpened;
  await expect(consent.getByRole("button", { name: "开启记录", exact: true })).toBeEnabled();
  await consent.getByRole("button", { name: "开启记录", exact: true }).click();
  await expect(consent.getByRole("button", { name: "暂停记录", exact: true })).toBeVisible();
  await content.bringToFront();
  await content.evaluate(() => window.dispatchEvent(new Event("focus")));
  try { await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "manual"); }
  catch (error) {
    const trace = await harness.driver.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.readingTrace }))[0].result, contentTab);
    console.log("SYNTHETIC_READING_TRACE", JSON.stringify(trace)); throw error;
  }
  await content.getByRole("button", { name: "保存本次结果", exact: true }).click();
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await select(content, "#unknown-phrase", "session");
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await center.bringToFront();
  await expect(center.locator(".record-list .record")).toHaveCount(2);
  await trace(center);
  await harness.serviceWorker.evaluate(() => chrome.runtime.onMessage.addListener((request, sender) => { if (request.method) globalThis.lastLearningNative = { url: sender.url, documentId: sender.documentId }; }));
  const providerBefore = harness.server.calls.length;
  const resources = [];
  center.on("request", request => { if (/lexicon|mdd|mdx|https?:/.test(request.url())) resources.push(request.url()); });
  const recordId = await center.locator(".record-list .record").first().getAttribute("data-record-id");
  await center.locator(".record-list .record").first().click();
  try { await expect(center.getByRole("heading", { name: "session", exact: true })).toBeVisible(); }
  catch (error) {
    console.log("SYNTHETIC_LC_NATIVE", JSON.stringify(await harness.serviceWorker.evaluate(async () => ({ sender: globalThis.lastLearningNative, contexts: await chrome.runtime.getContexts({ contextTypes: ["TAB"] }) }))));
    console.log("SYNTHETIC_LC_STATE", JSON.stringify(await message(center, M.GET_RECORDING_STATE))); throw error;
  }
  await expect(center.getByText("历史快照 · 可离线阅读")).toBeVisible();
  await harness.driver.evaluate(() => chrome.storage.local.remove(["provider", "openAICompatible"]));
  await harness.context.setOffline(true);
  await center.reload();
  await expect(center.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await trace(center);
  await center.getByRole("button", { name: "返回记录列表", exact: true }).click();
  await center.getByLabel("搜索记录", { exact: true }).fill("no-such-synthetic-record");
  await center.getByRole("button", { name: "搜索记录", exact: true }).click();
  await expect(center.getByText("没有匹配的记录。")).toBeVisible();
  await center.getByLabel("搜索记录", { exact: true }).fill("session");
  await center.getByRole("button", { name: "搜索记录", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(2);
  await center.getByRole("button", { name: "按页面", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(1);
  await center.locator(".record-list .record").first().click();
  await expect(center.getByRole("button", { name: "删除本页记录", exact: true })).toBeVisible();
  await center.locator(".management summary").click();
  await center.getByRole("button", { name: `不记录此站点 · ${harness.server.baseUrl}`, exact: true }).click();
  await expect(center.getByRole("button", { name: "恢复本站记录", exact: true })).toBeVisible();
  await center.getByRole("button", { name: "恢复本站记录", exact: true }).click();
  await expect(center.getByText("没有排除的站点。")).toBeVisible();
  await center.getByRole("button", { name: "暂停记录", exact: true }).click();
  await expect(center.getByRole("button", { name: "恢复记录", exact: true })).toBeVisible();
  await expect(center.locator(".record-list .record")).toHaveCount(2);
  await center.getByRole("button", { name: "恢复记录", exact: true }).click();
  const listRequests = await center.evaluate(() => window.readingRequests);
  expect(listRequests.filter(method => method === M.GET_RECORD)).toHaveLength(0);
  await center.screenshot({ path: info.outputPath("learning-center-records-zh.png"), fullPage: true });
  const downloaded = center.waitForEvent("download");
  await center.getByRole("button", { name: "导出 JSON", exact: true }).click();
  const file = await downloaded; const stream = await file.createReadStream(); const parts = [];
  for await (const part of stream) parts.push(part);
  const exported = JSON.parse(Buffer.concat(parts).toString("utf8"));
  expect(exported.format).toBe("translateflow-reading"); expect(exported.records).toHaveLength(2);
  expect(new Set(exported.records.map(item => item.snapshots[0].contextText)).size).toBe(2);
  await expect(center.getByText("文件已生成，已发起下载；无法确认浏览器是否保存文件。")).toBeVisible();
  expect(harness.server.calls).toHaveLength(providerBefore); expect(resources).toEqual([]);
  await center.locator(".record-list .record").first().click();
  await expect(center.getByRole("button", { name: "删除记录", exact: true })).toBeVisible();
  await center.getByRole("button", { name: "删除记录", exact: true }).click();
  await center.getByRole("button", { name: "确认", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(1);
  await center.getByRole("button", { name: "删除本页记录", exact: true }).click();
  await center.getByRole("button", { name: "取消", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(1);
  await center.getByRole("button", { name: "删除本页记录", exact: true }).click();
  await center.getByRole("button", { name: "确认", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(0);
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(center.getByText("此记录不可用或已删除，请返回列表。")).toBeVisible();
  await center.getByRole("button", { name: "返回记录列表", exact: true }).click();
  await center.evaluate(() => chrome.storage.local.set({ uiLocale: "en" }));
  await expect(center.getByRole("heading", { name: "Learning center", exact: true })).toBeVisible();
  await expect(center.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();
  await expect(center.getByText("Connection interrupted. Saved content cannot be confirmed. Retry to reconnect.")).toHaveCount(0);
  await center.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await center.setViewportSize({ width: 360, height: 760 });
  expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await center.screenshot({ path: info.outputPath("learning-center-dark-narrow-en.png"), fullPage: true });
  await harness.context.setOffline(false);
  await writeFile(info.outputPath("learning-center-product.json"), JSON.stringify({ browser: harness.context.browser().version(), build: harness.buildReport,
    realCreation: "trusted Selection dictionary query → LC enable → explicit current-card save", historyProviderCalls: harness.server.calls.length - providerBefore, historyResources: resources,
    exportRecords: exported.records.length, offlineHistory: true, providerUnconfigured: true, nonSensitiveDeepLink: true, locales: ["zh_CN", "en"] }, null, 2));
});

test("Reading user journey: explicit consent, persistent browser restart, exact return and deleted page history", async ({ harness }, info) => {
  test.setTimeout(120000);
  await harness.resetProfile();
  await harness.reset();
  await harness.setStorage({ uiLocale: "en", readingMemorySites: [] });
  await harness.driver.reload();

  const firstCenterOpened = harness.context.waitForEvent("page");
  await expect(harness.driver.locator("#learningCenter")).toBeVisible();
  await harness.driver.locator("#learningCenter").click();
  const firstCenter = await firstCenterOpened;
  await firstCenter.waitForURL(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await expect(firstCenter.getByRole("button", { name: "Not now", exact: true })).toBeEnabled();
  await firstCenter.getByRole("button", { name: "Not now", exact: true }).click();

  const content = await harness.open("/selection");
  await harness.inject(content);
  await select(content, "#technical-competition", "session");
  await expect(content.locator(".tf-selection-result")).toContainText("会话");
  await content.getByRole("button", { name: "Save to wordbook", exact: true }).click();
  await expect(content.getByRole("button", { name: "Open wordbook", exact: true })).toBeVisible();
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "invite");
  await expect(firstCenter.locator(".record-list .record")).toHaveCount(0);
  expect(harness.server.calls).toHaveLength(0);

  const consentOpened = harness.context.waitForEvent("page");
  await content.getByRole("button", { name: "Enable reading records in Learning Center", exact: true }).click();
  const consent = await consentOpened;
  await expect(consent.getByRole("button", { name: "Enable recording", exact: true })).toBeEnabled();
  await consent.getByRole("button", { name: "Enable recording", exact: true }).click();
  await expect(consent.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();

  await content.bringToFront();
  await content.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "manual");
  await expect(firstCenter.locator(".record-list .record")).toHaveCount(0);
  await content.getByRole("button", { name: "Save this result", exact: true }).click();
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  await expect(firstCenter.locator(".record-list .record")).toHaveCount(1);
  expect(harness.server.calls).toHaveLength(0);

  const recordId = await firstCenter.locator(".record-list .record").first().getAttribute("data-record-id");
  await firstCenter.locator(`[data-record-id="${recordId}"]`).click();
  await expect(firstCenter.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(firstCenter.getByRole("button", { name: /site markers/i })).toHaveCount(0);
  await firstCenter.screenshot({ path: info.outputPath("reading-user-journey-saved-history.png"), fullPage: true });

  const restart = await harness.restartBrowser();
  expect(restart).toMatchObject({ extensionId: harness.extensionId, restartedPersistentProfile: true });
  const history = await harness.context.newPage();
  await history.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await expect(history.locator(".record-list .record")).toHaveCount(1);
  await history.screenshot({ path: info.outputPath("reading-user-journey-after-restart.png"), fullPage: true });
  await history.getByRole("button", { name: "Wordbook", exact: true }).click();
  await expect(history.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Review", exact: true }).click();
  await expect(history.getByTestId("vocabulary-review-card")).toContainText("session");
  await history.getByRole("button", { name: "Show meaning", exact: true }).click();
  await expect(history.locator(".vocabulary-answer")).toContainText("会话");
  await history.getByRole("button", { name: "Still learning", exact: true }).click();
  await expect(history.getByText("Try this word again in about 15 minutes.", { exact: true })).toBeVisible();
  await expect(history.getByTestId("vocabulary-review-card")).toHaveCount(0);
  await history.screenshot({ path: info.outputPath("reading-user-journey-wordbook-reviewed.png"), fullPage: true });
  await history.getByRole("button", { name: "Wordbook", exact: true }).click();
  await history.locator("[data-entry-id]").getByRole("button", { name: "Delete word", exact: true }).click();
  await history.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(history.getByText(/No saved words yet/u)).toBeVisible();
  await history.getByRole("button", { name: "Reading history", exact: true }).click();
  await expect(history.locator(".record-list .record")).toHaveCount(1);
  await history.locator(`[data-record-id="${recordId}"]`).click();
  await expect(history.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(history.getByText("Historical snapshot · readable offline")).toBeVisible();

  const returnedOpened = harness.context.waitForEvent("page");
  await history.getByRole("button", { name: "Return to original page", exact: true }).click();
  const returned = await returnedOpened;
  await returned.waitForLoadState("domcontentloaded");
  await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
  await expect(returned.locator(".tf-reading-return-card blockquote")).toHaveText("session");
  await expect(returned.locator(".tf-reading-return-highlight")).not.toHaveCount(0);
  await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
  await expect(returned.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
  await expect(returned.locator(".tf-reading-page-marker")).toHaveCount(1);
  await waitForStableReturnCard(returned);
  await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
  await expect(returned.locator(".tf-reading-return-card blockquote")).toHaveText("session");
  await returned.screenshot({ path: info.outputPath("reading-user-journey-return-state.png"), fullPage: false });
  if (await returned.locator(".tf-reading-return-card").getAttribute("data-state") !== "resolved") {
    await returned.getByRole("button", { name: "Locate again", exact: true }).click();
  }
  await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
  await expect(returned.locator(".tf-reading-return-card blockquote")).toHaveText("session");
  await returned.locator(".tf-reading-page-toggle").click();
  await expect(returned.locator(".tf-reading-page-panel")).toBeVisible();
  await expect(returned.locator(".tf-reading-page-panel article")).toHaveCount(1);
  await expect(returned.locator(".tf-reading-page-panel article")).toContainText("session");

  const recordOpened = harness.context.waitForEvent("page");
  await returned.locator('[data-action="open-record"]').click();
  const recordPage = await recordOpened;
  await recordPage.waitForLoadState("domcontentloaded");
  await expect(recordPage.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(recordPage.getByText("Historical snapshot · readable offline")).toBeVisible();
  expect(harness.server.calls).toHaveLength(0);

  const latestReturnOpened = harness.context.waitForEvent("page");
  await recordPage.getByRole("button", { name: "Return to original page", exact: true }).click();
  const latestReturned = await latestReturnOpened;
  await latestReturned.waitForLoadState("domcontentloaded");
  await expect(latestReturned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
  await expect(latestReturned.locator(".tf-reading-return-card blockquote")).toHaveText("session");
  await expect(latestReturned.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
  await expect(latestReturned.locator(".tf-reading-page-marker")).toHaveCount(1);
  await waitForStableReturnCard(latestReturned);
  await expect(latestReturned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();

  await recordPage.getByRole("button", { name: "Delete record", exact: true }).click();
  await recordPage.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(recordPage.locator(".record-list .record")).toHaveCount(0);
  await expect(recordPage.locator("header")).toContainText("Records: 0");
  await expect(recordPage.getByText("Connection interrupted. Saved content cannot be confirmed.", { exact: true })).toHaveCount(0);
  await expect(latestReturned.locator(".tf-reading-page-toggle")).toHaveCount(0);
  await expect(latestReturned.locator(".tf-reading-page-marker")).toHaveCount(0);
  await expect(latestReturned.locator(".tf-reading-return-card")).toHaveCount(0);
  await recordPage.screenshot({ path: info.outputPath("reading-user-journey-deleted.png"), fullPage: true });
  await writeFile(info.outputPath("reading-user-journey.json"), JSON.stringify({
    browser: harness.context.browser().version(), build: harness.buildReport,
    flow: ["local lookup → explicit wordbook save", "explicit Reading enable → save current query", "persistent-profile browser restart", "wordbook → review → delete while Reading history remains", "Learning Center history → exact original page and range", "open historical record", "delete Reading record → list and page history entry disappear"],
    page: "localhost synthetic fixture /selection; synthetic local dictionary; test-only localhost permission",
    provider: "mock endpoint configured without a real API key; explicit test flow observed 0 Provider requests",
    afterRestartRecordRows: 1, returnLocation: "resolved", historyEntryAfterDeletion: 0,
    screenshotFiles: ["reading-user-journey-saved-history.png", "reading-user-journey-after-restart.png", "reading-user-journey-wordbook-reviewed.png", "reading-user-journey-return-state.png", "reading-user-journey-deleted.png"]
  }, null, 2));
});

test("Supplementary synthetic canonical rows: bounded pagination, >1 MiB detail, cancellation and native export download", async ({ harness }, info) => {
  test.setTimeout(120000);
  // Synthetic seeding supplements the real trusted creation story above; the compiled product is unchanged.
  const { sourceClosure } = await import("../scripts/wxt-assets.mjs");
  const { cp, mkdir, readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const files = await sourceClosure(["tests/fixtures/reading/storage.mjs"]);
  for (const file of files) {
    const target = join(harness.extensionDir, file), source = join(import.meta.dirname, "..", file);
    try { expect(await readFile(target)).toEqual(await readFile(source)); }
    catch (error) { if (error.code !== "ENOENT") throw error; await mkdir(dirname(target), { recursive: true }); await cp(source, target); }
  }
  const center = await harness.context.newPage(); await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await center.evaluate(async () => {
    await chrome.storage.local.set({ uiLocale: "en" });
    const { seedRecords } = await import(chrome.runtime.getURL("tests/fixtures/reading/storage.mjs")); await seedRecords(31);
  });
  await center.reload(); await trace(center);
  await expect(center.locator(".record-list .record")).toHaveCount(30);
  await center.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(31);
  expect((await center.evaluate(() => window.readingRequests)).filter(method => method === M.GET_RECORD)).toHaveLength(0);
  await center.evaluate(async () => { const { seedRecords } = await import(chrome.runtime.getURL("tests/fixtures/reading/storage.mjs")); await seedRecords(1, { artifacts: 64, answerChars: 24000 }); });
  await center.reload();
  await center.locator(".record-list .record").first().click();
  await expect(center.locator(".artifact")).toHaveCount(5);
  await center.getByRole("button", { name: "Back to records", exact: true }).click();
  await center.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let held = false;
    window.holdNextExport = () => { held = false; window.releaseExportChunk = null; };
    chrome.runtime.sendMessage = async request => {
      const result = await send(request);
      if (request.method === "reading.export-next" && !held) {
        held = true; await new Promise(resolve => { window.releaseExportChunk = resolve; });
      }
      return result;
    };
  });
  await center.getByRole("button", { name: "Export JSON", exact: true }).click();
  await expect.poll(() => center.evaluate(() => Boolean(window.releaseExportChunk))).toBe(true);
  await center.getByRole("button", { name: "Cancel", exact: true }).click();
  await center.evaluate(() => window.releaseExportChunk());
  await expect(center.getByText("Export cancelled. No file was generated.")).toBeVisible();
  await center.evaluate(() => window.holdNextExport());
  await center.getByRole("button", { name: "Export JSON", exact: true }).click();
  await expect.poll(() => center.evaluate(() => Boolean(window.releaseExportChunk))).toBe(true);
  const other = await harness.context.newPage(); await other.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await other.getByRole("button", { name: "Pause recording", exact: true }).click();
  await expect(other.getByRole("button", { name: "Resume recording", exact: true })).toBeVisible();
  await center.evaluate(() => window.releaseExportChunk());
  await expect(center.getByText("Content changed or export was interrupted. Please retry.")).toBeVisible();
  await other.close();
  const downloaded = center.waitForEvent("download");
  await center.getByRole("button", { name: "Export JSON", exact: true }).click();
  const file = await downloaded, stream = await file.createReadStream(), parts = [];
  for await (const part of stream) parts.push(part);
  const bytes = Buffer.concat(parts); expect(bytes.length).toBeGreaterThan(1024 * 1024);
  const data = JSON.parse(bytes.toString("utf8")); expect(data.records[0].artifacts).toHaveLength(64);
  expect(data.records[0].artifacts[0].payload.assistantAnswer).toContain("😀中");
  await expect(center.getByText("File generated; download initiated. Browser file saving is not confirmed.")).toBeVisible();
  await center.getByRole("button", { name: "Delete all records", exact: true }).click();
  await center.keyboard.press("Escape");
  await expect(center.locator("dialog")).not.toBeVisible();
  await expect(center.getByRole("button", { name: "Delete all records", exact: true })).toBeFocused();
  await center.getByRole("button", { name: "Delete all records", exact: true }).click();
  await center.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(center.locator(".record-list .record")).toHaveCount(0);
  await writeFile(info.outputPath("learning-center-large-export.json"), JSON.stringify({ syntheticSeed: true, testOnlyFiles: files, bytes: bytes.length, artifacts: 64, pagination: [30, 31], browser: harness.context.browser().version() }, null, 2));
});
