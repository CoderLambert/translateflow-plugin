import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

async function readPageSurface(page) {
  return page.evaluate(() => {
    const values = [...(globalThis.__tfObservedMessages || []), ...(globalThis.__tfObservedEventDetails || [])];
    function visit(root) {
      for (const node of root.childNodes || []) {
        if (node.nodeType === Node.TEXT_NODE) values.push(node.nodeValue || "");
        if (node.nodeType === Node.ELEMENT_NODE) {
          for (const attribute of node.attributes) values.push(`${attribute.name}=${attribute.value}`);
          for (const key of ["title", "ariaLabel"]) if (node[key]) values.push(`${key}=${node[key]}`);
          if (node.shadowRoot) visit(node.shadowRoot);
        }
        visit(node);
      }
    }
    visit(document);
    return values;
  });
}

async function markerIsolated(driver, url, action, method) {
  return driver.evaluate(async ({ url, action, method }) => {
    const tabId = (await chrome.tabs.query({})).filter(tab => tab.url === url).at(-1)?.id;
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [action, method],
      func: (name, summaryMethod) => {
        if (name === "install") {
          const textNode = document.querySelector("#source").firstChild;
          globalThis.__heldMarkerTextNode = textNode;
          globalThis.__staleMarkerScrolls = 0;
          textNode.parentElement.scrollIntoView = () => { globalThis.__staleMarkerScrolls++; };
          const runtime = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.runtime;
          globalThis.__originalMarkerSendRuntimeMessage = runtime.sendRuntimeMessage;
          let release;
          const gate = new Promise(resolve => { release = resolve; });
          globalThis.__markerRefreshGate = { started: false, release: () => release() };
          runtime.sendRuntimeMessage = async request => {
            if (!globalThis.__markerRefreshGate.started && request.method === summaryMethod) {
              globalThis.__markerRefreshGate.started = true;
              await gate;
            }
            return globalThis.__originalMarkerSendRuntimeMessage(request);
          };
          void globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingPageMarkers.refresh();
          return true;
        }
        if (name === "started") return globalThis.__markerRefreshGate?.started;
        if (name === "mutate") {
          globalThis.__heldMarkerTextNode.nodeValue = "PUBLIC refreshed alpha tail";
          return globalThis.__heldMarkerTextNode.isConnected;
        }
        if (name === "scrolls") return globalThis.__staleMarkerScrolls;
        if (name === "release") { globalThis.__markerRefreshGate.release(); return true; }
        if (name === "restore") {
          globalThis.__TRANSLATE_FLOW_CONTENT__.modules.runtime.sendRuntimeMessage = globalThis.__originalMarkerSendRuntimeMessage;
          return true;
        }
      } });
    return injection.result;
  }, { url, action, method });
}

async function sharedResolverIsolated(driver, url, action) {
  return driver.evaluate(async ({ url, action }) => {
    const tabId = (await chrome.tabs.query({})).filter(tab => tab.url === url).at(-1)?.id;
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [action],
      func: async name => {
        const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
        if (name === "prepare") {
          app.modules.readingPageMarkers.cleanup();
          await Promise.resolve();
          window.dispatchEvent(new Event("resize"));
          await Promise.resolve();
          const resolver = app.modules.readingAnchorResolver, projection = app.modules.textProjection;
          const originalResolve = resolver.resolve.bind(resolver), originalResolvePage = resolver.resolvePage.bind(resolver);
          const originalCreateScanner = projection.createScanner.bind(projection);
          const evidence = { singleStarted: 0, pageStarted: 0, singleActive: 0, pageActive: 0, scannerCreations: 0, slices: 0 };
          app.modules.readingAnchorResolver = {
            ...resolver,
            resolve: async (...args) => { evidence.singleStarted++; evidence.singleActive++; try { return await originalResolve(...args); } finally { evidence.singleActive--; } },
            resolvePage: async (...args) => { evidence.pageStarted++; evidence.pageActive++; try { return await originalResolvePage(...args); } finally { evidence.pageActive--; } }
          };
          projection.createScanner = (...args) => {
            evidence.scannerCreations++; const scanner = originalCreateScanner(...args), scan = scanner.scanSlice.bind(scanner);
            scanner.scanSlice = options => { evidence.slices++; return scan({ ...options, maxChars: Math.min(options?.maxChars ?? 6000, 6000), maxNodes: Math.min(options?.maxNodes ?? 300, 300), maxMs: Math.min(options?.maxMs ?? 8, 8) }); };
            return scanner;
          };
          globalThis.__tfSharedResolverEvidence = evidence;
          return true;
        }
        if (name === "start-markers") { void app.modules.readingPageMarkers.refresh(); return true; }
        if (name === "cancel-markers") { app.modules.readingPageMarkers.cleanup(); return true; }
        if (name === "evidence") return { ...globalThis.__tfSharedResolverEvidence };
      } });
    return injection.result;
  }, { url, action });
}

test("authorized revisit renders bounded page history markers and recovers across DOM and SPA changes without Provider work", async ({}, info) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-reading-markers-")), extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer(), articleUrl = `${server.baseUrl}/marker-page`; let context;
  const longPrefix = Array.from({ length: 90 }, (_, index) => `<p>section ${index} ${"filler ".repeat(90)}</p>`).join("");
  server.setPage("/marker-page", `<!doctype html><main>${longPrefix}<p id="source">PUBLIC session alpha tail</p></main>`);
  try {
    const buildReport = await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
    const driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en", autoSites: [], cacheRestoreSites: [], quickControlSites: [], quickControlHiddenSites: [], readingMemorySites: [] }));
    const center = await context.newPage(); await center.goto(`chrome-extension://${id}/learning-center.html`);
    await center.getByRole("button", { name: "Enable recording", exact: true }).click();
    const source = await context.newPage(); await source.goto(articleUrl);
    await source.evaluate(() => { document.querySelector("#source").scrollIntoView({ block: "center" });
      const node = document.querySelector("#source").firstChild, start = node.nodeValue.indexOf("session"), range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + 7); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
    await source.locator(".tf-selection-chip").click(); await expect(source.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
    await center.reload();
    const recordRow = center.locator(".record-list .record").first(), recordId = await recordRow.getAttribute("data-record-id");
    await recordRow.click();
    const detail = await center.evaluate(({ method, recordId }) => chrome.runtime.sendMessage({ protocolVersion: 2, method, recordId }),
      { method: M.GET_RECORD, recordId });
    await center.getByRole("button", { name: "Enable site markers", exact: true }).click();
    await expect(center.getByRole("button", { name: "Disable site markers", exact: true })).toHaveAttribute("aria-pressed", "true");
    await source.close();

    const revisit = await context.newPage();
    await revisit.addInitScript(() => {
      globalThis.__tfObservedMessages = []; globalThis.__tfObservedEventDetails = [];
      addEventListener("message", event => { try { __tfObservedMessages.push(JSON.stringify(event.data)); } catch {} });
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function(event) {
        if (event && "detail" in event) { try { __tfObservedEventDetails.push(JSON.stringify(event.detail)); } catch {} }
        return dispatch.call(this, event);
      };
    });
    await revisit.goto(articleUrl);
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
    await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(1);
    await expect(revisit.locator(".tf-reading-page-marker")).toBeHidden();
    await revisit.locator(".tf-reading-page-toggle").click();
    await expect(revisit.locator(".tf-reading-page-panel")).toBeVisible();
    await expect(revisit.locator(".tf-reading-page-panel article")).not.toContainText("session");
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("Located");
    await expect(revisit.locator(".tf-reading-page-item")).toHaveAccessibleName("Locate history item 1");
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "zh_CN" }));
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("本页历史 1");
    await expect(revisit.locator(".tf-reading-page-panel")).toHaveAttribute("aria-label", "TranslateFlow 本页阅读历史");
    await expect(revisit.locator(".tf-reading-page-item")).toHaveAccessibleName("定位第 1 条历史");
    await expect(revisit.locator(".tf-reading-page-panel article")).not.toContainText("session");
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en" }));
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
    await revisit.locator("#source").scrollIntoViewIfNeeded();
    await expect(revisit.locator(".tf-reading-page-marker")).toBeVisible();
    const scanEvidence = await driver.evaluate(async ({ url, anchor }) => {
      const tabId = (await chrome.tabs.query({})).find(tab => tab.url === url)?.id;
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [anchor], func: async value => {
        const resolved = await globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingAnchorResolver.resolve(value);
        return { status: resolved.status, chars: resolved.stats.chars, nodes: resolved.stats.nodes,
          workMs: resolved.stats.ms, waitMs: resolved.stats.waitMs, verifiedText: resolved.verifiedText };
      } });
      return result.result;
    }, { url: revisit.url(), anchor: JSON.parse(JSON.stringify(detail.data.record.anchor)) });
    expect(scanEvidence.status).toBe("resolved");
    expect(scanEvidence.verifiedText).toBe("session");
    expect(scanEvidence.chars).toBeGreaterThan(16_000);
    expect(scanEvidence.workMs).toBeGreaterThanOrEqual(0);
    expect(scanEvidence.waitMs).toBeGreaterThanOrEqual(0);
    await writeFile(info.outputPath("reading-page-marker-scan.json"), JSON.stringify({ candidateHead: buildReport.sourceHead,
      browser: context.browser().version(), status: scanEvidence.status,
      productionArtifact: { treeSha256: buildReport.treeSha256, fileCount: buildReport.fileCount, totalBytes: buildReport.totalBytes },
      testCopy: { treeSha256: buildReport.testCopy.treeSha256, fileCount: buildReport.testCopy.fileCount, totalBytes: buildReport.testCopy.totalBytes,
        changes: buildReport.testCopy.changes },
      chars: scanEvidence.chars, nodes: scanEvidence.nodes, workMs: scanEvidence.workMs, waitMs: scanEvidence.waitMs,
      pageCharsBeforeTarget: longPrefix.length, providerCalls: server.calls.length }, null, 2));
    await revisit.locator(".tf-reading-page-marker").click();
    await expect(revisit.locator(".tf-reading-page-panel")).toBeVisible();
    await expect(revisit.locator(".tf-reading-page-panel article")).not.toContainText("session");
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("Located");
    expect(JSON.stringify(await readPageSurface(revisit))).toContain("session"); // Only the current verified Range contains it.

    await revisit.evaluate(() => { document.querySelector("#source").textContent = "PUBLIC removed alpha tail"; });
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("Not found");
    await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(0);
    expect(JSON.stringify(await readPageSurface(revisit))).not.toContain("session");

    await revisit.evaluate(() => { document.querySelector("#source").innerHTML = "<span>PUBLIC </span><strong>session</strong><span> alpha tail</span>"; });
    await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(1);
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("Located");

    await revisit.evaluate(() => { history.pushState({}, "", "/marker-other"); dispatchEvent(new PopStateEvent("popstate")); });
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveCount(0);
    await revisit.goBack(); await expect(revisit).toHaveURL(articleUrl);
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
    await revisit.screenshot({ path: info.outputPath("reading-page-markers.png"), fullPage: false });

    const retryPage = await context.newPage(); await retryPage.goto(articleUrl);
    await expect(retryPage.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
    await retryPage.locator(".tf-reading-page-toggle").click();
    const retryRow = retryPage.locator(".tf-reading-page-panel article");
    for (const [round, restore] of [false, true, false, true].entries()) {
      await retryPage.evaluate(restoreQuote => { document.querySelector("#source").textContent = restoreQuote
        ? "PUBLIC session alpha tail" : "PUBLIC page changed alpha tail"; }, restore);
      if (round < 3) await expect(retryRow).toContainText(restore ? "Located" : "Not found");
      else {
        await expect(retryRow).toContainText("Not fully loaded");
        await expect(retryPage.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
        await expect(retryPage.locator(".tf-reading-page-marker")).toHaveCount(0);
        await retryPage.locator(".tf-reading-page-toggle").click();
        await retryPage.getByRole("button", { name: "Check locations again", exact: true }).click();
        await expect(retryRow).toContainText("Located");
      }
    }

    await markerIsolated(driver, retryPage.url(), "install", M.GET_PAGE_SUMMARY);
    await expect.poll(() => markerIsolated(driver, retryPage.url(), "started", M.GET_PAGE_SUMMARY)).toBe(true);
    await expect(retryRow).toContainText("Not fully loaded");
    await expect(retryPage.locator(".tf-reading-page-marker")).toHaveCount(0);
    expect(await markerIsolated(driver, retryPage.url(), "mutate", M.GET_PAGE_SUMMARY)).toBe(true);
    await retryPage.locator(".tf-reading-page-toggle").click();
    await retryRow.locator(".tf-reading-page-item").click();
    expect(await markerIsolated(driver, retryPage.url(), "scrolls", M.GET_PAGE_SUMMARY)).toBe(0);
    await markerIsolated(driver, retryPage.url(), "release", M.GET_PAGE_SUMMARY);
    await expect(retryRow).toContainText("Not found");
    await markerIsolated(driver, retryPage.url(), "restore", M.GET_PAGE_SUMMARY);

    const returnTab = context.waitForEvent("page");
    await center.getByRole("button", { name: "Return to original page", exact: true }).click();
    const returned = await returnTab; await returned.waitForLoadState("domcontentloaded");
    await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
    await expect(returned.locator(".tf-reading-page-toggle")).toHaveText("Page history 1");
    expect(await sharedResolverIsolated(driver, returned.url(), "prepare")).toBe(true);
    expect(await sharedResolverIsolated(driver, returned.url(), "start-markers")).toBe(true);
    await returned.locator('.tf-reading-return-card [data-action="retry"]').click();
    await expect.poll(async () => {
      const evidence = await sharedResolverIsolated(driver, returned.url(), "evidence");
      return evidence.singleActive > 0 && evidence.pageActive > 0 && evidence.slices > 0;
    }).toBe(true);
    await sharedResolverIsolated(driver, returned.url(), "cancel-markers");
    await expect(returned.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
    await expect(returned.locator(".tf-reading-return-card blockquote")).toHaveText("session");
    await expect(returned.locator(".tf-reading-page-toggle")).toHaveCount(0);
    const sharedEvidence = await sharedResolverIsolated(driver, returned.url(), "evidence");
    expect(sharedEvidence.scannerCreations).toBe(1);
    expect(sharedEvidence.singleStarted).toBe(1); expect(sharedEvidence.pageStarted).toBe(1);
    await returned.close();
    expect(server.calls).toHaveLength(0);
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
