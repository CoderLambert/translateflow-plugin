import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";

test("Reading handoff opens the exact saved page and target Content consumes one minimal summary without Provider work", async ({}, info) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-reading-handoff-"));
  const extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer();
  let context;
  try {
    await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host, driver = await context.newPage();
    await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en", autoSites: [], cacheRestoreSites: [],
      quickControlSites: [], quickControlHiddenSites: [], readingMemorySites: [] }));

    const center = await context.newPage(); await center.goto(`chrome-extension://${id}/learning-center.html`);
    await center.getByRole("button", { name: "Enable recording", exact: true }).click();
    await expect(center.getByRole("button", { name: "Pause recording", exact: true })).toBeVisible();

    const source = await context.newPage(); await source.goto(`${server.baseUrl}/article`);
    await source.evaluate(() => { document.title = "Synthetic handoff source";
      document.body.innerHTML = '<main><p id="source">PUBLIC session alpha session tail</p></main>'; });
    await source.evaluate(() => {
      const node = document.querySelector("#source").firstChild, start = node.nodeValue.indexOf("session");
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 7);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(source.locator(".tf-selection-chip")).toBeVisible(); await source.locator(".tf-selection-chip").click();
    await expect(source.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
    expect(server.calls).toHaveLength(0);

    await center.reload(); await expect(center.locator(".record-list .record")).toHaveCount(1);
    await center.locator(".record-list .record").first().click();
    await expect(center.getByRole("heading", { name: "session", exact: true })).toBeVisible();
    const existingTabIds = await driver.evaluate(async () => (await chrome.tabs.query({})).map(tab => tab.id));
    const opened = context.waitForEvent("page");
    await center.getByRole("button", { name: "Return to original page", exact: true }).click();
    const target = await opened; await target.waitForLoadState("domcontentloaded");
    await expect(center.getByText("Original page opened safely. Exact selection location is not available yet.", { exact: true })).toBeVisible();
    expect(target.url()).toBe(`${server.baseUrl}/article`); expect(server.calls).toHaveLength(0);

    const tabId = await driver.evaluate(async ({ url, existingTabIds }) =>
      (await chrome.tabs.query({})).find(tab => tab.url === url && !existingTabIds.includes(tab.id))?.id, { url: target.url(), existingTabIds });
    expect(tabId).toBeGreaterThanOrEqual(0);
    const readHandoff = () => driver.evaluate(async tabId => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
        func: async () => globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.readingHandoff ?
          await globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingHandoff.ready : null });
      return result?.result ?? null;
    }, tabId);
    await expect.poll(readHandoff).toMatchObject({ state: "consumed" });
    const consumed = await readHandoff();
    expect(Object.keys(consumed.summary).sort()).toEqual(["anchor", "hasCompletedAssistant", "recordId", "revision"]);

    await expect(center.getByRole("button", { name: /site markers/i })).toHaveCount(0);
    expect(await driver.evaluate(() => chrome.storage.local.get("readingMemoryDisabledSites"))).toEqual({});
    await center.screenshot({ path: info.outputPath("reading-handoff-ready.png"), fullPage: true });
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
