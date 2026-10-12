import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

test("authorized revisit keeps one word highlight for repeated lookups and restores it across DOM and SPA changes", async ({}, info) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-reading-highlights-"));
  const extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer(), articleUrl = `${server.baseUrl}/marker-page?private=synthetic`;
  const longPrefix = Array.from({ length: 90 }, (_, index) => `<p>section ${index} ${"filler ".repeat(90)}</p>`).join("");
  server.setPage("/marker-page", `<!doctype html><style>main{margin:0 48px}</style><main>${longPrefix}<p id="source">PUBLIC <span id="word">session</span> alpha tail</p></main>`);
  let context;
  try {
    const buildReport = await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
    const driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en", autoSites: [], cacheRestoreSites: [],
      quickControlSites: [], quickControlHiddenSites: [], readingMemorySites: [] }));
    const center = await context.newPage(); await center.goto(`chrome-extension://${id}/learning-center.html`);
    await center.getByRole("button", { name: "Enable recording", exact: true }).click();

    const source = await context.newPage(); await source.goto(articleUrl);
    for (let index = 0; index < 2; index++) {
      await source.evaluate(() => {
        document.querySelector("#word").scrollIntoView({ block: "center" });
        const node = document.querySelector("#word").firstChild, range = document.createRange();
        range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await source.locator(".tf-selection-chip").click();
      await expect(source.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
      await source.locator(".tf-selection-icon-button").click();
    }
    await center.reload();
    const recordRow = center.locator(".record-list .record").first(), recordId = await recordRow.getAttribute("data-record-id");
    const detail = await center.evaluate(({ method, recordId }) => chrome.runtime.sendMessage({ protocolVersion: 2, method, recordId }),
      { method: M.GET_RECORD, recordId });
    expect(detail.data.record.safeReturnUrl).toBeNull();
    await expect(center.locator(".record-list .record")).toHaveCount(2);
    await source.close();

    const revisit = await context.newPage(); await revisit.setViewportSize({ width: 1280, height: 800 }); await revisit.goto(articleUrl);
    await revisit.locator("#word").scrollIntoViewIfNeeded();
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(1);
    await expect(revisit.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);
    const highlightAppearance = await revisit.locator(".tf-reading-page-highlight").evaluate(node => ({
      pointerEvents: getComputedStyle(node).pointerEvents,
      background: getComputedStyle(node).backgroundColor
    }));
    expect(highlightAppearance.pointerEvents).toBe("none");
    expect(highlightAppearance.background).not.toBe("rgba(0, 0, 0, 0)");

    await revisit.locator("#word").hover();
    const preview = revisit.frameLocator("iframe.tf-reading-hover-frame");
    await expect(preview.getByRole("heading", { name: "session", exact: true })).toBeVisible();
    await expect(revisit.locator(".tf-reading-hover-preview")).toBeVisible();
    const previewUrl = await revisit.locator("iframe.tf-reading-hover-frame").getAttribute("src"), stableSince = Date.now();
    await expect.poll(async () => {
      const urls = await revisit.locator("iframe.tf-reading-hover-frame").evaluateAll(nodes => nodes.map(node => node.getAttribute("src")));
      return Date.now() - stableSince >= 600 && urls.length === 1 && urls[0] === previewUrl ? "stable" : JSON.stringify(urls);
    }, { timeout: 1500 }).toBe("stable");
    await preview.getByRole("button", { name: "Close", exact: false }).click();

    await revisit.evaluate(() => { globalThis.__wordClicks = 0; document.querySelector("#word").addEventListener("click", () => __wordClicks++); });
    await revisit.locator("#word").click();
    expect(await revisit.evaluate(() => __wordClicks)).toBe(1);

    const scanEvidence = await driver.evaluate(async ({ url, anchor }) => {
      const tabId = (await chrome.tabs.query({})).find(tab => tab.url === url)?.id;
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [anchor], func: async value => {
        const resolved = await globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingAnchorResolver.resolve(value);
        return { status: resolved.status, chars: resolved.stats.chars, nodes: resolved.stats.nodes,
          workMs: resolved.stats.ms, waitMs: resolved.stats.waitMs, verifiedText: resolved.verifiedText };
      } });
      return result.result;
    }, { url: revisit.url(), anchor: JSON.parse(JSON.stringify(detail.data.record.anchor)) });
    expect(scanEvidence).toMatchObject({ status: "resolved", verifiedText: "session" });
    expect(scanEvidence.chars).toBeGreaterThan(16_000);

    await revisit.evaluate(() => {
      const staleSource = document.querySelector("#source"), staleWord = document.querySelector("#word");
      staleSource.id = "stale-source"; staleWord.id = "stale-word";
      staleSource.firstChild.data = "CHANGED "; staleSource.lastChild.data = " shifted";
      const replacement = document.createElement("p"); replacement.id = "source";
      replacement.innerHTML = 'PUBLIC <span id="word">session</span> alpha tail';
      staleSource.replaceWith(replacement);
      document.body.append(staleSource);
    });
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(1);
    await expect.poll(async () => {
      const highlight = await revisit.locator(".tf-reading-page-highlight").boundingBox();
      const current = await revisit.locator("#word").boundingBox();
      const stale = await revisit.locator("#stale-word").boundingBox();
      if (!highlight || !current || !stale) return "missing geometry";
      const currentDistance = Math.abs(highlight.x - current.x) + Math.abs(highlight.y - current.y);
      const staleDistance = Math.abs(highlight.x - stale.x) + Math.abs(highlight.y - stale.y);
      return currentDistance < 6 && currentDistance < staleDistance ? "migrated" : { currentDistance, staleDistance };
    }).toBe("migrated");

    await revisit.evaluate(() => { document.querySelector("#source").textContent = "PUBLIC removed alpha tail"; });
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(0);
    await revisit.evaluate(() => { document.querySelector("#source").innerHTML = "PUBLIC <span id=\"word\">session</span> alpha tail"; });
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(1);

    await revisit.evaluate(() => { history.pushState({}, "", "/marker-other"); dispatchEvent(new PopStateEvent("popstate")); });
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(0);
    await revisit.goBack(); await expect(revisit).toHaveURL(articleUrl);
    await revisit.locator("#word").scrollIntoViewIfNeeded();
    await expect(revisit.locator(".tf-reading-page-highlight")).toHaveCount(1);
    await expect(revisit.locator(".tf-reading-page-marker, .tf-reading-page-toggle, .tf-reading-page-panel")).toHaveCount(0);
    expect(server.calls).toHaveLength(0);

    await revisit.screenshot({ path: info.outputPath("reading-word-highlight.png"), fullPage: false });
    await writeFile(info.outputPath("reading-word-highlight-scan.json"), JSON.stringify({ candidateHead: buildReport.sourceHead,
      browser: context.browser().version(), status: scanEvidence.status,
      productionArtifact: { treeSha256: buildReport.treeSha256, fileCount: buildReport.fileCount, totalBytes: buildReport.totalBytes },
      testCopy: { treeSha256: buildReport.testCopy.treeSha256, fileCount: buildReport.testCopy.fileCount,
        totalBytes: buildReport.testCopy.totalBytes, changes: buildReport.testCopy.changes },
      chars: scanEvidence.chars, nodes: scanEvidence.nodes, workMs: scanEvidence.workMs, waitMs: scanEvidence.waitMs,
      pageCharsBeforeTarget: longPrefix.length, providerCalls: server.calls.length }, null, 2));
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
