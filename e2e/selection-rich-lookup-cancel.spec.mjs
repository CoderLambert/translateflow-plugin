import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich-index.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

const evidenceDir = process.env.DICTIONARY_ECOSYSTEM_V2_EVIDENCE_DIR || "";
const baselinePath = evidenceDir
  ? resolve(evidenceDir, "rich-lookup-cancellation-baseline.json")
  : resolve("tests/fixtures/rich-lookup-cancellation-baseline.json");
const baselineEvidence = JSON.parse(await readFile(baselinePath, "utf8"));
const baselineP95Ms = percentile(baselineEvidence.rawSamplesMs, 0.95);
const baselineCeilingMs = Math.ceil(baselineP95Ms * 2);
if (
  baselineEvidence.status !== "PASS"
  || baselineEvidence.baselineMainSha !== "acbfa12a079a73d6eab0a1c17e7a8f63d856295b"
  || baselineEvidence.rawSamplesMs.length !== 30
) {
  throw new Error("Pinned Rich lookup cancellation baseline evidence is missing or invalid.");
}

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
      ["replaceword", "<p>STALE_SECRET_REPLACED_GLOSS</p>"],
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
      for (const [id, text] of [
        ["old-selection", "cancelword"],
        ["replace-selection", "replaceword"],
        ["fresh-selection", "freshword"]
      ]) {
        const node = document.createElement("p");
        node.id = id;
        node.textContent = text;
        document.body.appendChild(node);
      }
    });
    await injectWithLookupGate(harness, page);
    await installUnderlyingRangeStopGate(harness);

    const cancelledRequestIds = [];
    const routeCancellationSamplesMs = [];
    const routeCancellationSamples = [];
    const routeMethods = Array.from({ length: 10 }, (_, index) => index % 2 === 0 ? "pushState" : "replaceState");
    for (let sampleIndex = 0; sampleIndex < routeMethods.length; sampleIndex += 1) {
      const method = routeMethods[sampleIndex];
      const text = sampleIndex % 2 === 0 ? "cancelword" : "replaceword";
      const route = `/spa-${method}-${sampleIndex}`;
      const selectionId = text === "cancelword" ? "old-selection" : "replace-selection";
      const lookupCountBefore = (await readGate(harness, page)).trace.filter((item) => item.kind === "lookup").length;
      await armUnderlyingRangeStopGate(harness, `route-sample-${sampleIndex}`);
      await selectElementText(page, `#${selectionId}`);
      await expect(page.locator(".tf-selection-chip")).toBeVisible();
      await page.locator(".tf-selection-chip").click();
      const card = page.locator(".tf-selection-rich-record").filter({ hasText: "Cancellation Fixture" });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => (await readGate(harness, page)).trace.filter((item) => item.kind === "lookup").length, {
        timeout: 15_000
      }).toBeGreaterThan(lookupCountBefore);
      const lookupEvent = (await readGate(harness, page)).trace
        .filter((item) => item.kind === "lookup")
        .at(-1);
      expect(lookupEvent?.text).toBe(text);
      const requestId = lookupEvent?.requestId;
      expect(requestId).toMatch(/^selection-rich-lookup-[a-f0-9]{32}$/u);

      if (lookupEvent.delayed) await releaseDelayedLookup(harness, page, text);
      await expect.poll(async () => (await readUnderlyingRangeStopGate(harness)).active?.sampleId, {
        timeout: 15_000
      }).toBe(`route-sample-${sampleIndex}`);
      const activeRange = await readUnderlyingRangeStopGate(harness);
      expect(activeRange.active?.sampleId).toBe(`route-sample-${sampleIndex}`);
      const routeStartedAtEpochMs = await page.evaluate(({ method, route }) => {
        const startedAt = performance.timeOrigin + performance.now();
        history[method]({}, "", route);
        return startedAt;
      }, { method, route });
      await expect.poll(async () => {
        const gate = await readGate(harness, page);
        return gate.trace.some((item) => item.kind === "cancel" && item.requestId === requestId && item.cancelled);
      }, { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => {
        const rangeGate = await readUnderlyingRangeStopGate(harness);
        return rangeGate.samples.find((item) => item.sampleId === `route-sample-${sampleIndex}`)?.stoppedAtEpochMs || 0;
      }, { timeout: 10_000 }).toBeGreaterThan(0);
      const stopSample = (await readUnderlyingRangeStopGate(harness)).samples.find((item) =>
        item.sampleId === `route-sample-${sampleIndex}`
      );
      expect(activeRange.active.startedAtEpochMs).toBeLessThanOrEqual(routeStartedAtEpochMs);
      expect(stopSample.nativeCancelCompletedAtEpochMs).toBeGreaterThan(routeStartedAtEpochMs);
      expect(stopSample.nativeCancelCompletedAtEpochMs).toBeLessThanOrEqual(stopSample.stoppedAtEpochMs);
      const routeCancellationMs = stopSample.stoppedAtEpochMs - routeStartedAtEpochMs;
      expect(routeCancellationMs).toBeGreaterThanOrEqual(0);
      routeCancellationSamplesMs.push(routeCancellationMs);
      routeCancellationSamples.push({
        method,
        rangeReadStartedAtEpochMs: activeRange.active.startedAtEpochMs,
        routeStartEpochMs: routeStartedAtEpochMs,
        rangeStopEpochMs: stopSample.stoppedAtEpochMs,
        nativeCancelCompletedAtEpochMs: stopSample.nativeCancelCompletedAtEpochMs,
        endpoint: "opfs-readBlobRange-finally-after-native-cancel",
        rangeReadActiveAtRoute: true,
        durationMs: routeCancellationMs
      });
      const cancelEvent = (await readGate(harness, page)).trace.find((item) =>
        item.kind === "cancel" && item.requestId === requestId
      );
      expect(cancelEvent?.cancelled).toBe(true);
      cancelledRequestIds.push(requestId);
    }

    await selectElementText(page, "#fresh-selection");
    await expect(page.locator(".tf-selection-chip")).toBeVisible();

    await page.locator(".tf-selection-chip").click();
    const freshCard = page.locator(".tf-selection-rich-record").filter({ hasText: "Cancellation Fixture" });
    await expect(freshCard).toBeVisible({ timeout: 15_000 });
    const richViewer = freshCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(richViewer).toContainText("fresh lookup succeeded", { timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("STALE_SECRET_OLD_GLOSS");

    const gate = await readGate(harness, page);
    const lookups = gate.trace.filter((item) => item.kind === "lookup");
    const cancels = gate.trace.filter((item) => item.kind === "cancel" && cancelledRequestIds.includes(item.requestId));
    const freshLookup = lookups.find((item) => item.text === "freshword");
    expect(cancels.map((item) => item.requestId)).toEqual(cancelledRequestIds);
    expect(cancels.every((item) => item.cancelled)).toBe(true);
    expect(freshLookup?.requestId).toMatch(/^selection-rich-lookup-[a-f0-9]{32}$/u);
    expect(cancelledRequestIds).not.toContain(freshLookup.requestId);

    const rangeSamples = await measureCancellationSamples();
    const browserRequests = lookups.length;
    const report = {
      schemaVersion: 1,
      test: "Selection change cancels stale Rich lookups and preserves fresh results",
      spec: "e2e/selection-rich-lookup-cancel.spec.mjs",
      status: "PASS",
      requestCount: browserRequests,
      browserCancellationPhase: "same-document-history-during-active-range",
      spaNavigationMethods: ["pushState", "replaceState"],
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
        baselineP95Ms,
        baselineSampleCount: baselineEvidence.rawSamplesMs.length,
        baselineMainSha: baselineEvidence.baselineMainSha,
        baselineEvidenceFile: "rich-lookup-cancellation-baseline.json",
        baselineLookupBlob: baselineEvidence.baselineLookupBlob,
        baselineRunnerSha256: baselineEvidence.runnerSha256,
        baselineWorkload: baselineEvidence.workload,
        derivedCeilingMs: baselineCeilingMs,
        ceilingPassed: percentile(rangeSamples.samples, 0.95) <= baselineCeilingMs
      },
      routeCancellationLatency: {
        trigger: "same-document-history",
        endpoint: "underlying-range-stop",
        clock: "performance.now",
        metric: "milliseconds from route change to final active underlying range read stop",
        baselineInterpretation: "conservative-stop-latency-ceiling",
        baselineMetric: baselineEvidence.metric,
        unit: "ms",
        sampleCount: routeCancellationSamplesMs.length,
        samplesMs: routeCancellationSamplesMs,
        samples: routeCancellationSamples,
        methodSampleCounts: {
          pushState: routeCancellationSamples.filter((sample) => sample.method === "pushState").length,
          replaceState: routeCancellationSamples.filter((sample) => sample.method === "replaceState").length
        },
        p50Ms: percentile(routeCancellationSamplesMs, 0.5),
        p95Ms: percentile(routeCancellationSamplesMs, 0.95),
        maxMs: Math.max(...routeCancellationSamplesMs),
        baselineP95Ms,
        derivedCeilingMs: baselineCeilingMs,
        ceilingPassed: percentile(routeCancellationSamplesMs, 0.95) <= baselineCeilingMs
      }
    };
    expect(report.requestCount).toBeGreaterThanOrEqual(2);
    expect(report.cancelledLookupCount).toBeGreaterThanOrEqual(2);
    expect(report.lateStaleResultsRendered).toBe(0);
    expect(report.freshResultsRendered).toBe(1);
    expect(report.providerCalls).toBe(0);
    expect(report.externalRequests).toBe(0);
    expect(report.maxConcurrentLookups).toBeLessThanOrEqual(3);
    expect(report.postCancelRangeReads).toBe(0);
    expect(report.postCancelBlockDecodes).toBe(0);
    expect(rangeSamples.samples.length).toBeGreaterThanOrEqual(10);
    expect(report.cancellationLatency.ceilingPassed).toBe(true);
    expect(routeCancellationSamplesMs).toHaveLength(10);
    expect(routeCancellationSamples.filter((sample) => sample.method === "pushState")).toHaveLength(5);
    expect(routeCancellationSamples.filter((sample) => sample.method === "replaceState")).toHaveLength(5);
    expect(routeCancellationSamples.every((sample) => sample.rangeReadActiveAtRoute && sample.rangeStopEpochMs >= sample.routeStartEpochMs)).toBe(true);
    expect(report.routeCancellationLatency.ceilingPassed).toBe(true);

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
          delayedTexts: [],
          maxConcurrency: 0,
          active: 0,
          releases: Object.create(null)
        };
        runtime.sendRuntimeMessage = (message) => {
          if (message.type === runtime.messages.background.RICH_MDICT_LOOKUP_CANCEL) {
            const event = {
              kind: "cancel",
              requestId: message.requestId,
              observedAtEpochMs: Date.now(),
              cancelled: false
            };
            gate.trace.push(event);
            return original(message).then((response) => {
              event.cancelled = response?.ok === true && response?.cancelled === true;
              return response;
            });
          }
          if (message.type !== runtime.messages.background.RICH_MDICT_LOOKUP) return original(message);
          const lookupEvent = { kind: "lookup", requestId: message.requestId, text: String(message.text || ""), delayed: false };
          gate.trace.push(lookupEvent);
          if (["cancelword", "replaceword"].includes(message.text) && !gate.delayedTexts.includes(message.text)) {
            gate.delayedTexts.push(message.text);
            lookupEvent.delayed = true;
            return new Promise((resolve, reject) => {
              gate.releases[message.text] = () => {
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
        trace: gate.trace.map(({ kind, requestId, text, cancelled, observedAtEpochMs, delayed }) => ({
          kind,
          requestId,
          text,
          cancelled,
          observedAtEpochMs,
          delayed
        })),
        delayedTexts: [...gate.delayedTexts],
        maxConcurrency: gate.maxConcurrency
      } : null;
    }
  }), { tabId });
  return result?.result;
}

async function installUnderlyingRangeStopGate(harness) {
  await harness.serviceWorker.evaluate(() => {
    if (globalThis.__TF_E2E_RANGE_STOP_GATE__?.installed) return;
    const originalStream = Blob.prototype.stream;
    const state = {
      installed: true,
      armedSampleId: "",
      active: null,
      samples: []
    };
    Blob.prototype.stream = function (...args) {
      const stream = originalStream.apply(this, args);
      if (!state.armedSampleId) return stream;
      const sampleId = state.armedSampleId;
      state.armedSampleId = "";
      const nativeReader = stream.getReader();
      let holdFirstChunk = true;
      let releaseHeldRead = null;
      return {
        getReader() {
          return {
            read() {
              const read = nativeReader.read();
              if (!holdFirstChunk) return read;
              holdFirstChunk = false;
              return read.then((result) => {
                if (result.done) return result;
                state.active = {
                  sampleId,
                  startedAtEpochMs: performance.timeOrigin + performance.now(),
                  stoppedAtEpochMs: 0
                };
                return new Promise((resolve) => { releaseHeldRead = resolve; }).then(() => result);
              });
            },
            async cancel(reason) {
              const result = await nativeReader.cancel(reason);
              const nativeCancelCompletedAtEpochMs = performance.timeOrigin + performance.now();
              if (state.active?.sampleId === sampleId) state.active.nativeCancelCompletedAtEpochMs = nativeCancelCompletedAtEpochMs;
              releaseHeldRead?.({ done: true, value: undefined });
              releaseHeldRead = null;
              return result;
            },
            releaseLock() {
              nativeReader.releaseLock();
              if (state.active?.sampleId === sampleId) {
                const stoppedAtEpochMs = performance.timeOrigin + performance.now();
                state.samples.push({
                  sampleId,
                  nativeCancelCompletedAtEpochMs: state.active.nativeCancelCompletedAtEpochMs || 0,
                  stoppedAtEpochMs
                });
                state.active.stoppedAtEpochMs = stoppedAtEpochMs;
                state.active = null;
              }
            }
          };
        }
      };
    };
    globalThis.__TF_E2E_RANGE_STOP_GATE__ = state;
  });
}

async function armUnderlyingRangeStopGate(harness, sampleId) {
  await harness.serviceWorker.evaluate((sampleId) => {
    const gate = globalThis.__TF_E2E_RANGE_STOP_GATE__;
    if (!gate?.installed || gate.active || gate.armedSampleId) throw new Error("Range-stop gate is not idle.");
    gate.armedSampleId = sampleId;
  }, sampleId);
}

async function readUnderlyingRangeStopGate(harness) {
  return harness.serviceWorker.evaluate(() => {
    const gate = globalThis.__TF_E2E_RANGE_STOP_GATE__;
    return gate ? {
      active: gate.active ? { ...gate.active } : null,
      samples: gate.samples.map((sample) => ({ ...sample }))
    } : { active: null, samples: [] };
  });
}

async function releaseDelayedLookup(harness, page, text) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(({ tabId, text }) => chrome.scripting.executeScript({
    target: { tabId },
    func: ({ text }) => globalThis.__TF_RICH_LOOKUP_GATE__?.releases?.[text]?.(),
    args: [{ text }]
  }), { tabId, text });
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
