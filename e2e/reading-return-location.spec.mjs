import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

async function readOwnedSurface(page, includePage = false) {
  return page.evaluate(includePage => {
    const values = [...(globalThis.__tfObservedMessages || []), ...(globalThis.__tfObservedEventDetails || [])];
    function visit(root) {
      if (!root) return;
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
    if (includePage) visit(document);
    else visit(document.querySelector("#translateflow-ui-root")?.shadowRoot);
    return values;
  }, includePage);
}

test("Reading return resolves one exact Range, refuses ambiguous/missing locations and opens the exact history card", async ({}, info) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-reading-return-")), extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer(); let context, mode = "unique";
  const articleUrl = `${server.baseUrl}/return-location`;
  const html = () => mode === "unique" ? '<!doctype html><style>body{margin:0}.space{height:1800px}</style><div class="space"></div><main><p id="source">PUBLIC session alpha tail</p></main>'
    : mode === "ambiguous" ? '<!doctype html><main><p>PUBLIC session alpha tail</p><p>PUBLIC session alpha tail</p></main>'
      : '<!doctype html><main><p>PUBLIC changed alpha tail</p></main>';
  try {
    await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    server.setPage("/return-location", html());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
    await context.addInitScript(() => {
      globalThis.__tfObservedMessages = []; globalThis.__tfObservedEventDetails = [];
      addEventListener("message", event => { try { __tfObservedMessages.push(JSON.stringify(event.data)); } catch {} });
      const dispatch = EventTarget.prototype.dispatchEvent;
      EventTarget.prototype.dispatchEvent = function(event) {
        if (event && "detail" in event) { try { __tfObservedEventDetails.push(JSON.stringify(event.detail)); } catch {} }
        return dispatch.call(this, event);
      };
    });
    const driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(() => chrome.storage.local.set({ uiLocale: "en", autoSites: [], cacheRestoreSites: [], quickControlSites: [], quickControlHiddenSites: [] }));
    const center = await context.newPage(); await center.goto(`chrome-extension://${id}/learning-center.html`);
    await center.getByRole("button", { name: "Enable recording", exact: true }).click();
    const source = await context.newPage(); await source.goto(articleUrl);
    await source.evaluate(() => {
      document.querySelector("#source").scrollIntoView({ block: "center" });
      const node = document.querySelector("#source").firstChild, start = node.nodeValue.indexOf("session"), range = document.createRange();
      range.setStart(node, start); range.setEnd(node, start + 7); getSelection().removeAllRanges(); getSelection().addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(source.locator(".tf-selection-chip")).toBeVisible(); await source.locator(".tf-selection-chip").click();
    await expect(source.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
    expect(server.calls).toHaveLength(0);
    const list = await center.evaluate(input => chrome.runtime.sendMessage(input), { protocolVersion: 2, method: M.LIST_RECORDS, pageKey: null, query: "", cursor: null, limit: 30 });
    const recordId = list.data.items[0].recordId;
    await center.reload(); await center.locator(`[data-record-id="${recordId}"]`).click();

    async function openTarget(expected) {
      server.setPage("/return-location", html());
      const opened = context.waitForEvent("page");
      await center.getByRole("button", { name: "Return to original page", exact: true }).click();
      const page = await opened; await page.waitForLoadState("domcontentloaded");
      await expect(page.locator(`.tf-reading-return-card[data-state="${expected}"]`)).toBeVisible();
      if (expected === "resolved") await expect(page.locator(".tf-reading-return-card blockquote")).toHaveText("session");
      else {
        await expect(page.locator(".tf-reading-return-card blockquote")).toBeHidden();
        await expect(page.locator(".tf-reading-return-card blockquote")).toHaveText("");
      }
      if (expected !== "resolved") expect(JSON.stringify(await readOwnedSurface(page))).not.toContain("session");
      return page;
    }

    mode = "unique";
    let target = await openTarget("resolved");
    await expect(target.locator(".tf-reading-return-highlight")).not.toHaveCount(0);
    await expect.poll(() => target.evaluate(() => scrollY)).toBeGreaterThan(1000);
    await expect.poll(() => target.locator(".tf-reading-return-highlight").first().evaluate(node => {
      const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await target.evaluate(() => { document.querySelector("#source").innerHTML = "<span>PUBLIC </span><strong>session</strong><span> alpha tail</span>"; });
    await expect(target.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
    await expect(target.locator(".tf-reading-return-highlight")).not.toHaveCount(0);
    await target.screenshot({ path: info.outputPath("reading-return-resolved.png"), fullPage: false });
    await target.evaluate(() => {
      const style = document.createElement("style"); style.id = "tf-reading-viewport-test";
      style.textContent = "#viewport-duplicate{display:none}@media(max-width:700px){#viewport-duplicate{display:block}}";
      document.head.appendChild(style);
      const duplicate = document.createElement("p"); duplicate.id = "viewport-duplicate";
      duplicate.textContent = "PUBLIC session alpha tail"; document.querySelector("main").appendChild(duplicate);
    });
    await expect(target.locator('.tf-reading-return-card[data-state="resolved"]')).toBeVisible();
    await target.setViewportSize({ width: 600, height: 720 });
    await expect(target.locator('.tf-reading-return-card[data-state="ambiguous"]')).toBeVisible();
    await expect(target.locator(".tf-reading-return-highlight")).toHaveCount(0);
    await target.keyboard.press("Escape");
    await expect(target.locator(".tf-reading-return-card")).toHaveCount(0); await expect(target.locator(".tf-reading-return-highlight")).toHaveCount(0);
    await target.close();

    mode = "ambiguous"; target = await openTarget("ambiguous");
    await expect(target.locator(".tf-reading-return-highlight")).toHaveCount(0);
    await expect(target.locator('[data-role="location-status"]')).toHaveText("Several reliable matches were found, so no location was selected automatically."); await target.close();

    mode = "missing"; target = await openTarget("missing");
    await expect(target.locator('[data-role="location-status"]')).toHaveText("The saved text was not found on this page. The historical record remains available.");
    expect(JSON.stringify(await readOwnedSurface(target, true))).not.toContain("session"); await target.close();

    mode = "unique"; target = await openTarget("resolved");
    const openedHistory = context.waitForEvent("page");
    await target.locator('[data-action="open-record"]').click();
    const history = await openedHistory; await history.waitForLoadState("domcontentloaded");
    expect(history.url()).toBe(`chrome-extension://${id}/learning-center.html#record=${recordId}`);
    await expect(history.getByRole("heading", { name: "session", exact: true })).toBeVisible();
    expect(server.calls).toHaveLength(0);
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
