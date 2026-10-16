import { test, expect } from "./support/extension-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";
import { VOCABULARY_BOOK_STORAGE_KEY } from "../src/background/vocabulary-book.js";

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

async function enableRecording(center) {
  const state = await message(center, M.GET_RECORDING_STATE);
  if (!state.data.enabled) expect((await message(center, M.SET_RECORDING,
    { enabled: true, expectedConsentGeneration: state.data.consentGeneration })).ok).toBe(true);
}

async function disableRecording(center) {
  const state = await message(center, M.GET_RECORDING_STATE);
  if (state.data.enabled) expect((await message(center, M.SET_RECORDING,
    { enabled: false, expectedConsentGeneration: state.data.consentGeneration })).ok).toBe(true);
}

test("complete AI result persists to Learning Center and wordbook across a browser restart", async ({ harness }) => {
  test.setTimeout(90000);
  await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: {
    baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true
  } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await enableRecording(center);

  const content = await harness.open("/selection");
  await harness.inject(content);
  await select(content, "#technical-competition", "session");
  await content.getByRole("tab", { name: "AI 理解：解释这里是什么意思" }).click();
  const panel = content.locator("#tf-selection-panel-understand");
  await expect(panel.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(panel).toContainText("已保存到学习中心");
  await expect(panel).not.toContainText("该结果暂不支持保存");
  expect(harness.server.calls).toHaveLength(1);

  await panel.getByRole("button", { name: "收藏 AI 笔记到生词本" }).click();
  await expect(panel).toContainText("已将 AI 学习笔记加入生词本");
  await expect.poll(async () => (await harness.getStorage(VOCABULARY_BOOK_STORAGE_KEY))[VOCABULARY_BOOK_STORAGE_KEY])
    .toMatchObject({ version: 2, entries: [{ headword: "session", definitions: [], sources: [], aiNotes: [{ action: "understand",
      text: "streamed answer", truncated: false, provenance: { provider: "openai-chat", model: "mock-model" } }] }] });
  const beforeRestart = await harness.getStorage(VOCABULARY_BOOK_STORAGE_KEY);
  const readingRef = beforeRestart[VOCABULARY_BOOK_STORAGE_KEY].entries[0].aiNotes[0].readingRef;
  expect(readingRef).not.toBeNull();

  await harness.restartBrowser();
  const restartedCenter = await harness.context.newPage();
  await restartedCenter.goto(`chrome-extension://${harness.extensionId}/learning-center.html#wordbook`);
  await expect(restartedCenter.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await expect(restartedCenter.getByRole("heading", { name: "词典释义" })).toHaveCount(0);
  await expect(restartedCenter.getByRole("heading", { name: "AI 学习笔记" })).toBeVisible();
  await expect(restartedCenter.getByText("openai-chat · mock-model")).toBeVisible();
  const linked = await message(restartedCenter, M.GET_RECORD, { recordId: readingRef.recordId });
  if (!linked.ok) throw new Error(`Linked Reading record failed: ${JSON.stringify(linked.error)}`);
  expect(linked).toMatchObject({ ok: true });
  expect(linked.data.artifacts.map(artifact => artifact.artifactId)).toContain(readingRef.artifactId);
  await restartedCenter.getByRole("button", { name: "打开完整回答" }).click();
  await expect(restartedCenter).toHaveURL(/#record=/u);
  await expect(restartedCenter.getByText("streamed answer", { exact: true })).toBeVisible();
  expect(harness.server.calls).toHaveLength(1);
});

test("recording-off AI result waits for explicit enable and save without another Provider request", async ({ harness }) => {
  test.setTimeout(90000);
  await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: {
    baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true
  } });
  const controlCenter = await harness.context.newPage();
  await controlCenter.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  await disableRecording(controlCenter);
  await controlCenter.close();
  const content = await harness.open("/selection");
  await harness.inject(content);
  await select(content, "#technical-competition", "session");
  await content.getByRole("tab", { name: "AI 分析：拆解这里的表达" }).click();
  const panel = content.locator("#tf-selection-panel-analyze");
  await expect(panel.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(panel).toContainText("AI 回答未保存：阅读记录已暂停");
  expect(harness.server.calls).toHaveLength(1);

  await panel.getByRole("button", { name: "收藏 AI 笔记到生词本" }).click();
  await expect(panel).toContainText("已将 AI 学习笔记加入生词本");
  await expect.poll(async () => (await harness.getStorage(VOCABULARY_BOOK_STORAGE_KEY))[VOCABULARY_BOOK_STORAGE_KEY])
    .toMatchObject({ entries: [{ headword: "session", aiNotes: [{ action: "analyze", text: "streamed answer", readingRef: null }] }] });
  expect(harness.server.calls).toHaveLength(1);

  const opened = harness.context.waitForEvent("page");
  await panel.getByRole("button", { name: "保存到学习中心" }).click();
  const center = await opened;
  await expect(center).toHaveURL(/learning-center\.html/u);
  expect((await message(center, M.GET_RECORDING_STATE)).data.enabled).toBe(false);
  await center.getByRole("button", { name: /开启记录|恢复记录/u }).click();
  await content.bringToFront();
  await content.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(panel).toContainText("此完整回答可保存到学习中心");
  await panel.getByRole("button", { name: "保存到学习中心" }).click();
  await expect(panel).toContainText("已保存到学习中心");
  expect(harness.server.calls).toHaveLength(1);

  const listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  const details = await Promise.all(listed.data.items.map(item => message(center, M.GET_RECORD, { recordId: item.recordId })));
  const analyzeNotes = details.flatMap(detail => detail.data.artifacts)
    .filter(artifact => artifact.kind === "assistant" && artifact.payload.action === "analyze");
  expect(analyzeNotes).toHaveLength(1);
});
