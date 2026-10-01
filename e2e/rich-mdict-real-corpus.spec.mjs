import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./support/extension-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(
  resolve(repoRoot, "lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"),
  "utf8"
));
const mdxPath = process.env.RICH_MDICT_REAL_MDX ||
  "";
const archiveCacheDir = process.env.RICH_MDICT_CACHE_DIR || "";
const ecdictZipPath = process.env.RICH_MDICT_REAL_ARCHIVE ||
  (archiveCacheDir ? resolve(archiveCacheDir, "ecdict-mdx-28.zip") : "");
const evidenceDir = process.env.RICH_MDICT_EVIDENCE_DIR ||
  resolve(repoRoot, "test-results/rich-mdict-evidence");
const ECDICT_RECIPE_ID = "ecdict-en-zh-mdx-curated";
const ECDICT_PACK_ID = "rich-mdict-18500000-0000-4000-8000-000000000028";
const ECDICT_PERMISSION_ORIGINS = [
  "https://github.com/*",
  "https://release-assets.githubusercontent.com/*"
];

// This compatibility file is the only E2E surface that grants release hosts.
// Its test manifest pre-grants only this exact origin pair. When the certifier
// cache is present, the temporary fixture worker bridges its real bytes locally.
test.use({
  ecdictMdxReleaseHostAccess: true,
  ecdictMdxCachedArchivePath: ecdictZipPath && existsSync(ecdictZipPath)
    ? ecdictZipPath
    : ""
});

test.describe("pinned real ECDICT rich MDict product gate", () => {
  test.setTimeout(12 * 60 * 1000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.skip(!process.env.RICH_MDICT_REAL_MDX,
    "Set RICH_MDICT_REAL_MDX in the dedicated pinned-corpus compatibility gate.");

  test("Settings install survives reload, Selection shows a real record with zero Provider calls, and delete removes it", async ({ harness }) => {
    const packageFiles = await listFiles(harness.extensionDir);
    expect(packageFiles.filter((path) => /\.(?:mdx|mdd|zip)$/iu.test(path))).toEqual([]);
    expect(harness.buildReport.totalBytes).toBeLessThan(lock.mdx.bytes);
    const productionManifest = JSON.parse(await readFile(resolve(repoRoot, "manifest.json"), "utf8"));
    expect(productionManifest.host_permissions.some((permission) => /github\.com|githubusercontent\.com/iu.test(permission))).toBe(false);

    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");

    const installStarted = Date.now();
    await options.locator("#richMdictFile").setInputFiles(mdxPath);
    await expect(options.locator("#richMdictInspectionMeta")).toContainText("简明英汉字典增强版");
    await expect(options.locator("#richMdictInspectionMeta")).toContainText("安全预览");
    await options.locator("#richMdictImportButton").click();
    await expect(options.locator("#richMdictImportProgress")).toContainText("完成", {
      timeout: 10 * 60 * 1000
    });
    const installMs = Date.now() - installStarted;

    let installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "简明英汉字典增强版"
    });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("3,402,564 条词目");
    await expect(installed).toContainText("可用");

    await options.reload();
    installed = options.locator("#richMdictInstalledList .site-row").filter({
      hasText: "简明英汉字典增强版"
    });
    await expect(installed).toBeVisible({ timeout: 30_000 });
    await expect(installed).toContainText("可用");

    const corpusLookups = [];
    for (const expected of lock.independentDecode.recordExcerpts) {
      const started = Date.now();
      const lookup = await sendOptionsRuntime(options, {
        type: "RICH_MDICT_LOOKUP",
        text: expected.query
      });
      const lookupMs = Date.now() - started;
      expect(lookup.ok, expected.query).toBe(true);
      expect(lookup.found, expected.query).toBe(true);
      const record = lookup.dictionaries.find((item) =>
        item.headword.toLowerCase() === expected.headword.toLowerCase()
      );
      expect(Boolean(record), expected.query).toBe(true);
      expect(record.text.includes(expected.rawRecordIncludes), expected.query).toBe(true);
      corpusLookups.push({
        query: expected.query,
        lookupMs,
        headword: record.headword,
        recordVerified: record.text.includes(expected.rawRecordIncludes),
        metrics: record.debugMetrics || null
      });
    }

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "rich-ecdict-word";
      node.textContent = "run";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#rich-ecdict-word");
    await page.locator(".tf-selection-chip").click();
    const primaryHasExpectedTranslation = await page.locator(".tf-selection-result .tf-selection-primary").first().evaluate(
      (node) => (node.innerText || "").includes("运行")
    );
    expect(primaryHasExpectedTranslation).toBe(true);
    const richCard = page.locator(".tf-selection-rich-record")
      .filter({ hasText: "简明英汉字典增强版" });
    await expandRichCard(richCard);
    const richViewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    const viewerContainsPinnedRecord = await richViewer.evaluate(
      (root, expectedText) => (root.innerText || "").includes(expectedText),
      "n. 跑, 赛跑, 奔跑, 奔跑的路程"
    );
    expect(viewerContainsPinnedRecord).toBe(true);
    const richCardShowsDictionaryTitle = await richCard.evaluate(
      (node) => (node.innerText || "").includes("简明英汉字典增强版")
    );
    expect(richCardShowsDictionaryTitle).toBe(true);
    expect(await page.locator(".tf-selection-result").getAttribute("data-result-kind")).toBe("local");
    expect(await page.locator(".tf-selection-result .tf-selection-primary").first().textContent()).toContain("运行");
    expect(await page.locator(".tf-selection-rich-text").last().evaluate((host) => Boolean(host.shadowRoot))).toBe(true);
    const compactPresentation = await richViewer.evaluate((root) => {
      const nodes = [...root.querySelectorAll("[data-compact-id]")];
      const forId = (id) => nodes.filter((node) => node.getAttribute("data-compact-id") === id);
      const styleOf = (node) => {
        const presentation = node?.querySelector("*") || node;
        if (!presentation) return null;
        const style = getComputedStyle(presentation);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          fontWeight: style.fontWeight,
          color: style.color,
          display: style.display
        };
      };
      const headword = forId("1").find((node) => node.textContent.includes("run"));
      const pronunciation = forId("3").find((node) => node.textContent.includes("[rʌn]"));
      const note = forId("4").find((node) => node.textContent.includes("-K5"));
      return {
        ids: [...new Set(nodes.map((node) => node.getAttribute("data-compact-id")))].sort(),
        headword: headword ? styleOf(headword) : null,
        pronunciation: pronunciation ? styleOf(pronunciation) : null,
        note: note ? styleOf(note) : null
      };
    });
    expect(compactPresentation.ids).toEqual(expect.arrayContaining(["1", "2", "3", "4"]));
    expect(compactPresentation.headword).toBeTruthy();
    expect(compactPresentation.pronunciation).toBeTruthy();
    expect(compactPresentation.note).toBeTruthy();
    expect(compactPresentation.headword.fontSize).toBeGreaterThan(15);
    expect(compactPresentation.headword.fontWeight).not.toBe("400");
    expect(compactPresentation.pronunciation.color).toBe("rgb(30, 144, 255)");
    expect(compactPresentation.note.color).toBe("rgb(119, 119, 119)");
    expect(harness.server.calls).toHaveLength(0);
    const listing = await sendOptionsRuntime(options, { type: "RICH_MDICT_LIST" });
    expect(listing.ok).toBe(true);
    const persisted = listing.dictionaries.find((item) => item.title === "简明英汉字典增强版");
    expect(persisted?.status).toBe("ready");
    expect(persisted?.entryCount).toBe(lock.mdx.entryCount);

    const report = {
      status: "pending-delete-verification",
      source: lock.source.releaseUrl,
      assetSha256: lock.archive.sha256,
      mdxSha256: lock.mdx.sha256,
      mdxBytes: lock.mdx.bytes,
      entryCount: persisted.entryCount,
      keyBlockCount: lock.mdx.keyBlockCount,
      recordBlockCount: lock.mdx.recordBlockCount,
      encryptedKeyInfo: lock.mdx.encrypted === 2,
      extensionPackageBytes: harness.buildReport.totalBytes,
      installMs,
      corpusLookups,
      richViewer: {
        shadowRoot: true,
        structuredPrimary: "local",
        compactPresentation: {
          ids: compactPresentation.ids,
          headword: compactPresentation.headword,
          pronunciation: compactPresentation.pronunciation,
          note: compactPresentation.note
        },
        providerCalls: harness.server.calls.length
      },
      providerCalls: harness.server.calls.length,
      generatedAt: new Date().toISOString()
    };

    await installed.getByRole("button", { name: "删除" }).click();
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装", {
      timeout: 30_000
    });
    const afterDelete = await sendOptionsRuntime(options, { type: "RICH_MDICT_LOOKUP", text: "run" });
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    expect(afterDelete.dictionaries).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);

    report.status = "PASS";
    report.deleted = true;
    report.providerCallsAfterDelete = harness.server.calls.length;
    report.generatedAt = new Date().toISOString();
    await writeFile(resolve(evidenceDir, "ecdict-real-corpus-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[RICH_MDICT_REAL_CORPUS]", JSON.stringify(report));
  });
});

test.describe("curated ECDICT MDX one-click real archive gate", () => {
  test.setTimeout(15 * 60 * 1000);
  test.skip(
    process.env.ECDICT_MDX_ONE_CLICK_GATE !== "1",
    "Set ECDICT_MDX_ONE_CLICK_GATE=1 after the corpus certifier has cached ecdict-mdx-28.zip."
  );

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("the Settings card requests the exact host pair, installs/reinstalls the real archive, preserves the active version on failure/cancel, works offline, and deletes", async ({ harness }) => {
    expect(ecdictZipPath, "Set RICH_MDICT_CACHE_DIR or RICH_MDICT_REAL_ARCHIVE.").not.toBe("");
    expect(existsSync(ecdictZipPath), `Cached archive not found: ${ecdictZipPath}`).toBe(true);
    const archiveBytes = await readFile(ecdictZipPath);
    const archiveLock = lock.archive;
    expect(archiveBytes.byteLength).toBe(archiveLock.bytes);
    expect(createHash("sha256").update(archiveBytes).digest("hex")).toBe(archiveLock.sha256);

    const options = await harness.context.newPage();
    await options.addInitScript(() => {
      const permissionStoreKey = "tfEcdictPermissionRequests";
      let permissionRequests = [];
      try {
        permissionRequests = JSON.parse(sessionStorage.getItem(permissionStoreKey) || "[]");
      } catch {}
      window.__tfEcdictPermissionRequests = permissionRequests;
      const nativeRequest = chrome.permissions.request.bind(chrome.permissions);
      chrome.permissions.request = async (details) => {
        const granted = await nativeRequest(details);
        window.__tfEcdictPermissionRequests.push({ details, granted });
        sessionStorage.setItem(permissionStoreKey, JSON.stringify(window.__tfEcdictPermissionRequests));
        return granted;
      };

      window.__tfEcdictWorkerEvents = [];
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args);
          const url = String(args[0] || "");
          if (!url.endsWith("/src/options/workers/curated-ecdict-mdx-worker.js")) {
            return worker;
          }
          const nativeAdd = worker.addEventListener.bind(worker);
          const nativeRemove = worker.removeEventListener.bind(worker);
          const wrappedListeners = new WeakMap();
          worker.addEventListener = (type, listener, listenerOptions) => {
            if (type !== "message" || typeof listener !== "function") {
              return nativeAdd(type, listener, listenerOptions);
            }
            const wrapped = (event) => {
              const message = event.data || {};
              window.__tfEcdictWorkerEvents.push({
                type: message.type || "",
                phase: message.phase || "",
                redirected: message.metadata?.redirected,
                finalOrigin: message.metadata?.finalOrigin || "",
                error: message.error || ""
              });
              if (window.__tfEcdictWorkerEvents.length > 60) {
                window.__tfEcdictWorkerEvents.shift();
              }
              listener.call(worker, event);
            };
            wrappedListeners.set(listener, wrapped);
            return nativeAdd(type, wrapped, listenerOptions);
          };
          worker.removeEventListener = (type, listener, listenerOptions) =>
            nativeRemove(type, wrappedListeners.get(listener) || listener, listenerOptions);
          return worker;
        }
      });
    });
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const row = options.locator(
      `#curatedDictionaryList [data-recipe-id="${ECDICT_RECIPE_ID}"]`
    );
    if (!(await row.count())) {
      const diagnostics = await options.evaluate(async () => {
        const recipes = await import(chrome.runtime.getURL("src/shared/curated-dictionaries.js"));
        const [status, rich] = await Promise.all([
          chrome.runtime.sendMessage({ type: "DICTIONARY_PACK_STATUS" }),
          chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" })
        ]);
        return {
          curatedIds: recipes.CURATED_DICTIONARIES.map((source) => source.id),
          status,
          rich,
          listText: document.querySelector("#curatedDictionaryList")?.innerText || ""
        };
      });
      throw new Error(`ECDICT card did not render: ${JSON.stringify(diagnostics)}`);
    }
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-pack-id", ECDICT_PACK_ID);
    await expect(row.locator("[data-action='install']")).toBeVisible();

    const installStarted = Date.now();
    await row.locator("[data-action='install']").click();
    await waitForCuratedMdxInstall(options, row, "initial install");
    const initialInstallMs = Date.now() - installStarted;
    await expect(row.locator("[data-action='reinstall']")).toBeVisible();
    await expect(row.locator("[data-action='delete']")).toBeVisible();

    const initial = await listCuratedEcdict(options);
    expect(initial).toBeTruthy();
    expect(initial.status, JSON.stringify(initial)).toBe("ready");
    expect(initial.curated?.recipeId).toBe(ECDICT_RECIPE_ID);
    const initialVersion = initial.packVersion;
    const afterInitialInstallPermissions = await readEcdictPermissionRequests(options);
    expect(afterInitialInstallPermissions).toEqual([
      { details: { origins: ECDICT_PERMISSION_ORIGINS }, granted: true }
    ]);
    const initialArchiveRequest = harness.server.ecdictMdxArchiveRequests[0];
    expect(initialArchiveRequest?.path).toBe("/__e2e/ecdict-mdx-28.zip");
    expect(initialArchiveRequest?.origin).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    expect(initialArchiveRequest?.mode).toBe("archive");
    expect(initialArchiveRequest?.finishedAt).toBeTruthy();
    const firstDownloaderReady = await options.evaluate(() =>
      window.__tfEcdictWorkerEvents.find((event) => event.type === "curated-ecdict-mdx:ready") || null
    );
    expect(firstDownloaderReady).toMatchObject({
      redirected: true,
      finalOrigin: "https://release-assets.githubusercontent.com"
    });

    harness.server.setEcdictMdxArchiveMode("failure");
    await row.locator("[data-action='reinstall']").click();
    await expect(row.locator('[aria-live="polite"]')).toContainText(/HTTP 503|upstream unavailable|asset unavailable/iu, {
      timeout: 30_000
    });
    await expect.poll(async () => (await listCuratedEcdict(options))?.packVersion)
      .toBe(initialVersion);
    await expect.poll(async () => (await lookupEcdict(options, "run"))?.found)
      .toBe(true);

    harness.server.setEcdictMdxArchiveMode("cancel");
    await row.locator("[data-action='reinstall']").click();
    await expect.poll(() => harness.server.ecdictMdxArchiveRequests.length)
      .toBe(3);
    expect(harness.server.ecdictMdxArchiveRequests.at(-1)?.mode).toBe("cancel");
    await expect(row.locator("[data-action='cancel']")).toBeVisible();
    await row.locator("[data-action='cancel']").click();
    await expect(row.locator('[aria-live="polite"]')).toContainText("安装已取消", {
      timeout: 30_000
    });
    await expect.poll(async () => (await listCuratedEcdict(options))?.packVersion)
      .toBe(initialVersion);
    await expect.poll(async () => (await lookupEcdict(options, "run"))?.found)
      .toBe(true);

    harness.server.setEcdictMdxArchiveMode("archive");
    const reinstallStarted = Date.now();
    const reinstallEventOffset = await options.evaluate(() =>
      window.__tfEcdictWorkerEvents?.length || 0
    );
    await row.locator("[data-action='reinstall']").click();
    await waitForCuratedMdxInstall(options, row, "reinstall", reinstallEventOffset);
    const reinstallMs = Date.now() - reinstallStarted;
    const afterReinstall = await listCuratedEcdict(options);
    expect(afterReinstall?.status).toBe("ready");
    expect(afterReinstall?.packVersion).not.toBe(initialVersion);
    expect(afterReinstall?.curated?.mdxSha256).toBe(lock.mdx.sha256);
    expect(harness.server.ecdictMdxArchiveRequests.map((item) => item.mode)).toEqual([
      "archive",
      "failure",
      "cancel",
      "archive"
    ]);
    const downloaderReadyMessages = await options.evaluate(() =>
      (window.__tfEcdictWorkerEvents || []).filter((event) => event.type === "curated-ecdict-mdx:ready")
    );
    expect(downloaderReadyMessages.length).toBeGreaterThanOrEqual(1);
    expect(downloaderReadyMessages.at(-1)?.type).toBe("curated-ecdict-mdx:ready");
    expect(downloaderReadyMessages.every((event) =>
      event.redirected === true &&
      event.finalOrigin === "https://release-assets.githubusercontent.com"
    )).toBe(true);

    await options.reload();
    const reloadedRow = options.locator(
      `#curatedDictionaryList [data-recipe-id="${ECDICT_RECIPE_ID}"]`
    );
    await expect(reloadedRow.locator("[data-action='reinstall']")).toBeVisible();
    const lookup = await lookupEcdict(options, "run");
    expect(lookup.ok).toBe(true);
    expect(lookup.found).toBe(true);
    const runRecord = lookup.dictionaries.find((item) => item.headword.toLowerCase() === "run");
    expect(Boolean(runRecord?.text?.includes("n. 跑, 赛跑, 奔跑, 奔跑的路程"))).toBe(true);
    expect(harness.server.calls).toHaveLength(0);

    const selection = await harness.open("/selection");
    await selection.evaluate(() => {
      const word = document.createElement("p");
      word.id = "curated-ecdict-mdx-word";
      word.textContent = "run";
      document.body.appendChild(word);
    });
    await harness.inject(selection);
    await selectElementText(selection, "#curated-ecdict-mdx-word");
    await selection.locator(".tf-selection-chip").click();
    const curatedPrimaryHasExpectedTranslation = await selection.locator(".tf-selection-result .tf-selection-primary").first().evaluate(
      (node) => (node.innerText || "").includes("运行")
    );
    expect(curatedPrimaryHasExpectedTranslation).toBe(true);
    await expect(selection.locator(".tf-selection-result .tf-selection-primary").first())
      .toContainText("运行");
    const richCard = selection.locator(".tf-selection-rich-record")
      .filter({ hasText: "简明英汉字典增强版" });
    await expandRichCard(richCard);
    const curatedRichCardShowsDictionaryTitle = await richCard.evaluate(
      (node) => (node.innerText || "").includes("简明英汉字典增强版")
    );
    expect(curatedRichCardShowsDictionaryTitle).toBe(true);
    const curatedViewer = richCard.locator(".tf-selection-rich-text .tf-rich-viewer");
    const curatedViewerContainsPinnedRecord = await curatedViewer.evaluate(
      (root, expectedText) => (root.innerText || "").includes(expectedText),
      "n. 跑, 赛跑, 奔跑, 奔跑的路程"
    );
    expect(curatedViewerContainsPinnedRecord).toBe(true);
    expect(await selection.locator(".tf-selection-result").getAttribute("data-result-kind"))
      .toBe("local");
    expect(harness.server.calls).toHaveLength(0);

    const permissionRequests = await readEcdictPermissionRequests(options);
    expect(permissionRequests).toEqual([
      { details: { origins: ECDICT_PERMISSION_ORIGINS }, granted: true },
      { details: { origins: ECDICT_PERMISSION_ORIGINS }, granted: true },
      { details: { origins: ECDICT_PERMISSION_ORIGINS }, granted: true },
      { details: { origins: ECDICT_PERMISSION_ORIGINS }, granted: true }
    ]);

    await reloadedRow.locator("[data-action='delete']").click();
    await expect(reloadedRow.locator("[data-action='install']")).toBeVisible();
    const afterDelete = await lookupEcdict(options, "run");
    expect(afterDelete.ok).toBe(true);
    expect(afterDelete.found).toBe(false);
    expect(afterDelete.dictionaries).toEqual([]);
    expect(harness.server.calls).toHaveLength(0);

    const report = {
      status: "PASS",
      archiveBytes: archiveBytes.byteLength,
      archiveSha256: archiveLock.sha256,
      mdxBytes: lock.mdx.bytes,
      mdxSha256: lock.mdx.sha256,
      entryCount: lock.mdx.entryCount,
      permissionOrigins: ECDICT_PERMISSION_ORIGINS,
      permissionGrant: "The temporary Playwright manifest pregrants these two exact origins; chrome.permissions.request is still called and returns true.",
      testOnlyArchiveBridge: {
        localRequests: harness.server.ecdictMdxArchiveRequests.map(({ origin, path, mode }) => ({ origin, path, mode })),
        pinnedFinalOrigin: "https://release-assets.githubusercontent.com"
      },
      initialInstallMs,
      reinstallMs,
      failedAndCancelledReinstallsPreservedVersion: true,
      offlineLookup: "run",
      providerCalls: harness.server.calls.length,
      deleted: afterDelete.dictionaries.length === 0,
      generatedAt: new Date().toISOString()
    };
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(resolve(evidenceDir, "ecdict-one-click-real-archive-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[ECDICT_MDX_ONE_CLICK_REAL_ARCHIVE]", JSON.stringify(report));
  });
});

async function sendOptionsRuntime(options, message) {
  return options.evaluate((input) => chrome.runtime.sendMessage(input), message);
}

async function listCuratedEcdict(options) {
  const response = await sendOptionsRuntime(options, { type: "RICH_MDICT_LIST" });
  return response.dictionaries?.find((item) => item.id === ECDICT_PACK_ID) || null;
}

async function lookupEcdict(options, text) {
  return sendOptionsRuntime(options, { type: "RICH_MDICT_LOOKUP", text });
}

async function readEcdictPermissionRequests(options) {
  return options.evaluate(() => window.__tfEcdictPermissionRequests || []);
}

async function waitForCuratedMdxInstall(options, row, phase, eventOffset = 0) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastReport = "";
  while (Date.now() < deadline) {
    const [detail, permissions, events] = await Promise.all([
      row.locator('[aria-live="polite"]').textContent(),
      readEcdictPermissionRequests(options),
      options.evaluate(() => window.__tfEcdictWorkerEvents || [])
    ]);
    const normalized = String(detail || "").trim();
    const currentEvents = events.slice(eventOffset);
    if (normalized.includes("已安装审核版本 1.0.28")) return;
    if (
      normalized.includes("未授予") ||
      currentEvents.some((event) => event.type === "curated-ecdict-mdx:error")
    ) {
      throw new Error(`ECDICT ${phase} stopped before READY: ${JSON.stringify({ detail: normalized, permissions, events: currentEvents.slice(-12) })}`);
    }
    const report = JSON.stringify({ detail: normalized, permissions, events: currentEvents.slice(-12) });
    if (report !== lastReport) {
      console.log(`[ECDICT_MDX_GATE_PROGRESS:${phase}]`, report);
      lastReport = report;
    }
    await options.waitForTimeout(5_000);
  }
  throw new Error(`ECDICT ${phase} timed out: ${JSON.stringify({
    detail: await row.locator('[aria-live="polite"]').textContent(),
    permissions: await readEcdictPermissionRequests(options),
    events: await options.evaluate(() => (window.__tfEcdictWorkerEvents || []).slice(-12))
  })}`);
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function expandRichCard(card) {
  await expect(card).toBeVisible({ timeout: 90_000 });
  if (!await card.evaluate((node) => node.open)) {
    await card.locator("summary").click();
  }
  await expect(card).toHaveAttribute("data-state", "success", { timeout: 90_000 });
}

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}
