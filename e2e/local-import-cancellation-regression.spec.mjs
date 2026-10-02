import { webcrypto } from "node:crypto";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { readMddInteropFixture } from "../tests/helpers/mdd-fixture.mjs";
import { buildLocalIndexedTflex } from "../src/background/packs/importers/tflex-local-builder.js";

test.describe("local import cancellation regressions", () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ harness }) => { await harness.reset(); });

  for (const family of ["rich", "packs"]) {
    test(`${family} installed refresh blocks pending/failed imports and rejects stale completion`, async ({ harness }) => {
      const options = await harness.context.newPage();
      await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
      const files = family === "rich" ? [{ name: "refresh.mdx", mimeType: "application/octet-stream",
        buffer: makeRichMdx([["refreshfixture", "synthetic summary"]], { title: "Refresh fixture", styleSheet: "" }) }]
        : Object.entries((await buildLocalIndexedTflex({ packId: "local-refresh-fixture", packVersion: "v1",
          records: [{ lookupKey: "refreshfixture", exactLookupKeys: ["refreshfixture"], displayForm: "refreshfixture", kind: "lexical", aliases: [],
            senses: [{ id: "fixture:1", translations: ["合成"], domains: [], sourceRefs: [{ sourceId: "fixture", recordId: "1" }] }] }],
          sources: [{ id: "fixture", version: "v1", provenance: "Synthetic regression fixture" }], sourceEntryCount: 1, cryptoProvider: webcrypto })).files)
          .map(([name, bytes]) => ({ name, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) }));
      await options.locator("#localDictionaryFiles").setInputFiles(files);
      if (family === "packs") await options.locator("#localDictionaryLimitationsConfirmation").check();
      const button = options.locator("#localDictionaryImportButton");
      await expect(button).toBeEnabled();
      await options.evaluate(() => {
        const original = chrome.runtime.sendMessage;
        const state = { generation: 0, requests: [], original };
        globalThis.__tfInstalledRefreshProbe = state;
        chrome.runtime.sendMessage = function (message, ...args) {
          if (!["RICH_MDICT_LIST", "DICTIONARY_PACK_STATUS"].includes(message?.type)) return original.call(this, message, ...args);
          return new Promise((resolve) => state.requests.push({ generation: state.generation, type: message.type, resolve }));
        };
      });
      try {
        await refresh(options, 1);
        await expect(button).toBeDisabled();
        await settleRefresh(options, 1, family);
        await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("安装已暂停");
        await expect(button).toBeDisabled();
        await refresh(options, 2);
        await expect(button).toBeDisabled();
        await refresh(options, 3);
        await settleRefresh(options, 3);
        await expect(button).toBeEnabled();
        await settleRefresh(options, 2, family);
        await expect(button).toBeEnabled();
        await expect(options.locator("#localDictionaryPreflightSummary")).not.toContainText("安装已暂停");
      } finally {
        await options.evaluate(() => { chrome.runtime.sendMessage = globalThis.__tfInstalledRefreshProbe.original; });
      }
      expect(harness.server.calls).toHaveLength(0);
    });
  }

  test("closing a real resource session cancels the running OPFS range before another read/decode and leaves the queue usable", async ({ harness }) => {
    const { mdd } = await readMddInteropFixture();
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await options.locator("#localDictionaryFiles").setInputFiles({ name: "interop.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["cancelmddfixture", '<p>Actual OPFS cancellation fixture.</p><img src="interop/sample.png" alt="Synthetic image">']],
        { title: "Cancellation fixture", styleSheet: "" }) });
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
    const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Cancellation fixture" });
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    await row.getByRole("button", { name: /添加或替换 MDD 附件/u }).click();
    await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: "interop.mdd", mimeType: "application/octet-stream", buffer: mdd });
    await expect(options.locator("#status")).toContainText("本地资源已更新", { timeout: 60_000 });
    const page = await harness.open("/selection");
    await page.evaluate(() => { const p = document.createElement("p"); p.id = "cancel-mdd-word"; p.textContent = "cancelmddfixture"; document.body.appendChild(p); });
    const tabId = await harness.inject(page);
    await installContentProbe(harness, tabId);
    await installRangeGate(harness.serviceWorker);
    try {
      await query(page);
      const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
      await expect(card).toBeVisible();
      if (!await card.evaluate((node) => node.open)) await card.locator("summary").click();
      await expect.poll(() => readRangeProbe(harness.serviceWorker).then((state) => state.entered)).toBe(true);
      const before = await readRangeProbe(harness.serviceWorker);
      expect(before.rangeReads).toBe(1);
      const panel = page.locator(".tf-selection-panel");
      await panel.getByRole("button", { name: "关闭" }).click();
      await expect(panel).toBeHidden();
      await expect.poll(() => readRangeProbe(harness.serviceWorker).then((state) => state.cancelCalls)).toBe(1);
      await expect.poll(async () => (await readContentProbe(harness, tabId)).responses.some((response) =>
        response.type === "RICH_MDD_RESOURCE_READ_CANCEL" && response.ok === true && response.cancelled === true)).toBe(true);
      // Attempt a late delivery after real reader.cancel; the gate cannot deliver bytes anymore.
      await harness.serviceWorker.evaluate(() => globalThis.__tfMddRangeProbe.release());
      const after = await readRangeProbe(harness.serviceWorker);
      expect(after.rangeReads).toBe(before.rangeReads);
      expect(after.decodes).toBe(before.decodes);
      expect(after.lateReleaseIgnored).toBe(true);
      await expect.poll(async () => (await readContentProbe(harness, tabId)).responses.some((response) =>
        response.type === "RICH_MDD_RESOURCE" && response.ok === false && response.errorCode === 20 && /cancelled/u.test(response.errorMessage))).toBe(true);
      expect((await readContentProbe(harness, tabId)).objectUrls).toBe(0);
      await expect(page.locator("img.tf-rich-resource-image[src^='blob:']")).toHaveCount(0);
      await restoreRangeGate(harness.serviceWorker);
      await query(page);
      const reopened = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
      await expect(reopened).toBeVisible();
      if (!await reopened.evaluate((node) => node.open)) await reopened.locator("summary").click();
      const image = reopened.locator("img.tf-rich-resource-image[src^='blob:']");
      await expect(image).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => image.evaluate((node) => node.naturalWidth)).toBe(2);
      const probe = await readContentProbe(harness, tabId);
      expect(probe.responses.some((response) => response.type === "RICH_MDD_RESOURCE" && response.ok === true && response.found === true && response.mime === "image/png")).toBe(true);
      expect(probe.objectUrls).toBe(1);
      expect(harness.server.calls).toHaveLength(0);
      console.log("[MDD_CANCELLATION_E2E]", JSON.stringify({ rangeReadsAtGate: before.rangeReads, rangesAfterCancel: after.rangeReads,
        decodesAtGate: before.decodes, decodesAfterCancel: after.decodes, readerCancelCalls: after.cancelCalls,
        noLateObjectUrl: true, queueRecovered: true, restoredImageWidth: 2, providerCalls: 0 }));
    } finally {
      await restoreRangeGate(harness.serviceWorker);
      await harness.driver.evaluate(async (tabId) => { await chrome.scripting.executeScript({ target: { tabId }, func: () => {
        const probe = globalThis.__tfMddContentProbe;
        if (probe) { chrome.runtime.sendMessage = probe.originalSend; URL.createObjectURL = probe.originalUrl; }
      } }); }, tabId);
    }
  });
});

async function refresh(options, generation) {
  await options.evaluate((generation) => { globalThis.__tfInstalledRefreshProbe.generation = generation;
    document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed")); }, generation);
}
async function settleRefresh(options, generation, failedFamily = "") {
  await options.evaluate(async ({ generation, failedFamily }) => {
    for (const request of globalThis.__tfInstalledRefreshProbe.requests.filter((item) => item.generation === generation)) {
      const family = request.type === "RICH_MDICT_LIST" ? "rich" : "packs";
      request.resolve(family === failedFamily ? { ok: false, error: "Synthetic installed-state read failure" }
        : family === "rich" ? { ok: true, dictionaries: [] } : { ok: true, state: { packs: {} } });
    }
    await Promise.resolve(); await Promise.resolve();
  }, { generation, failedFamily });
}
async function query(page) {
  await page.locator("#cancel-mdd-word").evaluate((node) => { const selection = getSelection(), range = document.createRange();
    range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range);
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window })); });
  await page.locator(".tf-selection-chip").click();
}
async function installContentProbe(harness, tabId) {
  await harness.driver.evaluate(async (tabId) => { await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const probe = { responses: [], objectUrls: 0, originalSend: chrome.runtime.sendMessage, originalUrl: URL.createObjectURL };
    globalThis.__tfMddContentProbe = probe;
    URL.createObjectURL = function (...args) { probe.objectUrls++; return probe.originalUrl.apply(this, args); };
    chrome.runtime.sendMessage = function (message, ...args) {
      if (["RICH_MDD_RESOURCE", "RICH_MDD_RESOURCE_READ_CANCEL"].includes(message?.type)) {
        const callbackIndex = args.findIndex((arg) => typeof arg === "function");
        if (callbackIndex >= 0) { const callback = args[callbackIndex]; args[callbackIndex] = (response) => {
          probe.responses.push({ type: message.type, ok: response?.ok, found: response?.found, mime: response?.mime,
            errorCode: response?.errorCode, errorMessage: String(response?.error || ""), cancelled: response?.cancelled }); callback(response);
        }; }
      }
      return probe.originalSend.call(this, message, ...args);
    };
  } }); }, tabId);
}
async function readContentProbe(harness, tabId) {
  return harness.driver.evaluate(async (tabId) => { const [result] = await chrome.scripting.executeScript({ target: { tabId },
    func: () => ({ responses: globalThis.__tfMddContentProbe.responses, objectUrls: globalThis.__tfMddContentProbe.objectUrls }) }); return result.result; }, tabId);
}
async function installRangeGate(worker) {
  await worker.evaluate(() => {
    const ranges = new WeakSet();
    const probe = { rangeReads: 0, decodes: 0, cancelCalls: 0, entered: false, armed: true, cancelled: false,
      lateReleaseIgnored: false, originalSlice: File.prototype.slice, originalStream: Blob.prototype.stream,
      originalDecode: globalThis.DecompressionStream };
    globalThis.__tfMddRangeProbe = probe;
    File.prototype.slice = function (...args) { const blob = probe.originalSlice.apply(this, args);
      if (this.name.endsWith(".mdd")) { probe.rangeReads++; ranges.add(blob); } return blob; };
    Blob.prototype.stream = function (...args) {
      if (!ranges.has(this) || !probe.armed) return probe.originalStream.apply(this, args);
      probe.armed = false;
      const blob = this; let pullDone;
      return new ReadableStream({ pull(controller) { return new Promise((resolve) => {
        pullDone = resolve; probe.entered = true; probe.release = async () => {
          if (probe.cancelled) { probe.lateReleaseIgnored = true; resolve(); return; }
          controller.enqueue(new Uint8Array(await blob.arrayBuffer())); controller.close(); resolve();
        };
      }); }, cancel() { probe.cancelled = true; probe.cancelCalls++; pullDone?.(); } });
    };
    globalThis.DecompressionStream = new Proxy(probe.originalDecode, { construct(target, args) {
      probe.decodes++; return Reflect.construct(target, args); } });
  });
}
async function readRangeProbe(worker) {
  return worker.evaluate(() => { const p = globalThis.__tfMddRangeProbe; return { rangeReads: p.rangeReads, decodes: p.decodes,
    cancelCalls: p.cancelCalls, entered: p.entered, lateReleaseIgnored: p.lateReleaseIgnored }; });
}
async function restoreRangeGate(worker) {
  await worker.evaluate(() => { const p = globalThis.__tfMddRangeProbe; if (!p) return;
    File.prototype.slice = p.originalSlice; Blob.prototype.stream = p.originalStream; globalThis.DecompressionStream = p.originalDecode; });
}
