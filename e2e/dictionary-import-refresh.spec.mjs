import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

for (const failRefresh of [false, true]) {
  test(`local dictionary completion waits for the installed list (${failRefresh ? "refresh failure" : "success"})`, async ({ harness }, testInfo) => {
    await harness.reset();
    const page = await harness.context.newPage();
    if (!failRefresh) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    }
    await page.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await page.locator("#localDictionaryFiles").setInputFiles({ name: "refresh.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["refreshfixture", "<p>Local refresh fixture</p>"]], { title: "Installed refresh fixture", styleSheet: "" }) });
    await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
    await page.evaluate(() => {
      const original = chrome.runtime.sendMessage;
      const probe = globalThis.__tfImportRefresh = { committed: false, pending: [], hold: true, original };
      chrome.runtime.sendMessage = function (message, ...args) {
        const response = original.call(this, message, ...args);
        if (message?.type === "RICH_MDICT_IMPORT_COMMIT") return response.then(value => { probe.committed = value.ok === true; return value; });
        if (message?.type === "RICH_MDICT_LIST" && probe.committed && probe.hold) {
          return new Promise(resolve => { probe.pending.push({ resolve, response }); });
        }
        return response;
      };
    });
    await page.locator("#localDictionaryImportButton").click();
    await expect.poll(() => page.evaluate(() => globalThis.__tfImportRefresh.pending.length)).toBeGreaterThanOrEqual(2);
    const progress = page.locator("#localDictionaryImportProgress");
    await expect(progress).toContainText("正在更新已安装词典列表");
    await expect(progress).not.toHaveAttribute("data-phase", "done");
    await expect(page.locator("#localDictionaryImportButton")).toBeDisabled();
    await page.evaluate(async fail => {
      const probe = globalThis.__tfImportRefresh;
      probe.hold = false;
      await Promise.all(probe.pending.map(async item => item.resolve(fail ? { ok: false, error: "Synthetic list refresh failure" } : await item.response)));
    }, failRefresh);
    const row = page.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Installed refresh fixture" });
    if (failRefresh) {
      await expect(progress).toContainText("词典已安装，但列表刷新失败");
      await expect(progress).not.toHaveAttribute("data-phase", "done");
      await expect(page.locator("#localDictionaryViewInstalled")).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.closest("#richMdictInstalledList"))).toBeNull();
      await page.locator("#refreshDictionaryPacks").click();
    } else {
      await expect(progress).toHaveAttribute("data-phase", "done");
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
      await expect(row).toHaveAttribute("data-import-highlight", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("import-complete-located-narrow-dark.png") });
      const viewInstalled = page.getByRole("button", { name: "查看刚安装的词典" });
      await expect(viewInstalled).toBeVisible();
      await viewInstalled.click();
      await expect(row).toBeFocused();
      await expect(row).toBeInViewport();
    }
    await expect(row).toBeVisible();
    await expect(row).toContainText("可用");
    // No page reload or second import: retry only reads the already committed dictionary.
    const installed = await page.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(installed.dictionaries).toHaveLength(1);
    expect(harness.server.calls).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath("installed-without-reload.png"), fullPage: true });
  });
}

test("installed cards and new commits appear before a slow full health check finishes", async ({ harness }, testInfo) => {
  await harness.reset();
  const install = async (page, title, fileName) => {
    await page.locator("#localDictionaryFiles").setInputFiles({ name: fileName, mimeType: "application/octet-stream",
      buffer: makeRichMdx([["localfixture", "<p>Committed local fixture</p>"]], { title, styleSheet: "" }) });
    await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
    await page.locator("#localDictionaryImportButton").click();
    await expect(page.locator("#localDictionaryImportProgress")).toContainText("完成");
    const installedRow = page.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: title });
    await expect(installedRow).toBeFocused();
    await expect(installedRow).toBeInViewport();
  };
  const importer = await harness.context.newPage();
  await importer.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await install(importer, "First installed fixture", "first.mdx");
  const viewer = await harness.context.newPage();
  await viewer.addInitScript(() => {
    if (!globalThis.chrome?.runtime) return;
    const original = chrome.runtime.sendMessage;
    const gate = globalThis.__tfSlowHealth = { pending: [], hold: true, documentMarker: crypto.randomUUID() };
    chrome.runtime.sendMessage = function (message, ...args) {
      const result = original.call(this, message, ...args);
      if (message?.type === "RICH_MDICT_LIST" && message.metadataOnly !== true && gate.hold)
        return new Promise(resolve => gate.pending.push({ resolve, result }));
      return result;
    };
  });
  await viewer.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  const marker = await viewer.evaluate(() => globalThis.__tfSlowHealth.documentMarker);
  await expect.poll(() => viewer.evaluate(() => globalThis.__tfSlowHealth.pending.length)).toBeGreaterThan(0);
  const first = viewer.locator('[data-dictionary-id]').filter({ hasText: "First installed fixture" });
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute("data-status", "checking");
  await expect(first).toContainText("已安装");
  await install(importer, "Second installed fixture", "second.mdx");
  const second = viewer.locator('[data-dictionary-id]').filter({ hasText: "Second installed fixture" });
  await expect(second).toBeVisible();
  await expect(second).toHaveAttribute("data-status", "checking");
  await expect(first).not.toBeFocused();
  await expect(second).not.toBeFocused();
  expect(await viewer.evaluate(() => globalThis.__tfSlowHealth.documentMarker)).toBe(marker);
  await viewer.screenshot({ path: testInfo.outputPath("installed-while-health-check-pending.png"), fullPage: true });
  await viewer.evaluate(async () => {
    const gate = globalThis.__tfSlowHealth; gate.hold = false;
    await Promise.all(gate.pending.map(async item => item.resolve(await item.result)));
  });
  await expect(first).toHaveAttribute("data-status", "ready");
  await expect(second).toHaveAttribute("data-status", "ready");
  await expect(second).toContainText("可用");
  expect(harness.server.calls).toHaveLength(0);
  await viewer.screenshot({ path: testInfo.outputPath("automatic-list-update.png"), fullPage: true });
});

for (const commitType of ["RICH_MDICT_IMPORT_COMMIT", "RICH_MDD_RESOURCE_COMMIT"]) {
  test(`slow ${commitType} clearly remains in progress until commit completes`, async ({ harness }, testInfo) => {
    await harness.reset();
    const page = await harness.context.newPage();
    await page.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const files = [{ name: "slow.mdx", mimeType: "application/octet-stream",
      buffer: makeRichMdx([["slowfixture", "<p>Slow commit fixture</p>"]], { title: "Slow commit fixture", styleSheet: "" }) }];
    if (commitType === "RICH_MDD_RESOURCE_COMMIT") {
      const { makeMdd } = await import("../tests/helpers/mdd-fixture.mjs");
      files.push({ name: "slow.mdd", mimeType: "application/octet-stream", buffer: makeMdd([["\\style.css", new TextEncoder().encode("p { color: green; }")]]) });
    }
    await page.locator("#localDictionaryFiles").setInputFiles(files);
    await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
    await page.evaluate(type => {
      const original = chrome.runtime.sendMessage;
      globalThis.__tfSlowCommit = { pending: false, release: null };
      chrome.runtime.sendMessage = function (message, ...args) {
        if (message?.type === type) return new Promise(resolve => {
          globalThis.__tfSlowCommit.pending = true;
          globalThis.__tfSlowCommit.release = () => resolve(original.call(this, message, ...args));
        });
        return original.call(this, message, ...args);
      };
    }, commitType);
    await page.locator("#localDictionaryImportButton").click();
    await expect.poll(() => page.evaluate(() => globalThis.__tfSlowCommit.pending)).toBe(true);
    const notice = page.locator("#localDictionaryImportNotice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("正在安装，尚未完成");
    await expect(notice).toContainText("完成后会自动定位");
    await expect(page.locator("#localDictionaryImport")).toHaveAttribute("data-busy", "true");
    await expect(page.locator("#localDictionaryImportButton")).toBeDisabled();
    await expect(page.locator("#localDictionaryImportProgress")).not.toHaveAttribute("data-phase", "done");
    await expect(page.locator("#localDictionaryViewInstalled")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("clearly-still-installing.png") });
    await page.evaluate(() => globalThis.__tfSlowCommit.release());
    await expect(notice).toBeHidden();
    const row = page.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Slow commit fixture" });
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport();
    await expect(page.locator("#localDictionaryImportProgress")).toHaveAttribute("data-phase", "done");
    expect(harness.server.calls).toHaveLength(0);
  });
}
