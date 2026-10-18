import { test, expect } from "./support/extension-fixture.mjs";

test.use({ lexiconPacks: "missing" });

test("actual extension reload stops old automatic queues and page refresh restores saved modes", async ({ harness }, info) => {
  test.setTimeout(60_000);
  await harness.reset();
  const scope = "http://127.0.0.1";
  await harness.setStorage({ autoSites: [scope], cacheRestoreSites: [scope] });
  const page = await harness.open("/incremental");
  await expect(page.locator("#initial .abt-translation")).toBeVisible();
  expect(harness.server.calls).toHaveLength(1);
  const tabId = await harness.tabId(page);
  // Keep a read-only observer in the original isolated world. Reinjecting a
  // script after reload would create a fresh context and hide the actual bug.
  await harness.driver.evaluate(({ tabId }) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const state = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.runtime.state;
    document.addEventListener("tf-test-read-old-auto", () => {
      document.documentElement.dataset.tfOldAuto = JSON.stringify({ auto: state.auto, cacheRestore: state.cacheRestore,
        pending: state.pending.size, timer: state.autoTimer !== null, intersection: Boolean(state.intersectionObserver),
        mutation: Boolean(state.mutationObserver), running: state.autoDrainRunning });
    });
    const toast = globalThis.__TRANSLATE_FLOW_CONTENT__.modules.uiToast;
    const show = toast.show.bind(toast);
    let notices = 0;
    toast.show = (message, kind) => { if (message.includes("扩展已更新")) document.documentElement.dataset.tfReloadNotices = String(++notices); show(message, kind); };
  } }), { tabId });
  const before = await readOldState(page);
  expect(before.auto).toBe(true); expect(before.cacheRestore).toBe(true);
  let reloaded = false;
  try {
    const manager = await harness.context.newPage(); await manager.goto("chrome://extensions/");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    const [worker] = await Promise.all([
      harness.context.waitForEvent("serviceworker"),
      manager.evaluate(id => chrome.developerPrivate.reload(id, { failQuietly: false }), harness.extensionId)
    ]);
    reloaded = true;
    expect(worker).not.toBe(harness.serviceWorker);
    await page.bringToFront();
    await append(page, "after-reload", "This newly appended paragraph must not be submitted from an invalidated extension context.");
    await expect(page.locator(".tf-toast-message")).toHaveText("扩展已更新，请刷新当前网页后重试。");
    await expect.poll(() => readOldState(page)).toEqual({ auto: false, cacheRestore: false, pending: 0,
      timer: false, intersection: false, mutation: false, running: false });
    await expect(page.locator("html")).toHaveAttribute("data-tf-reload-notices", "1");
    await page.screenshot({ path: info.outputPath("automatic-refresh-required.png") });
    await append(page, "after-stop", "More page changes must not reactivate observers or retry old automatic requests.");
    expect(await readOldState(page)).toEqual({ auto: false, cacheRestore: false, pending: 0,
      timer: false, intersection: false, mutation: false, running: false });
    expect(harness.server.calls).toHaveLength(1);
    await expect(page.locator("html")).toHaveAttribute("data-tf-reload-notices", "1");

    const driver = await harness.context.newPage(); await driver.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    expect(await driver.evaluate(() => chrome.storage.local.get(["autoSites", "cacheRestoreSites"])))
      .toEqual({ autoSites: [scope], cacheRestoreSites: [scope] });
    await page.reload();
    await expect(page.locator("#initial .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(1);
    await append(page, "fresh-context", "After refreshing the page, the saved automatic mode should translate this new paragraph normally.");
    await expect(page.locator("#fresh-context .abt-translation")).toBeVisible();
    expect(harness.server.calls).toHaveLength(2);
    await page.screenshot({ path: info.outputPath("automatic-after-page-refresh.png") });
  } finally {
    // The shared fixture's original driver was invalidated as well; restore its
    // owned browser bindings before another test can reuse this worker fixture.
    if (reloaded) await harness.restartBrowser();
  }
});

async function readOldState(page) {
  return page.evaluate(() => {
    document.dispatchEvent(new Event("tf-test-read-old-auto"));
    return JSON.parse(document.documentElement.dataset.tfOldAuto);
  });
}

async function append(page, id, text) {
  await page.evaluate(({ id, text }) => {
    const paragraph = document.createElement("p"); paragraph.id = id; paragraph.textContent = text;
    document.querySelector("main").appendChild(paragraph);
  }, { id, text });
  await page.locator(`#${id}`).scrollIntoViewIfNeeded();
}
