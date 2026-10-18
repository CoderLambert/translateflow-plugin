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
async function geometry(page, phase) {
  return page.evaluate(async (phase) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const host = document.querySelector("#translateflow-ui-root"), panel = host?.shadowRoot?.querySelector(".tf-selection-panel");
    const close = panel?.querySelector(".tf-selection-icon-button"), vv = visualViewport;
    const rect = value => value ? Object.fromEntries(["left", "top", "right", "bottom", "width", "height"].map(key => [key, value[key]])) : null;
    const rootStyle = getComputedStyle(document.documentElement);
    return { phase, innerWidth, innerHeight,
      visualViewport: vv ? { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale } : null,
      panelStyle: panel ? { left: panel.style.left, top: panel.style.top, width: panel.style.width, maxWidth: panel.style.maxWidth,
        maxHeight: panel.style.maxHeight } : null,
      panelRect: rect(panel?.getBoundingClientRect()), closeRect: rect(close?.getBoundingClientRect()), hostRect: rect(host?.getBoundingClientRect()),
      documentElement: { transform: rootStyle.transform, zoom: rootStyle.zoom } };
  }, phase);
}
function expectInsideViewport(value) {
  const viewport = value.visualViewport || { width: value.innerWidth, height: value.innerHeight, offsetLeft: 0, offsetTop: 0 };
  expect(value.panelRect.left).toBeGreaterThanOrEqual(viewport.offsetLeft + 7);
  expect(value.panelRect.right).toBeLessThanOrEqual(viewport.offsetLeft + viewport.width - 7);
  expect(value.panelRect.top).toBeGreaterThanOrEqual(viewport.offsetTop + 7);
  expect(value.panelRect.bottom, JSON.stringify(value)).toBeLessThanOrEqual(viewport.offsetTop + viewport.height - 7);
  expect(value.closeRect.left).toBeGreaterThanOrEqual(value.panelRect.left);
  expect(value.closeRect.right).toBeLessThanOrEqual(value.panelRect.right);
  expect(value.closeRect.top).toBeGreaterThanOrEqual(value.panelRect.top);
  expect(value.closeRect.bottom).toBeLessThanOrEqual(value.panelRect.bottom);
}

test("Content partial/Stop saves nothing; complete and grounded learning-center follow-up commit", async ({ harness }) => {
  test.setTimeout(60000); await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html`);
  const state = await message(center, M.GET_RECORDING_STATE);
  expect((await message(center, M.SET_RECORDING, { enabled: true, expectedConsentGeneration: state.data.consentGeneration })).ok).toBe(true);
  const content = await harness.open("/selection"); await harness.inject(content);
  await select(content, "#technical-competition", "session");
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  const stream = harness.server.holdNextAssistantStream();
  await content.getByRole("tab", { name: "AI 理解：解释这里是什么意思" }).click();
  await stream.started;
  await expect(content.locator(".tf-selection-generated-body")).toContainText("streamed");
  await content.getByRole("button", { name: "停止 AI 回答", exact: true }).click();
  await stream.finished;
  expect(harness.server.calls[0].responseState).toBe("closed");
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "interrupted");
  await expect(content.locator(".tf-selection-ai-detail")).toContainText("已停止，未保存");
  let listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  expect(listed.data.items).toHaveLength(1);
  let detail = await message(center, M.GET_RECORD, { recordId: listed.data.items[0].recordId });
  expect(detail.data.artifacts.filter(value => value.kind === "assistant")).toHaveLength(0);
  await content.getByRole("button", { name: "重新请求 AI 详解" }).click();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await content.locator("button.tf-selection-icon-button").first().click();
  await expect(content.locator(".tf-selection-panel")).toHaveCount(0);
  let recordId = "";
  await expect.poll(async () => {
    listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
    recordId = listed.data.items[0]?.recordId || "";
    if (!recordId) return 0;
    detail = await message(center, M.GET_RECORD, { recordId });
    return detail.data.artifacts.filter(value => value.kind === "assistant").length;
  }).toBe(1);
  detail = await message(center, M.GET_RECORD, { recordId });
  const root = detail.data.artifacts.find(value => value.kind === "assistant");
  expect(root.payload).toMatchObject({ action: "understand", parentTurnId: null, regenerationOf: null,
    completionStatus: "completed", assistantAnswer: "streamed answer" });
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#record=${recordId}`);
  await expect(center.getByRole("heading", { name: "session", exact: true })).toBeVisible();
  await center.getByRole("button", { name: "继续追问" }).click();
  await center.getByPlaceholder("针对这条已保存回答继续提问").fill("为什么这里这样表达？");
  await center.getByRole("button", { name: "发送", exact: true }).click();
  await expect(center.getByRole("heading", { name: "为什么这里这样表达？", exact: true })).toBeVisible();
  await expect(center.getByText("streamed answer", { exact: true })).toHaveCount(2);
  detail = await message(center, M.GET_RECORD, { recordId });
  const turns = detail.data.artifacts.filter(value => value.kind === "assistant");
  expect(turns).toHaveLength(2);
  const followUp = turns.find(value => value.payload.action === "follow-up");
  expect(followUp.payload).toMatchObject({ action: "follow-up", parentTurnId: root.payload.turnId,
    threadId: root.payload.threadId, branchId: root.payload.branchId, completionStatus: "completed" });
  expect(JSON.parse(harness.server.calls.at(-1).userContent)).not.toHaveProperty("url");
});

test("A no-hit AI answer clears the temporary connection status after completion", async ({ harness }) => {
  test.setTimeout(60000); await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const content = await harness.open("/selection"); await harness.inject(content);
  await select(content, "#nohit", "TFNoSuchLexeme");
  await content.getByRole("tab", { name: "AI 分析：拆解这里的表达", exact: true }).click();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(content.locator(".tf-selection-status")).toHaveText("");
  await expect(content.locator(".tf-selection-status")).toHaveAttribute("data-kind", "success");
});

test("Dictionary and AI tabs stay isolated, lazy and reusable within one selection", async ({ harness }) => {
  test.setTimeout(60000); await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const content = await harness.open("/selection"); await harness.inject(content);
  await select(content, "#technical-competition", "session");
  const dictionary = content.getByRole("tab", { name: "显示词典结果" });
  const understand = content.getByRole("tab", { name: "AI 理解：解释这里是什么意思" });
  const analyze = content.getByRole("tab", { name: "AI 分析：拆解这里的表达" });
  await expect(dictionary).toHaveAttribute("aria-selected", "true");
  await expect(content.locator("#tf-selection-panel-dictionary")).toBeVisible();
  expect(harness.server.calls).toHaveLength(0);

  await dictionary.press("ArrowRight");
  await expect(understand).toBeFocused();
  expect(harness.server.calls).toHaveLength(0);
  await understand.press("Enter");
  await expect(content.locator("#tf-selection-panel-understand .tf-selection-generated-body")).toContainText("streamed");
  await dictionary.click();
  await expect(content.locator("#tf-selection-panel-dictionary")).toBeVisible();
  await expect(content.locator("#tf-selection-panel-understand")).toBeHidden();
  await expect(understand).toHaveAttribute("data-state", "success");
  expect(harness.server.calls).toHaveLength(1);

  await understand.click();
  await expect(content.locator("#tf-selection-panel-understand .tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  expect(harness.server.calls).toHaveLength(1);
  await analyze.click();
  await expect(content.locator("#tf-selection-panel-analyze .tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  expect(harness.server.calls).toHaveLength(2);
  expect(JSON.parse(harness.server.calls.at(-1).userContent)).toMatchObject({ question: "拆解这里的表达。" });
  await understand.click();
  await expect(content.locator("#tf-selection-panel-understand .tf-selection-generated-body")).toContainText("streamed answer");
  expect(harness.server.calls).toHaveLength(2);
});

test("AI Markdown is rendered safely without changing the dictionary window size", async ({ harness }) => {
  test.setTimeout(60000); await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const content = await harness.open("/selection"); await content.setViewportSize({ width: 1280, height: 900 }); await harness.inject(content);
  await content.evaluate(() => {
    const node = document.createElement("p"); node.id = "markdown-fixture"; node.textContent = "markdownfixture"; document.body.prepend(node);
  });
  const external = [];
  content.on("request", request => {
    if (/^https?:/u.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url());
  });
  await select(content, "#markdown-fixture", "markdownfixture");
  const panel = content.locator(".tf-selection-panel"), dictionarySize = await panel.boundingBox();
  await content.getByRole("tab", { name: "AI 理解：解释这里是什么意思" }).click();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  const body = content.locator("#tf-selection-panel-understand .tf-selection-generated-body");
  await expect(body.locator("h2")).toHaveText("Summary");
  await expect(body.locator("strong")).toHaveText("streamed");
  await expect(body.locator("li")).toHaveCount(2);
  await expect(body.locator("code")).toHaveText("code");
  await expect(body.locator("img, script")).toHaveCount(0);
  await expect(body).toContainText("unsafe");
  expect(await body.locator("a").evaluateAll(links => links.some(link => link.href.startsWith("javascript:")))).toBe(false);
  const aiSize = await panel.boundingBox();
  expect(Math.abs(aiSize.width - dictionarySize.width)).toBeLessThanOrEqual(1);
  await expect(content.locator(".tf-selection-footer-actions").getByRole("button", { name: "复制" })).toHaveCount(0);
  expect(external).toEqual([]);
});

test("Narrow initial, streaming and completed AI panels stay inside the actual visual viewport", async ({ harness }) => {
  test.setTimeout(60000); await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: { baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } });
  const content = await harness.open("/selection"); await content.setViewportSize({ width: 360, height: 420 }); await harness.inject(content);
  await select(content, "#technical-competition", "session");
  await expect(async () => expectInsideViewport(await geometry(content, "initial"))).toPass({ timeout: 6000 });
  const stream = harness.server.holdNextAssistantStream();
  await content.getByRole("tab", { name: "AI 理解：解释这里是什么意思" }).click();
  await stream.started;
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "streaming");
  await expect(content.locator(".tf-selection-generated-body")).toContainText("streamed");
  await expect(async () => expectInsideViewport(await geometry(content, "streaming"))).toPass({ timeout: 6000 });
  stream.release();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(async () => expectInsideViewport(await geometry(content, "completed"))).toPass({ timeout: 6000 });
});
