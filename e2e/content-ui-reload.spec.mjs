import { test, expect } from "./support/extension-fixture.mjs";

// Observe Chrome's error console while normal document selection events run.
// A try/catch around popover calls alone cannot detect errors in other listeners.
test("real selection and Escape after reload leave Chrome's extension error console empty", async ({ harness }) => {
  test.setTimeout(60_000);
  await harness.reset();
  const page = await harness.open("/incremental");
  const manager = await harness.context.newPage(); await manager.goto("chrome://extensions/");
  await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const select = () => page.locator("#initial").evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const readErrors = () => manager.evaluate(async id =>
    (await chrome.developerPrivate.getExtensionInfo(id)).runtimeErrors.map(error => error.message), harness.extensionId);
  let reloaded = false;
  try {
    await select(); await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.locator(".tf-selection-chip")).toHaveCount(0);
    expect(await readErrors()).toEqual([]);
    await Promise.all([harness.context.waitForEvent("serviceworker"),
      manager.evaluate(id => chrome.developerPrivate.reload(id, { failQuietly: false }), harness.extensionId)]);
    reloaded = true;
    await select(); await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.locator(".tf-selection-chip")).toHaveCount(0);
    // Inspect the old document without reinjection or clearing Chrome's errors.
    expect(await readErrors()).toEqual([]);
    await page.reload();
    await select(); await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.locator(".tf-selection-chip")).toHaveCount(0);
    expect(await readErrors()).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);
  } finally { if (reloaded) await harness.restartBrowser(); }
});

test("old selection UI survives actual extension reload without uncaught icon or cleanup errors", async ({ harness }) => {
  test.setTimeout(60_000);
  await harness.reset();
  const page = await harness.open("/incremental");
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(({ tabId }) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
    document.addEventListener("tf-test-old-selection-ui", () => {
      let invalidated = false, error = null;
      try { chrome.runtime.getURL("manifest.json"); } catch { invalidated = true; }
      let icon = false, text = "", removed = false;
      try {
        app.modules.selectionPopover.showChip({ text: "Synthetic", rect: { left: 30, top: 40, bottom: 60, width: 80, height: 20 } });
        const chip = app.modules.uiHost.getShadowRoot().querySelector(".tf-selection-chip");
        icon = Boolean(app.modules.uiPrimitives.brandIcon()); text = chip?.textContent || "";
        app.modules.selectionPopover.hide(); app.modules.selectionPopover.hide();
        removed = !app.modules.uiHost.getShadowRoot().querySelector(".tf-selection-ui");
      } catch (cause) { error = String(cause?.message || cause); }
      document.documentElement.dataset.tfOldSelectionUi = JSON.stringify({ invalidated, icon, text, removed, error });
    });
  } }), { tabId });
  const inspect = () => page.evaluate(() => {
    document.dispatchEvent(new Event("tf-test-old-selection-ui"));
    return JSON.parse(document.documentElement.dataset.tfOldSelectionUi);
  });
  const healthy = await inspect();
  expect(healthy).toMatchObject({ invalidated: false, icon: true, removed: true, error: null });
  let reloaded = false;
  try {
    const manager = await harness.context.newPage(); await manager.goto("chrome://extensions/");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    await Promise.all([harness.context.waitForEvent("serviceworker"),
      manager.evaluate(id => chrome.developerPrivate.reload(id, { failQuietly: false }), harness.extensionId)]);
    reloaded = true;
    const old = await inspect();
    expect(old).toMatchObject({ invalidated: true, icon: false, removed: true, error: null });
    expect(old.text).not.toBe("");
    expect(harness.server.calls).toHaveLength(0);
    const driver = await harness.context.newPage(); await driver.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    await page.reload();
    const freshTabId = await driver.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)?.id, page.url());
    const [fresh] = await driver.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const icon = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.uiPrimitives.brandIcon();
      return icon?.src || null;
    } }), freshTabId);
    expect(fresh.result).toContain(`chrome-extension://${harness.extensionId}/`);
    expect(harness.server.calls).toHaveLength(0);
  } finally { if (reloaded) await harness.restartBrowser(); }
});
