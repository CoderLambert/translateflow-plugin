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
  await content.getByRole("button", { name: "解释这里是什么意思" }).click();
  await expect(content.locator(".tf-selection-generated-body")).toContainText("streamed");
  await content.getByRole("button", { name: "停止 AI 回答", exact: true }).click();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "interrupted");
  await expect(content.locator(".tf-selection-ai-detail")).toContainText("已停止，未保存");
  let listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  expect(listed.data.items).toHaveLength(1);
  let detail = await message(center, M.GET_RECORD, { recordId: listed.data.items[0].recordId });
  expect(detail.data.artifacts.filter(value => value.kind === "assistant")).toHaveLength(0);
  await content.getByRole("button", { name: "重新请求 AI 详解" }).click();
  await expect(content.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
  listed = await message(center, M.LIST_RECORDS, { pageKey: null, query: "session", cursor: null, limit: 30 });
  const recordId = listed.data.items[0].recordId;
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
