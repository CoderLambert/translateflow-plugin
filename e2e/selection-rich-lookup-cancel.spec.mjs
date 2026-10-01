import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich-index.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

const evidenceDir = process.env.DICTIONARY_ECOSYSTEM_V2_EVIDENCE_DIR || "";
const baseline = Object.freeze({
  mainSha: "acbfa12a079a73d6eab0a1c17e7a8f63d856295b",
  samples: 30,
  medianMs: 23.175,
  p95Ms: 23.326,
  derivedCeilingMs: Math.ceil(23.326 * 2)
});

test.describe("Selection change cancels stale Rich lookups and preserves fresh results", () => {
  test.setTimeout(180_000);

  test("cancels the prior local request and renders only the fresh selection", async ({ harness }) => {
    await harness.reset();
    const externalRequests = new Set();
    const observeExternalRequest = (request) => {
      const url = request.url();
      if (/^https?:/iu.test(url) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/iu.test(url)) {
        externalRequests.add(url);
      }
    };
    harness.context.on("request", observeExternalRequest);
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const fixture = makeRichMdx([
      ["cancelword", "<p>STALE_SECRET_OLD_GLOSS</p>"],
      ["freshword", "<p>fresh lookup succeeded</p>"]
    ], { title: "Cancellation Fixture" });
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "selection-cancellation-fixture.mdx",
      mimeType: "application/octet-stream",
      buffer: fixture
    });
    await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Cancellation Fixture");
    await options.locator("#localDictionaryImportButton").click();
    await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });

    const page = await harness.open("/selection-rich-lookup-cancel");
    await page.evaluate(() => {
      for (const [id, text] of [["old-selection", "cancelword"], ["fresh-selection", "freshword"]]) {
        const node = document.createElement("p");
        node.id = id;
        node.textContent = text;
        document.body.appendChild(node);
      }
    });
    await injectWithLookupGate(harness, page);

    await selectElementText(page, "#old-selection");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    const oldCard = page.locator(".tf-selection-rich-record").filter({ hasText: "Cancellation Fixture" });
    await expect(oldCard).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => readGate(harness, page), { timeout: 15_000 }).toMatchObject({ delayedOldLookup: true });
    const oldRequestId = (await readGate(harness, page)).trace.find((item) => item.kind === "lookup")?.requestId;
    expect(oldRequestId).toMatch(/^selection-rich-lookup-[a-f0-9]{32}$/u);

    await selectElementText(page, "#fresh-selection");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await expect.poll(async () => {
      const gate = await readGate(harness, page);
      return gate.trace.some((item) => item.kind === "cancel" && item.requestId === oldRequestId && item.cancelled);
    }, { timeout: 10_000 }).toBe(true);
    await releaseDelayedLookup(harness, page);

    await page.locator(".tf-selection-chip").click();
    const freshCard = page.locator(".tf-selection-rich-record").filter({ hasText: "Cancellation Fixture" });
    await expect(freshCard).toBeVisible({ timeout: 15_000 });
    const richViewer = freshCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(richViewer).toContainText("fresh lookup succeeded", { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("STALE_SECRET_OLD_GLOSS");

    const gate = await readGate(harness, page);
    const lookups = gate.trace.filter((item) => item.kind === "lookup");
    const cancel = gate.trace.find((item) => item.kind === "cancel" && item.requestId === oldRequestId);
    const freshLookup = lookups.find((item) => item.text === "freshword");
    expect(cancel?.requestId).toBe(oldRequestId);
    expect(cancel?.cancelled).toBe(true);
    expect(freshLookup?.requestId).toMatch(/^selection-rich-lookup-[a-f0-9]{32}$/u);
    expect(freshLookup.requestId).not.toBe(oldRequestId);

    const rangeSamples = await measureCancellationSamples();
    const browserRequests = lookups.length;
    const report = {
      schemaVersion: 1,
      test: "Selection change cancels stale Rich lookups and preserves fresh results",
      spec: "e2e/selection-rich-lookup-cancel.spec.mjs",
      status: "PASS",
      requestCount: browserRequests,
      browserCancellationPhase: "before-dispatch",
      cancelledLookupCount: gate.trace.filter((item) => item.kind === "cancel" && item.cancelled === true).length,
      lateStaleResultsRendered: (await page.locator("body").textContent()).includes("STALE_SECRET_OLD_GLOSS") ? 1 : 0,
      freshResultsRendered: (await richViewer.textContent()).includes("fresh lookup succeeded") ? 1 : 0,
      providerCalls: harness.server.calls.length,
      externalRequests: externalRequests.size,
      maxConcurrentLookups: gate.maxConcurrency,
      postCancelRangeReads: rangeSamples.postCancelRangeReads,
      postCancelBlockDecodes: rangeSamples.postCancelDecodeStarts,
      activeRangeCancellationSamples: rangeSamples.samples.length,
      cancellationLatency: {
        unit: "ms",
        sampleCount: rangeSamples.samples.length,
        p50Ms: percentile(rangeSamples.samples, 0.5),
        p95Ms: percentile(rangeSamples.samples, 0.95),
        maxMs: Math.max(...rangeSamples.samples),
        baselineP95Ms: baseline.p95Ms,
        baselineSampleCount: baseline.samples,
        baselineMainSha: baseline.mainSha,
        baselineWorkload: "uncancelled synthetic bounded source-range gate",
        derivedCeilingMs: baseline.derivedCeilingMs,
        ceilingPassed: percentile(rangeSamples.samples, 0.95) <= baseline.derivedCeilingMs
      }
    };
    expect(report.requestCount).toBeGreaterThanOrEqual(2);
    expect(report.cancelledLookupCount).toBeGreaterThanOrEqual(1);
    expect(report.lateStaleResultsRendered).toBe(0);
    expect(report.freshResultsRendered).toBe(1);
    expect(report.providerCalls).toBe(0);
    expect(report.externalRequests).toBe(0);
    expect(report.maxConcurrentLookups).toBeLessThanOrEqual(3);
    expect(report.postCancelRangeReads).toBe(0);
    expect(report.postCancelBlockDecodes).toBe(0);
    expect(rangeSamples.samples.length).toBeGreaterThanOrEqual(10);
    expect(report.cancellationLatency.ceilingPassed).toBe(true);

    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(resolve(evidenceDir, "rich-lookup-cancellation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    }
    harness.context.off("request", observeExternalRequest);
  });
});

async function injectWithLookupGate(harness, page) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, scripts, styles }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/runtime.js"] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const runtime = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.runtime;
        const original = runtime.sendRuntimeMessage.bind(runtime);
        const gate = {
          trace: [],
          delayedOldLookup: false,
          maxConcurrency: 0,
          active: 0,
          release: null
        };
        runtime.sendRuntimeMessage = (message) => {
          if (message.type === runtime.messages.background.RICH_MDICT_LOOKUP_CANCEL) {
            const event = { kind: "cancel", requestId: message.requestId, cancelled: false };
            gate.trace.push(event);
            return original(message).then((response) => {
              event.cancelled = response?.ok === true && response?.cancelled === true;
              return response;
            });
          }
          if (message.type !== runtime.messages.background.RICH_MDICT_LOOKUP) return original(message);
          gate.trace.push({ kind: "lookup", requestId: message.requestId, text: String(message.text || "") });
          if (message.text === "cancelword" && !gate.delayedOldLookup) {
            gate.delayedOldLookup = true;
            return new Promise((resolve, reject) => {
              gate.release = () => {
                gate.active += 1;
                gate.maxConcurrency = Math.max(gate.maxConcurrency, gate.active);
                original(message).then(resolve, reject).finally(() => { gate.active -= 1; });
              };
            });
          }
          gate.active += 1;
          gate.maxConcurrency = Math.max(gate.maxConcurrency, gate.active);
          return original(message).finally(() => { gate.active -= 1; });
        };
        globalThis.__TF_RICH_LOOKUP_GATE__ = gate;
      }
    });
    await chrome.scripting.insertCSS({ target: { tabId }, files: styles });
    await chrome.scripting.executeScript({ target: { tabId }, files: scripts.slice(1) });
  }, { tabId, scripts: CONTENT_SCRIPT_FILES, styles: CONTENT_STYLE_FILES });
}

async function readGate(harness, page) {
  const tabId = await harness.tabId(page);
  const [result] = await harness.driver.evaluate(({ tabId }) => chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const gate = globalThis.__TF_RICH_LOOKUP_GATE__;
      return gate ? {
        trace: gate.trace.map(({ kind, requestId, text, cancelled }) => ({ kind, requestId, text, cancelled })),
        delayedOldLookup: gate.delayedOldLookup,
        maxConcurrency: gate.maxConcurrency
      } : null;
    }
  }), { tabId });
  return result?.result;
}

async function releaseDelayedLookup(harness, page) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(({ tabId }) => chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.__TF_RICH_LOOKUP_GATE__?.release?.()
  }), { tabId });
}

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });
}

async function measureCancellationSamples() {
  const bytes = makeRichMdx([["latency-fixture", "<p>synthetic bounded record</p>"]]);
  const baseSource = byteSource(bytes);
  const index = await buildRichMdictIndex({ source: baseSource });
  const keyBlockOffset = index.keyBlocks[0].dataOffset;
  const samples = [];
  let postCancelRangeReads = 0;
  let postCancelDecodeStarts = 0;
  for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
    const controller = new AbortController();
    const rangeStarted = deferred();
    let rangeStopAt = 0;
    const source = {
      size: bytes.byteLength,
      async read(offset, length, signal) {
        if (signal?.aborted) {
          postCancelRangeReads += 1;
          throw abortError();
        }
        if (offset === keyBlockOffset) {
          rangeStarted.resolve();
          return new Promise((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              rangeStopAt = performance.now();
              reject(abortError());
            }, { once: true });
          });
        }
        return baseSource.read(offset, length, signal);
      }
    };
    const lookup = lookupRichMdict({
      source,
      index,
      text: "latency-fixture",
      signal: controller.signal,
      decompressionStreamFactory: () => {
        if (controller.signal.aborted) postCancelDecodeStarts += 1;
        return new DecompressionStream("deflate");
      }
    });
    await rangeStarted.promise;
    const cancelAt = performance.now();
    controller.abort();
    await lookup.catch((error) => {
      if (error?.name !== "AbortError") throw error;
    });
    samples.push(Math.max(0, rangeStopAt - cancelAt));
  }
  return { samples, postCancelRangeReads, postCancelDecodeStarts };
}

function byteSource(bytes) {
  return { size: bytes.byteLength, async read(offset, length) { return bytes.subarray(offset, offset + length); } };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function abortError() {
  return new DOMException("synthetic cancellation", "AbortError");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}
