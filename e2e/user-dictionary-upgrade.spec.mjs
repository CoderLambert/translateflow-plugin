import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { defaultArtifact, prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { startMockServer } from "./support/mock-server.mjs";
import { buildLocalIndexedTflex } from "../src/background/packs/importers/tflex-local-builder.js";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";

const oldArtifact = process.env.TF_USER_DICTIONARY_OLD_ARTIFACT || "";
const sha256 = value => createHash("sha256").update(value).digest("hex");
const reading = (page, method, body = {}) => page.evaluate(request => chrome.runtime.sendMessage(request),
  { protocolVersion: 2, method, ...body });

// This supplements the fixed pre-WXT upgrade test with the actual previous main
// package. Equal versions deliberately prove same-ID storage continuity only;
// they do not exercise Chrome's version-change onInstalled event.
test("previous main user dictionaries survive same-ID package replacement with settings, cache and Reading intact", async ({}, info) => {
  test.skip(!oldArtifact, "Set TF_USER_DICTIONARY_OLD_ARTIFACT to the actual previous-main WXT package.");
  test.setTimeout(180_000);
  const temporary = await mkdtemp(join(tmpdir(), "tf-user-dictionary-upgrade-"));
  const extensionDir = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer();
  let context, driver, extensionId;
  const externalRequests = [];
  async function launch(profilePath = profile) {
    context = await chromium.launchPersistentContext(profilePath, { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`] });
    await context.route(/^https?:/u, route => {
      if (new URL(route.request().url()).origin === server.baseUrl) return route.continue();
      externalRequests.push(new URL(route.request().url()).origin); return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    if (extensionId) expect(id).toBe(extensionId); else extensionId = id;
    driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    return worker;
  }
  async function options() {
    const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/options.html#dictionary-packs`); return page;
  }
  async function inspect() {
    return driver.evaluate(async () => {
      const storage = await chrome.storage.local.get(null), opfs = [], databases = [];
      async function walk(directory, prefix = "") {
        for await (const [name, handle] of directory.entries()) {
          const path = prefix + name;
          if (handle.kind === "directory") await walk(handle, path + "/");
          else {
            const file = await handle.getFile(), digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            opfs.push({ path, bytes: file.size, sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("") });
          }
        }
      }
      await walk(await navigator.storage.getDirectory()); opfs.sort((a, b) => a.path.localeCompare(b.path));
      for (const info of (await indexedDB.databases()).sort((a, b) => a.name.localeCompare(b.name))) {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(info.name, info.version);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        const stores = {};
        for (const name of [...db.objectStoreNames].sort()) stores[name] = await new Promise((resolve, reject) => {
          const request = db.transaction(name, "readonly").objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        databases.push({ name: info.name, version: info.version, stores }); db.close();
      }
      return { storage, opfs, databases };
    });
  }
  async function installRich(page, title, stem) {
    const mdx = makeRichMdx([["upgradeuserword", `<p>${title} synthetic definition</p>`]], { title, styleSheet: "" });
    const mdd = makeMdd([["\\media\\upgrade.css", Buffer.from(`.upgrade { color: #123456; } /* ${stem} */`)]]);
    await page.locator("#localDictionaryFiles").setInputFiles([
      { name: `${stem}.mdx`, mimeType: "application/octet-stream", buffer: mdx },
      { name: `${stem}.mdd`, mimeType: "application/octet-stream", buffer: mdd }
    ]);
    await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
    await page.locator("#localDictionaryImportButton").click();
    await expect(page.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
    const row = page.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: title });
    await expect(row).toBeVisible(); await expect(row).toContainText("MDD");
    return { id: await row.getAttribute("data-dictionary-id"), row, mddSha256: sha256(mdd) };
  }
  async function contentRequest(page, request) {
    const tabId = await driver.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    return driver.evaluate(async ({ tabId, request }) => {
      const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [request],
        func: request => chrome.runtime.sendMessage(request) });
      return result.result;
    }, { tabId, request });
  }
  try {
    const oldManifest = JSON.parse(await readFile(join(oldArtifact, "manifest.json"), "utf8"));
    const newManifest = JSON.parse(await readFile(join(defaultArtifact, "manifest.json"), "utf8"));
    const oldReport = await prepareExtensionTestCopy({ artifact: oldArtifact, extensionDir, generation: "current", baseUrl: server.baseUrl });
    await launch();
    await expect.poll(() => driver.evaluate(() => chrome.storage.local.get(["uiLocale"]))).toEqual({ uiLocale: "zh_CN" });
    const glossary = { version: 1, entries: [{ id: "upgrade-glossary", source: "upgradeglossary", target: "升级术语", enabled: true, caseSensitive: false }] };
    await driver.evaluate(({ glossary, baseUrl }) => chrome.storage.local.set({ dictionaryEnabled: true, glossary,
      siteGlossaries: { version: 1, sites: {} }, provider: "openai-compatible", targetLanguage: "Simplified Chinese",
      openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "upgrade-local-test-model" },
      providerConnectionsVersion: 1,
      providerConnections: { "openai-compatible": { id: "openai-compatible", revision: 1, name: "Upgrade synthetic provider", platform: "custom",
        protocol: "openai-chat", baseUrl: `${baseUrl}/v1`, credentialId: "openai-compatible", defaultModel: "upgrade-local-test-model",
        settings: { streaming: false, outputTokens: 4096, temperature: null, reasoning: "", allowEmptyApiKey: true, allowInsecureHttp: true } } },
      providerCredentials: { "openai-compatible": "" }, defaultService: { kind: "api-key", connectionId: "openai-compatible" },
      autoSites: [], cacheRestoreSites: [], quickControlSites: [], quickControlHiddenSites: [] }), { glossary, baseUrl: server.baseUrl });

    let settings = await options();
    const pack = await buildLocalIndexedTflex({ packId: "local-upgrade-user-fixture", packVersion: "fixture-v1", sourceEntryCount: 1,
      sources: [{ id: "upgrade-synthetic", version: "fixture-v1", provenance: "Project-owned synthetic upgrade fixture" }], cryptoProvider: webcrypto,
      records: [{ lookupKey: "upgradeuserword", exactLookupKeys: ["upgradeuserword"], displayForm: "upgradeuserword", aliases: [], kind: "lexical",
        senses: [{ id: "upgrade:1", translations: ["用户词典升级保留释义"], sourceRefs: [{ sourceId: "upgrade-synthetic", recordId: "1" }] }] }] });
    await settings.locator("#localDictionaryFiles").setInputFiles(Object.entries(pack.files).map(([name, bytes]) => ({ name,
      mimeType: "application/octet-stream", buffer: Buffer.from(bytes) })));
    await expect(settings.locator("#localDictionaryPreflightSummary")).toContainText("TFLex");
    await settings.locator("#localDictionaryLimitationsConfirmation").check();
    await settings.locator("#localDictionaryImportButton").click();
    await expect(settings.locator("#installedDictionaryList")).toContainText(pack.manifest.packId, { timeout: 90_000 });
    const alpha = await installRich(settings, "Upgrade User Alpha", "upgrade-user-alpha");
    const beta = await installRich(settings, "Upgrade User Beta", "upgrade-user-beta");
    await beta.row.locator('[data-action="promote-preferred"]').click();
    await expect(beta.row.locator('[data-role="personal-preference"]')).toHaveText("你的个人首选");
    await beta.row.locator('[data-action="expanded-by-default"]').check();
    await alpha.row.locator('[data-action="enabled"]').uncheck();
    await expect(alpha.row.locator('[data-action="enabled"]')).not.toBeChecked();
    const richBefore = await settings.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(richBefore.dictionaries).toHaveLength(2);
    expect(richBefore.dictionaries.find(item => item.id === beta.id)).toMatchObject({ enabled: true, preferred: true, expandedByDefault: true, resourceCount: 1 });

    const pageUrl = `${server.baseUrl}/article`;
    const cacheInput = { type: "CACHE_LOOKUP", pageUrl, segments: [{ id: "upgrade-cache", text: "Synthetic user dictionary upgrade cache phrase", format: "plain" }] };
    const pending = await driver.evaluate(message => chrome.runtime.sendMessage(message), cacheInput);
    expect(pending.ok, JSON.stringify(pending)).toBe(true); expect(pending.writeTokens).toHaveLength(1);
    const stored = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "CACHE_STORE", pageUrl,
      pageTitle: "Synthetic upgrade cache", configSnapshotId: pending.configSnapshotId,
      items: [{ sourceText: cacheInput.segments[0].text, translation: "升级缓存保留", format: "plain", cacheToken: pending.writeTokens[0].token }] });
    expect(stored).toMatchObject({ ok: true, stored: 1 });

    let center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    await center.getByRole("button", { name: "开启记录", exact: true }).click();
    await expect(center.getByRole("button", { name: "暂停记录", exact: true })).toBeVisible();
    const content = await context.newPage(); await content.goto(pageUrl);
    await content.evaluate(() => { document.body.innerHTML = '<main><p id="upgrade-word">A public upgradeglossary preserves its saved result.</p></main>'; });
    await content.locator("#upgrade-word").evaluate(node => {
      const text = node.firstChild, start = text.nodeValue.indexOf("upgradeglossary"), range = document.createRange();
      range.setStart(text, start); range.setEnd(text, start + "upgradeglossary".length);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(content.locator(".tf-selection-chip")).toBeVisible(); await content.locator(".tf-selection-chip").click();
    await expect(content.locator(".tf-selection-result")).toContainText("升级术语");
    await expect(content.locator(".tf-selection-record-status")).toHaveAttribute("data-state", "saved");
    const recordsBefore = await reading(center, M.LIST_RECORDS, { pageKey: null, query: "", cursor: null, limit: 30 });
    expect(recordsBefore.data.items).toHaveLength(1);
    const recordId = recordsBefore.data.items[0].recordId;
    const recordBefore = await reading(center, M.GET_RECORD, { recordId }); expect(recordBefore.ok).toBe(true);
    await settings.close(); await center.close(); await content.close();
    const oldLookup = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "LEXICAL_LOOKUP", text: "upgradeuserword", pageUrl });
    console.log("[USER_DICTIONARY_UPGRADE_OLD_LOOKUP]", JSON.stringify({ status: oldLookup.status, error: oldLookup.error && { code: oldLookup.error.code, packId: oldLookup.error.packId, path: oldLookup.error.path } }));
    const before = await inspect();
    expect(before.opfs.some(file => file.path.startsWith("dictionaries/local-upgrade-user-fixture/"))).toBe(true);
    expect(before.opfs.some(file => file.path.startsWith("rich-mdict-dictionaries/"))).toBe(true);
    expect(server.calls).toHaveLength(0);
    await context.close();

    // Both paths are inside a fresh mkdtemp tree. No source/worktree/output path
    // is deleted or replaced; the exact production artifact remains read-only.
    await rm(extensionDir, { recursive: true, force: true });
    const newReport = await prepareExtensionTestCopy({ artifact: defaultArtifact, extensionDir, generation: "current", baseUrl: server.baseUrl,
      executionProof: true, observeInstalled: true });
    const replacementWorker = await launch();
    const replacementProof = await replacementWorker.evaluate(() => globalThis.__tfWxtExecutionProof || null);
    const initialLookup = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "LEXICAL_LOOKUP", text: "upgradeuserword", pageUrl });
    console.log("[USER_DICTIONARY_UPGRADE_REPLACEMENT]", JSON.stringify({ executionProof: replacementProof,
      status: initialLookup.status, error: initialLookup.error && { code: initialLookup.error.code, packId: initialLookup.error.packId, path: initialLookup.error.path } }));
    // Chromium can keep the prior script cache when unpacked bytes at an existing
    // path are replaced. Activate through the browser's own extension management
    // API, as in the fixed pre-WXT upgrade test, and prove which artifact executes.
    const manager = await context.newPage(); await manager.goto("chrome://extensions/");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
    const [activatedWorker] = await Promise.all([context.waitForEvent("serviceworker"),
      manager.evaluate(id => chrome.developerPrivate.reload(id, { failQuietly: false }), extensionId)]);
    await expect.poll(() => activatedWorker.evaluate(() => globalThis.__tfWxtExecutionProof || null)).toBe(newReport.treeSha256);
    driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect.poll(() => activatedWorker.evaluate(() => globalThis.__tfInstalledObserver?.events.length || 0)).toBe(1);
    const nativeLifecycle = await activatedWorker.evaluate(() => globalThis.__tfInstalledObserver.events);
    const after = await inspect();
    expect(after.storage).toEqual(before.storage);
    expect(after.opfs).toEqual(before.opfs);
    expect(after.databases).toEqual(before.databases);
    settings = await options();
    const richAfter = await settings.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(richAfter.dictionaries).toEqual(richBefore.dictionaries);
    await expect(settings.locator(`#richMdictInstalledList [data-dictionary-id="${alpha.id}"] [data-action="enabled"]`)).not.toBeChecked();
    await expect(settings.locator(`#richMdictInstalledList [data-dictionary-id="${beta.id}"] [data-action="expanded-by-default"]`)).toBeChecked();
    const preserved = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "LEXICAL_LOOKUP", text: "upgradeuserword", pageUrl });
    expect(preserved.status, JSON.stringify(preserved)).toBe("candidates");
    expect(preserved.candidates.some(candidate => candidate.provenance.packId === pack.manifest.packId && candidate.translations.includes("用户词典升级保留释义"))).toBe(true);
    const glossaryResult = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "LEXICAL_LOOKUP", text: "upgradeglossary", pageUrl });
    expect(glossaryResult).toMatchObject({ status: "candidates", override: true, matchedBy: "user-glossary" });
    expect(glossaryResult.candidates[0].translations).toEqual(["升级术语"]);
    const cacheAfter = await driver.evaluate(message => chrome.runtime.sendMessage(message), cacheInput);
    expect(cacheAfter.hits).toHaveLength(1); expect(cacheAfter.hits[0].text).toBe("升级缓存保留");
    center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    const recordAfter = await reading(center, M.GET_RECORD, { recordId });
    expect(recordAfter.ok).toBe(true);
    // GET_RECORD deliberately marks the record viewed. The read-only database
    // snapshot above proves preservation before this explicit user-facing read.
    expect(recordAfter.data.record.lastViewedAt).toBeGreaterThanOrEqual(recordBefore.data.record.lastViewedAt);
    expect(recordAfter.data).toEqual({ ...recordBefore.data, record: { ...recordBefore.data.record,
      lastViewedAt: recordAfter.data.record.lastViewedAt, revision: recordBefore.data.record.revision + 1 } });
    const probe = await context.newPage(); await probe.goto(pageUrl);
    const resource = await contentRequest(probe, { type: "RICH_MDD_RESOURCE", requestId: `selection-mdd-resource-${crypto.randomUUID().replaceAll("-", "")}`,
      ownerToken: "0123456789abcdef0123456789abcdef", dictionaryId: beta.id, path: "media/upgrade.css" });
    expect(resource, JSON.stringify(resource)).toMatchObject({ ok: true, found: true, mime: "text/css" });
    expect(Buffer.from(resource.base64, "base64").toString("utf8")).toContain("upgrade-user-beta");
    await settings.screenshot({ path: info.outputPath("user-dictionaries-after-main-upgrade.png"), fullPage: true });
    expect(server.calls).toHaveLength(0); expect(externalRequests).toEqual([]);
    await context.close();

    await launch(join(temporary, "fresh-profile"));
    await expect.poll(() => driver.evaluate(() => chrome.storage.local.get(["uiLocale"]))).toEqual({ uiLocale: "zh_CN" });
    const fresh = await driver.evaluate(message => chrome.runtime.sendMessage(message), { type: "LEXICAL_LOOKUP", text: "upgradeuserword", pageUrl });
    expect(fresh.status).toBe("no-hit");
    expect((await inspect()).opfs).toEqual([]);
    expect(server.calls).toHaveLength(0); expect(externalRequests).toEqual([]);
    await writeFile(info.outputPath("user-dictionary-main-upgrade.json"), JSON.stringify({ status: "PASS", browser: context.browser().version(), extensionId,
      oldArtifact: { treeSha256: oldReport.treeSha256, files: oldReport.fileCount, bytes: oldReport.totalBytes, version: oldManifest.version },
      newArtifact: { treeSha256: newReport.treeSha256, files: newReport.fileCount, bytes: newReport.totalBytes, version: newManifest.version },
      sameUnpackedPath: true, sameProfile: true, packageReplacement: oldManifest.version === newManifest.version ? "same-version development replacement" : "version-change replacement",
      cachedOldRuntimeBeforeManagementReload: replacementProof !== newReport.treeSha256,
      executedNewArtifact: newReport.treeSha256, nativeLifecycle,
      onInstalledVersionEventVerified: oldManifest.version !== newManifest.version && nativeLifecycle.some(event => event.reason === "update" && event.previousVersion === oldManifest.version),
      previousMainLookup: { status: oldLookup.status, error: oldLookup.error && { code: oldLookup.error.code, packId: oldLookup.error.packId, path: oldLookup.error.path } },
      realUiImports: ["TFLex", "MDX", "MDD"], richDictionaryCount: 2, preservedStorageSha256: sha256(JSON.stringify(before.storage)),
      opfsFiles: before.opfs, opfsBytes: before.opfs.reduce((sum, file) => sum + file.bytes, 0), providerCalls: server.calls.length,
      preservedDatabasesSha256: sha256(JSON.stringify(before.databases)),
      readingRecords: recordsBefore.data.items.length, cacheHitsAfterReplacement: cacheAfter.hits.length, freshProfile: "no-hit, empty OPFS, zero Provider" }, null, 2));
  } finally {
    await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true });
  }
});
