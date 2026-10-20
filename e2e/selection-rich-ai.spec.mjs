import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

test("rich dictionary hits retain lazy AI tabs, dictionary content and stale-answer isolation", async ({ harness }, testInfo) => {
  test.setTimeout(90_000);
  const headword = "noted";
  await harness.reset();
  await harness.setStorage({ uiLocale: "zh_CN", openAICompatible: {
    baseUrl: `${harness.server.baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true
  } });
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: "rich-ai-fixture.mdx", mimeType: "application/octet-stream",
    buffer: makeRichMdx([
      [headword, '<p><b>Original rich definition</b> remains available.</p><a href="entry://freshaiterm">Open related entry</a>'],
      ["freshaiterm", "<p>Fresh rich definition</p>"]
    ], { title: "Rich AI Fixture" })
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Rich AI Fixture");
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });

  const page = await harness.open("/selection");
  await page.evaluate(headword => {
    for (const text of [headword, "freshaiterm"]) {
      const node = document.createElement("p"); node.id = text; node.textContent = text;
      document.body.appendChild(node);
    }
  }, headword);
  await harness.inject(page);
  const resolved = await harness.runtime({ type: "SELECTION_RESOLVE", text: headword, pageUrl: page.url() });
  expect(resolved.lookup.status).toBe("no-hit");
  expect(resolved.routeReason).toBe("no-hit-local");
  expect(resolved.preferRich).toBe(false, "the no-hit route schedules rich lookup through its existing local path");
  expect(resolved.explanationAllowed).toBe(true);
  await select(page, headword);
  const dictionary = page.locator("#tf-selection-tab-dictionary");
  const richViewer = page.locator(".tf-selection-rich-record .tf-rich-viewer");
  await expect(richViewer).toContainText("Original rich definition");
  const originalViewer = await richViewer.elementHandle();
  await page.locator(".tf-selection-size-toggle").click();
  await expect(page.locator(".tf-selection-panel")).toHaveAttribute("data-view-mode", "reading");
  for (const action of ["understand", "analyze", "usage"]) {
    await expect(page.locator(`#tf-selection-tab-${action}`)).toBeVisible();
    await expect(page.locator(`#tf-selection-tab-${action}`)).toBeEnabled();
  }
  expect(harness.server.calls).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("rich-hit-ai-tabs.png") });

  for (const [index, action] of ["understand", "analyze", "usage"].entries()) {
    await page.locator(`#tf-selection-tab-${action}`).click();
    const pane = page.locator(`#tf-selection-panel-${action}`);
    await expect(pane.locator(".tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
    await expect(pane.locator(".tf-selection-generated-body")).toHaveText("streamed answer");
    expect(harness.server.calls).toHaveLength(index + 1);
    const payload = JSON.parse(harness.server.calls.at(-1).userContent);
    expect(payload.text).toBe(headword);
    expect(harness.server.calls.at(-1).userContent).not.toContain("Original rich definition");
    await page.screenshot({ path: testInfo.outputPath(`rich-ai-${action}.png`) });
    await dictionary.click();
    await expect(richViewer).toBeVisible();
    await expect(richViewer).toContainText("Original rich definition");
    expect(await originalViewer.evaluate(node => node.isConnected)).toBe(true);
    await page.locator(`#tf-selection-tab-${action}`).click();
    await expect(pane.locator(".tf-selection-generated-body")).toHaveText("streamed answer");
    expect(harness.server.calls).toHaveLength(index + 1);
    await dictionary.click();
  }
  expect(harness.server.calls.map(call => JSON.parse(call.userContent).question)).toEqual([
    "这里是什么意思？", "拆解这里的表达。", "这里的用法是什么？"
  ]);
  await page.screenshot({ path: testInfo.outputPath("rich-dictionary-after-ai.png") });
  await richViewer.getByRole("button", { name: "Open related entry", exact: true }).click();
  await expect(richViewer).toContainText("Fresh rich definition");
  await page.locator(".tf-rich-navigation").getByRole("button", { name: /返回|Back/u }).click();
  await expect(richViewer).toContainText("Original rich definition");

  // Hold the real local lookup response while the user starts a real AI request.
  await page.locator("button.tf-selection-icon-button").first().click();
  await lookupGate(harness, page, "install");
  await select(page, headword);
  await expect.poll(() => lookupGate(harness, page, "read")).toBe(true);
  const countBeforeEarlyAi = harness.server.calls.length;
  await page.locator("#tf-selection-tab-understand").click();
  await expect.poll(() => harness.server.calls.length).toBe(countBeforeEarlyAi + 1);
  await lookupGate(harness, page, "release");
  await expect(page.locator("#tf-selection-panel-understand .tf-selection-ai-detail")).toHaveAttribute("data-state", "success");
  await dictionary.click();
  await expect(richViewer).toContainText("Original rich definition");
  await expect(page.locator(".tf-selection-status")).not.toContainText("已取消");
  await page.screenshot({ path: testInfo.outputPath("dictionary-after-early-ai.png") });

  // Keep a real Provider request pending while closing or selecting another word.
  for (const change of ["close", "selection"]) {
    await page.locator("button.tf-selection-icon-button").first().click();
    await select(page, headword);
    await expect(richViewer).toContainText("Original rich definition");
    harness.server.setDelay(1000);
    const count = harness.server.calls.length;
    await page.locator("#tf-selection-tab-understand").click();
    await expect.poll(() => harness.server.calls.length).toBe(count + 1);
    const pending = harness.server.calls.at(-1);
    expect(pending.responseState).toBe("pending");
    if (change === "close") {
      await page.locator("button.tf-selection-icon-button").first().click();
      await expect(page.locator(".tf-selection-panel")).toHaveCount(0);
    }
    await select(page, "freshaiterm");
    await expect(richViewer).toContainText("Fresh rich definition");
    await expect.poll(() => pending.responseState).not.toBe("pending");
    await expect(page.locator("#tf-selection-tab-dictionary")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".tf-selection-generated-body")).toHaveCount(0);
    await expect(richViewer).not.toContainText("Original rich definition");
    expect(harness.server.calls).toHaveLength(count + 1);
    harness.server.setDelay(0);
  }
  await page.screenshot({ path: testInfo.outputPath("fresh-selection-after-cancel.png") });
});

async function select(page, id) {
  await page.locator(`#${id}`).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
  await page.locator(".tf-selection-chip").click();
}

async function lookupGate(harness, page, command) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, command }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [command], func: command => {
      if (command === "install") {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime), gate = globalThis.__tfPendingRich = { used: false, release: null };
        chrome.runtime.sendMessage = (message, ...args) => {
          const index = args.findIndex(arg => typeof arg === "function");
          if (message?.type === "RICH_MDICT_LOOKUP" && !gate.used && index >= 0) {
            gate.used = true;
            const callback = args[index];
            args[index] = response => { gate.release = () => { gate.release = null; callback(response); }; };
          }
          return send(message, ...args);
        };
      }
      const gate = globalThis.__tfPendingRich;
      if (command === "release") gate.release();
      return Boolean(gate?.release);
    } });
    return result.result;
  }, { tabId, command });
}
