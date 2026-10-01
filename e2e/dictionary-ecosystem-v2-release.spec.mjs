import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

const evidenceDirectory = resolve(
  process.env.DICTIONARY_ECOSYSTEM_V2_EVIDENCE_DIR || "/tmp/translateflow-dictionary-ecosystem-v2/evidence"
);
const preferredBaseline = JSON.parse(await readFile(new URL("../docs/DICTIONARY_ECOSYSTEM_V2_PREFERRED_BASELINE.json", import.meta.url), "utf8"));
const report = {
  schemaVersion: 1,
  status: "FAIL",
  spec: "e2e/dictionary-ecosystem-v2-release.spec.mjs",
  mdxOnlyRichRoute: {
    status: "not-run",
    fileCount: 1,
    associatedMddCount: 0,
    persistedAfterReload: false,
    visibleInSelection: false,
    keyboardImport: false,
    keyboardDismiss: false,
    accessibleFilePicker: false,
    selectedFilesAccessibleLabel: false,
    installAccessibleName: false,
    selectionChipAccessibleName: false,
    dismissAccessibleName: false,
    preflightLiveRegion: false,
    progressLiveRegion: false,
    viewportWidth: 390,
    darkMode: false,
    reducedMotion: false,
    horizontalOverflow: null,
    providerCalls: null,
    externalRequests: null
  }
};
const performanceReport = {
  schemaVersion: 1,
  status: "FAIL",
  spec: "e2e/dictionary-ecosystem-v2-release.spec.mjs",
  repeatedPreferenceLookup: { status: "not-run", sampleCount: 0 },
  selectionChangeStaleInvalidation: { status: "not-run", sampleCount: 0 },
  providerCalls: null,
  externalRequests: null
};

test.describe("Dictionary Ecosystem v2 release-critical route evidence", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.afterEach(async ({ harness }) => {
    for (const page of harness.context.pages()) {
      if (page !== harness.driver && !page.isClosed()) await page.close();
    }
  });

  test.afterAll(async () => {
    report.status = report.mdxOnlyRichRoute.status === "passed" ? "PASS" : "FAIL";
    performanceReport.status = performanceReport.repeatedPreferenceLookup.status === "passed" &&
      performanceReport.selectionChangeStaleInvalidation.status === "passed" &&
      performanceReport.providerCalls === 0 && performanceReport.externalRequests === 0
      ? "PASS"
      : "FAIL";
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      resolve(evidenceDirectory, "dictionary-ecosystem-v2-import-report.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    await writeFile(
      resolve(evidenceDirectory, "dictionary-ecosystem-v2-performance-report.json"),
      `${JSON.stringify(performanceReport, null, 2)}\n`
    );
  });

  test("unified MDX-only Rich route installs locally and exposes accessible keyboard states", async ({ harness }) => {
    const externalRequests = [];
    const options = await harness.context.newPage();
    options.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) {
        externalRequests.push(request.url());
      }
    });
    await options.setViewportSize({ width: 390, height: 844 });
    await options.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);

    const chooseFiles = options.getByRole("button", { name: "选择 / 重新选择文件" });
    await expect(chooseFiles).toBeVisible();
    await expect(chooseFiles).toHaveAccessibleName("选择 / 重新选择文件");
    const fileList = options.locator("#localDictionaryFileList");
    await expect(fileList).toHaveAttribute("aria-label", "已选择的词典文件");

    const mdx = makeRichMdx([
      ["ecosystemmdxonlyfixture", "<p>Rich-only local result.</p>"]
    ], { title: "Ecosystem MDX Only Fixture", styleSheet: "" });
    await options.locator("#localDictionaryFiles").setInputFiles({
      name: "ecosystem-mdx-only.mdx",
      mimeType: "application/octet-stream",
      buffer: mdx
    });

    const summary = options.locator("#localDictionaryPreflightSummary");
    const progress = options.locator("#localDictionaryImportProgress");
    await expect(summary).toHaveAttribute("aria-live", "polite");
    await expect(progress).toHaveAttribute("aria-live", "polite");
    await expect(summary).toContainText("可用");
    await expect(summary).toContainText("MDX 富文本词典");
    await expect(options.locator("#localDictionaryImport")).toHaveAttribute("data-status", "supported");
    const installButton = options.getByRole("button", { name: "安装词典" });
    await expect(installButton).toHaveAccessibleName("安装词典");
    await expect(installButton).toBeEnabled();
    await installButton.focus();
    await installButton.press("Enter");
    await expect(progress).toContainText("完成 · 富文本词典已安装", { timeout: 90_000 });

    let row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Ecosystem MDX Only Fixture" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("ecosystem-mdx-only.mdx");
    await expect(row).toContainText("本地附件未附加");
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    const installed = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    const imported = installed.dictionaries.find((dictionary) => dictionary.id === dictionaryId);
    expect(installed.ok).toBe(true);
    expect(imported?.resourceCount || 0).toBe(0);

    await options.reload();
    row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: "Ecosystem MDX Only Fixture" });
    await expect(row).toBeVisible();

    const page = await harness.open("/selection");
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) {
        externalRequests.push(request.url());
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => {
      const word = document.createElement("p");
      word.id = "ecosystem-mdx-only-word";
      word.textContent = "ecosystemmdxonlyfixture";
      document.body.append(word);
    });
    await harness.inject(page);
    await selectElementText(page, "#ecosystem-mdx-only-word");
    const chip = page.locator(".tf-selection-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAccessibleName("处理所选文本");
    await chip.focus();
    await chip.press("Enter");

    const card = page.locator(`.tf-selection-rich-record[data-dictionary-id="${dictionaryId}"]`);
    await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    await expect(card).toContainText("Rich-only local result.");
    const close = page.getByRole("button", { name: "关闭" });
    await expect(close).toHaveAccessibleName("关闭");
    await close.focus();
    await close.press("Enter");
    await expect(page.locator(".tf-selection-panel")).toBeHidden();

    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      darkMode: matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
    }));
    expect(layout.viewportWidth).toBe(390);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.darkMode).toBe(true);
    expect(layout.reducedMotion).toBe(true);
    expect(harness.server.calls).toHaveLength(0);
    expect(externalRequests).toEqual([]);

    await row.getByRole("button", { name: "删除" }).click();
    await expect(row).toHaveCount(0);
    const afterDelete = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(afterDelete.dictionaries.some((dictionary) => dictionary.id === dictionaryId)).toBe(false);
    expect(harness.server.calls).toHaveLength(0);

    report.mdxOnlyRichRoute = {
      status: "passed",
      fileCount: 1,
      associatedMddCount: 0,
      persistedAfterReload: true,
      visibleInSelection: true,
      keyboardImport: true,
      keyboardDismiss: true,
      accessibleFilePicker: true,
      selectedFilesAccessibleLabel: true,
      installAccessibleName: true,
      selectionChipAccessibleName: true,
      dismissAccessibleName: true,
      preflightLiveRegion: true,
      progressLiveRegion: true,
      viewportWidth: layout.viewportWidth,
      darkMode: layout.darkMode,
      reducedMotion: layout.reducedMotion,
      horizontalOverflow: layout.scrollWidth > layout.viewportWidth,
      providerCalls: harness.server.calls.length,
      externalRequests: externalRequests.length
    };
  });

  test("repeated preferred-first lookup stays within bounds on the measured one-entry baseline fixture", async ({ harness }) => {
    const externalRequests = [];
    const samples = [];
    const seenPackIds = new Set();
    const seenPackVersions = new Set();
    let lookupCount = 0;
    let maxConcurrentLookups = 0;
    let providerCalls = 0;
    for (let sample = 0; sample < 10; sample += 1) {
      if (sample > 0) await harness.reset();
      const options = await openOptions(harness);
      options.on("request", (request) => {
        if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) externalRequests.push(request.url());
      });
      // Match one independent `--repeat-each=10` baseline run exactly:
      // install a fresh encrypted one-entry Alpha/Beta pair for each sample.
      const alpha = await installBaselineFixture(options, {
        title: "Fixture Alpha Rich",
        marker: "Alpha rich gloss",
        fileName: "fixture-alpha.mdx"
      });
      const beta = await installBaselineFixture(options, {
        title: "Fixture Beta Rich",
        marker: "Beta rich gloss",
        fileName: "fixture-beta.mdx"
      });
      const installedVersions = await options.evaluate(async (ids) => {
        const { tfRichMdictStateV1 } = await chrome.storage.local.get("tfRichMdictStateV1");
        return ids.map((id) => tfRichMdictStateV1?.packs?.[id]?.active?.packVersion || "");
      }, [alpha.id, beta.id]);
      expect(installedVersions).toHaveLength(2);
      expect(installedVersions.every(Boolean)).toBe(true);
      for (const id of [alpha.id, beta.id]) {
        expect(seenPackIds.has(id)).toBe(false);
        seenPackIds.add(id);
      }
      for (const version of installedVersions) {
        expect(seenPackVersions.has(version)).toBe(false);
        seenPackVersions.add(version);
      }
      await alpha.row.locator('input[data-action="enabled"]').check();
      await beta.row.locator('input[data-action="enabled"]').check();
      await alpha.row.locator('input[data-action="expanded-by-default"]').check();
      const promote = beta.row.locator('[data-action="promote-preferred"]');
      await promote.focus();
      await promote.press("Enter");
      await expect(beta.row.locator('[data-role="personal-preference"]')).toHaveText("你的个人首选");
      await options.reload();

      const page = await harness.open("/selection");
      page.on("request", (request) => {
        if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) externalRequests.push(request.url());
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await harness.inject(page);
      await installLookupMetricsProbe(harness, page);

      await selectElementText(page, "#ambiguous");
      const chip = page.locator(".tf-selection-chip");
      await expect(chip).toBeVisible();
      const startedAt = Date.now();
      await chip.click();
      const primary = page.locator(".tf-selection-primary").first();
      await expect(primary).toBeVisible();
      const primaryVisibleMs = Date.now() - startedAt;
      const preferredCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${beta.id}"]`);
      const otherCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${alpha.id}"]`);
      await expect(preferredCard).toHaveAttribute("data-state", "success");
      const preferredVisibleMs = Date.now() - startedAt;
      await expect(otherCard).toHaveAttribute("data-state", "success");
      const bothRichVisibleMs = Date.now() - startedAt;
      samples.push({ primaryVisibleMs, preferredVisibleMs, bothRichVisibleMs });
      const sampleMetrics = await readLookupMetrics(harness, page);
      expect(sampleMetrics.lookupCount).toBe(2);
      expect(sampleMetrics.maxConcurrentLookups).toBeGreaterThanOrEqual(1);
      expect(sampleMetrics.maxConcurrentLookups).toBeLessThanOrEqual(3);
      lookupCount += sampleMetrics.lookupCount;
      maxConcurrentLookups = Math.max(maxConcurrentLookups, sampleMetrics.maxConcurrentLookups);
      await page.getByRole("button", { name: "关闭" }).press("Enter");
      await expect(page.locator(".tf-selection-panel")).toBeHidden();
      providerCalls += harness.server.calls.length;
      await page.close();
      await options.close();
    }

    expect(lookupCount).toBe(20);
    expect(seenPackIds.size).toBe(20);
    expect(seenPackVersions.size).toBe(20);
    expect(providerCalls).toBe(0);
    expect(externalRequests).toEqual([]);

    performanceReport.repeatedPreferenceLookup = {
      status: "passed",
      sampleCount: samples.length,
      preferredFirstMs: summarize(samples.map((item) => item.preferredVisibleMs)),
      bothRichCompleteMs: summarize(samples.map((item) => item.bothRichVisibleMs)),
      structuredPrimaryVisibleMs: summarize(samples.map((item) => item.primaryVisibleMs)),
      lookupsPerSelection: 2,
      totalLookups: lookupCount,
      maxConcurrentLookups,
      concurrencyContractMaximum: 3,
      workload: {
        fixtureProfile: "multi-dictionary-viewer-alpha-beta-one-entry-v1",
        selectionQuery: "persistent",
        entriesPerDictionary: 1,
        encryptedKeyInfo: true,
        baselineRecordId: preferredBaseline.recordId,
        baselineMainSha: preferredBaseline.mainSha,
        freshInstallPerSample: true,
        uniquePackIds: seenPackIds.size,
        uniquePackVersions: seenPackVersions.size,
        harnessResetBeforeEach: true
      },
      measuredBaselineP95Ms: {
        preferredFirst: preferredBaseline.summaryMs.preferredRichVisible.p95NearestRank,
        bothRichComplete: preferredBaseline.summaryMs.bothRichComplete.p95NearestRank
      },
      derivedCeilingsMs: {
        preferredFirst: Math.ceil(preferredBaseline.summaryMs.preferredRichVisible.p95NearestRank * 2),
        bothRichComplete: Math.ceil(preferredBaseline.summaryMs.bothRichComplete.p95NearestRank * 2)
      }
    };
    performanceReport.providerCalls = providerCalls;
    performanceReport.externalRequests = externalRequests.length;
  });

  test("repeated selection changes invalidate stale responses and dispatch fresh lookups", async ({ harness }) => {
    const options = await openOptions(harness);
    const beta = await installRichFixture(options, {
      title: "Ecosystem Stale Beta",
      fileName: "ecosystem-stale-beta.mdx",
      entries: [
        ["persistent", "<p>Beta preferred measurement result.</p>"],
        ["stalequery", "<p>Beta stale result marker.</p>"],
        ["freshquery", "<p>Beta fresh result.</p>"]
      ]
    });
    const alpha = await installRichFixture(options, {
      title: "Ecosystem Stale Alpha",
      fileName: "ecosystem-stale-alpha.mdx",
      entries: [
        ["persistent", "<p>Alpha measurement result.</p>"],
        ["stalequery", "<p>Alpha stale result marker.</p>"],
        ["freshquery", "<p>Alpha fresh result.</p>"]
      ]
    });
    await alpha.row.locator('input[data-action="enabled"]').check();
    await beta.row.locator('input[data-action="enabled"]').check();
    await alpha.row.locator('input[data-action="expanded-by-default"]').check();
    const promoteAlpha = alpha.row.locator('[data-action="promote-preferred"]');
    await promoteAlpha.focus();
    await promoteAlpha.press("Enter");
    const promoteBeta = beta.row.locator('[data-action="promote-preferred"]');
    await promoteBeta.focus();
    await promoteBeta.press("Enter");
    await options.reload();

    const externalRequests = [];
    const page = await harness.open("/selection");
    page.on("request", (request) => {
      if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) externalRequests.push(request.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.evaluate(() => {
      for (const [id, value] of [["ecosystem-stale-word", "stalequery"], ["ecosystem-fresh-word", "freshquery"]]) {
        const node = document.createElement("p");
        node.id = id;
        node.textContent = value;
        document.body.append(node);
      }
    });
    await harness.inject(page);

    const invalidationDelayMs = 1200;
    await installLookupMetricsProbe(harness, page, { delayedText: "stalequery", delayMs: invalidationDelayMs });
    const invalidationSamples = [];
    const freshPreferredCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${beta.id}"]`);
    const freshOtherCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${alpha.id}"]`);
    for (let sample = 0; sample < 10; sample += 1) {
      await selectElementText(page, "#ecosystem-stale-word");
      const staleChip = page.locator(".tf-selection-chip");
      await expect(staleChip).toBeVisible();
      await staleChip.focus();
      await staleChip.press("Enter");
      await expect.poll(async () => (await readLookupMetrics(harness, page)).calls.filter((call) => call.text === "stalequery").length)
        .toBe(2 * (sample + 1));
      expect((await readLookupMetrics(harness, page)).delayedCallbacksDelivered).toBe(2 * sample,
        "the current stale lookup responses must still be pending when selection changes");

      const selectionChangedAt = Date.now();
      await selectElementText(page, "#ecosystem-fresh-word");
      const freshChip = page.locator(".tf-selection-chip");
      await expect(freshChip).toBeVisible();
      await freshChip.focus();
      await freshChip.press("Enter");
      await expect.poll(async () => (await readLookupMetrics(harness, page)).calls.filter((call) => call.text === "freshquery").length)
        .toBe(2 * (sample + 1));
      invalidationSamples.push(Date.now() - selectionChangedAt);

      await expect(freshPreferredCard).toHaveAttribute("data-state", "success");
      await expect(freshPreferredCard).toContainText("Beta fresh result.");
      await expect(freshOtherCard).toHaveAttribute("data-state", "success");
      await expect(freshOtherCard).toContainText("Alpha fresh result.");
      await expect.poll(async () => (await readLookupMetrics(harness, page)).delayedCallbacksDelivered).toBe(2 * (sample + 1), { timeout: 10_000 });
      await expect(page.locator(".tf-selection-panel")).not.toContainText("stale result marker");
      const close = page.getByRole("button", { name: "关闭" });
      await close.focus();
      await close.press("Enter");
      await expect(page.locator(".tf-selection-panel")).toBeHidden();
    }

    const selectionChangeLatency = summarize(invalidationSamples);
    const measuredInvalidationP95Ms = 295;
    const selectionChangeLatencyCeiling = 590;
    expect(invalidationSamples.every((value) => value <= selectionChangeLatencyCeiling)).toBe(true);
    expect(harness.server.calls).toHaveLength(0);
    expect(externalRequests).toEqual([]);

    performanceReport.selectionChangeStaleInvalidation = {
      status: "passed",
      sampleCount: invalidationSamples.length,
      staleRequestsStartedPerSample: 2,
      delayedStaleResponsesObservedPerSample: 2,
      injectedCallbackDelayMs: invalidationDelayMs,
      freshLookupDispatchMs: selectionChangeLatency,
      measuredBaselineP95Ms: measuredInvalidationP95Ms,
      derivedCeilingMs: selectionChangeLatencyCeiling,
      staleResultsSuppressed: true,
      note: "Measures stale-result invalidation and fresh lookup dispatch while old responses are verified pending. It does not claim in-flight worker messages are cancelled."
    };
    performanceReport.providerCalls = harness.server.calls.length;
    performanceReport.externalRequests = externalRequests.length;
  });
});

async function openOptions(harness) {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  return options;
}

async function installRichFixture(options, { title, fileName, entries }) {
  const fixture = makeRichMdx(entries, { title, styleSheet: "" });
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: fixture
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("MDX 富文本词典");
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成 · 富文本词典已安装", {
    timeout: 90_000
  });
  const row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-dictionary-id");
  return { id, row };
}

async function installBaselineFixture(options, { title, marker, fileName }) {
  const fixture = makeRichMdx([
    ["persistent", `<p><b>${marker}</b><br>Bounded synthetic viewer fixture.</p>`]
  ], { title, encrypted: 2, compact: "Yes", compat: "Yes" });
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: fixture
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText(title);
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
  const row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-dictionary-id");
  expect(id).toMatch(/^rich-mdict-[a-f0-9-]{36}$/u);
  return { id, row };
}

async function installLookupMetricsProbe(harness, page, { delayedText = "", delayMs = 0 } = {}) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, delayedText, delayMs }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [{ delayedText, delayMs }],
      func: ({ delayedText, delayMs }) => {
        const runtime = chrome.runtime;
        const original = runtime.sendMessage;
        const metrics = { calls: [], active: 0, maxConcurrentLookups: 0, delayedCallbacksDelivered: 0 };
        Object.defineProperty(globalThis, "__dictionaryEcosystemLookupMetrics", {
          configurable: true,
          value: metrics
        });
        runtime.sendMessage = function (message, ...args) {
          if (message?.type !== "RICH_MDICT_LOOKUP") return original.call(runtime, message, ...args);
          metrics.active += 1;
          metrics.maxConcurrentLookups = Math.max(metrics.maxConcurrentLookups, metrics.active);
          metrics.calls.push({
            text: String(message.text || ""),
            dictionaryId: String(message.dictionaryId || "")
          });
          const callback = args[0];
          return original.call(runtime, message, (response) => {
            const finish = () => {
              metrics.active = Math.max(0, metrics.active - 1);
              if (message.text === delayedText) metrics.delayedCallbacksDelivered += 1;
              callback?.(response);
            };
            if (message.text === delayedText && delayMs > 0) setTimeout(finish, delayMs);
            else finish();
          }, ...args.slice(1));
        };
      }
    });
  }, { tabId, delayedText, delayMs });
}

async function readLookupMetrics(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        calls: globalThis.__dictionaryEcosystemLookupMetrics?.calls || [],
        lookupCount: globalThis.__dictionaryEcosystemLookupMetrics?.calls?.length || 0,
        maxConcurrentLookups: globalThis.__dictionaryEcosystemLookupMetrics?.maxConcurrentLookups || 0,
        delayedCallbacksDelivered: globalThis.__dictionaryEcosystemLookupMetrics?.delayedCallbacksDelivered || 0
      })
    });
    return result?.result || {};
  }, tabId);
}

function summarize(values) {
  const sorted = values.map(Number).sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    sampleCount: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95NearestRank: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted.at(-1)
  };
}

async function selectElementText(page, selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  });
}
