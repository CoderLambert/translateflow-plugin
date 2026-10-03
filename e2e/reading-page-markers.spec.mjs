import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";

test("authorized revisit renders bounded page history markers and recovers across DOM and SPA changes without Provider work", async ({}, info) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-reading-markers-")), extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer(), articleUrl = `${server.baseUrl}/marker-page`; let context;
  server.setPage("/marker-page", '<!doctype html><main><p id="source">PUBLIC session alpha tail</p></main>');
  try {
    await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
    const driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en", autoSites: [], cacheRestoreSites: [], quickControlSites: [], quickControlHiddenSites: [], readingMemorySites: [] }));
    const center = await context.newPage(); await center.goto(`chrome-extension://${id}/learning-center.html`);
    await center.getByRole("button", { name: "Enable recording", exact: true }).click();
    const source = await context.newPage(); await source.goto(articleUrl);
    await source.evaluate(() => { const node = document.querySelector("#source").firstChild, start = node.nodeValue.indexOf("session"), range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + 7); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
    await source.locator(".tf-selection-chip").click(); await expect(source.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
    await center.reload(); await center.locator(".record-list .record").first().click();
    await center.getByRole("button", { name: "Enable site markers", exact: true }).click();
    await expect(center.getByRole("button", { name: "Disable site markers", exact: true })).toHaveAttribute("aria-pressed", "true");
    await source.close();

    const revisit = await context.newPage(); await revisit.goto(articleUrl);
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("本页历史 1");
    await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(1);
    await revisit.locator(".tf-reading-page-marker").click();
    await expect(revisit.locator(".tf-reading-page-panel")).toBeVisible();
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("session");
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("已定位");

    await revisit.evaluate(() => { document.querySelector("#source").innerHTML = "<span>PUBLIC </span><strong>session</strong><span> alpha tail</span>"; });
    await expect(revisit.locator(".tf-reading-page-marker")).toHaveCount(1);
    await expect(revisit.locator(".tf-reading-page-panel article")).toContainText("已定位");

    await revisit.evaluate(() => { history.pushState({}, "", "/marker-other"); dispatchEvent(new PopStateEvent("popstate")); });
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveCount(0);
    await revisit.goBack(); await expect(revisit).toHaveURL(articleUrl);
    await expect(revisit.locator(".tf-reading-page-toggle")).toHaveText("本页历史 1");
    await revisit.screenshot({ path: info.outputPath("reading-page-markers.png"), fullPage: false });
    expect(server.calls).toHaveLength(0);
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
