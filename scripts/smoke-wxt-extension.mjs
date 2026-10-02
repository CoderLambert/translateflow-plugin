#!/usr/bin/env node
// Opt-in PF-01 smoke: consumes the actual WXT production artifact, never builds an old package.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { startMockServer } from "../e2e/support/mock-server.mjs";
import { compileTflexTechnical } from "./build-tflex-technical.mjs";
import { auditWxtExtension } from "./audit-wxt-extension.mjs";
import { ROOT } from "./wxt-assets.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";

const audit = await auditWxtExtension();
const testRoot = await mkdtemp(join(tmpdir(), "translateflow-wxt-smoke-"));
const extension = join(testRoot, "extension");
const server = await startMockServer();
let context;
try {
  await cp(resolve(ROOT, ".output/chrome-mv3"), extension, { recursive: true });
  // Test-only changes: a synthetic Core pack and local mock-origin permission.
  // No production JS/CSS/HTML is patched and no real browser profile is touched.
  await rm(join(extension, "assets/lexicon"), { recursive: true, force: true });
  await mkdir(join(extension, "assets/lexicon"), { recursive: true });
  await cp(resolve(ROOT, "tests/fixtures/tflex-runtime-pack"), join(extension, "assets/lexicon/core"), { recursive: true });
  await compileTflexTechnical({ extractPath: resolve(ROOT, "lexicon/sources/wikidata-tech-entities.json"),
    sourceLockPath: resolve(ROOT, "lexicon/source-locks/technical-wikidata.json"), outDir: join(extension, "assets/lexicon/technical") });
  const manifestPath = join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions.push("http://127.0.0.1/*");
  await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
  context = await chromium.launchPersistentContext(join(testRoot, "profile"), {
    headless: true, channel: "chromium",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const pageErrors = [];
  const externalRequests = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  await context.route(/^https?:/u, (route) => {
    if (new URL(route.request().url()).origin === server.baseUrl) return route.continue();
    externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extensionId = new URL(worker.url()).host;
  const origin = `chrome-extension://${extensionId}`;
  const driver = await context.newPage();
  await driver.goto(`${origin}/${EXTENSION_PAGES.popup}`);
  await expect(driver.locator("#translate")).toBeVisible();
  const cacheStats = await driver.evaluate(() => chrome.runtime.sendMessage({ type: "CACHE_STATS" }));
  assert.equal(cacheStats.ok, true);
  await driver.goto(`${origin}/${EXTENSION_PAGES.options}`);
  await expect(driver.locator("#save")).toBeVisible();
  const workerResults = await driver.evaluate(async (paths) => Promise.all(Object.entries(paths).map(([name, path]) => new Promise((resolve, reject) => {
    const instance = new Worker(chrome.runtime.getURL(path), { type: "module" });
    const timeout = setTimeout(() => { instance.terminate(); reject(new Error(`Worker ${name} did not reject probe input`)); }, 10000);
    instance.onerror = (event) => { clearTimeout(timeout); instance.terminate(); reject(new Error(event.message)); };
    instance.onmessage = (event) => { clearTimeout(timeout); instance.terminate(); resolve({ name, path, type: event.data.type, requestId: event.data.requestId }); };
    instance.postMessage({ type: "WXT_UNKNOWN_MESSAGE", requestId: "wxt-synthetic-probe" });
  }))), WORKER_PATHS);
  const workerErrorTypes = { curatedDictionary: "CURATED_DICTIONARY_ERROR", curatedEcdictMdx: "curated-ecdict-mdx:error",
    mdictImport: "mdict-import:error", stardictImport: "stardict-import:error", richMdictImport: "rich-mdict-import:error", mddResourceImport: "mdd-resource-import:error" };
  for (const result of workerResults) { assert.equal(result.type, workerErrorTypes[result.name]); assert.equal(result.requestId, "wxt-synthetic-probe"); }

  await driver.evaluate(async (baseUrl) => chrome.storage.local.set({
    provider: "openai-compatible", model: "mock-model", targetLanguage: "Simplified Chinese",
    prompt: "Translate the segments and return JSON only.", appearance: "standard", cacheMaxMB: 50,
    cacheRestoreSites: [], autoSites: [], quickControlSites: [], quickControlHiddenSites: [],
    siteProfiles: {}, glossary: { version: 1, entries: [] }, siteGlossaries: { version: 1, sites: {} },
    openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "mock-model" }
  }), server.baseUrl);
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/article`);
  const tabId = await driver.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  assert(Number.isInteger(tabId));
  const lexical = await driver.evaluate((pageUrl) => chrome.runtime.sendMessage({ type: "LEXICAL_LOOKUP", text: "persistent", pageUrl, sourceLanguage: "en", targetLanguage: "zh-CN" }), page.url());
  assert.equal(lexical.ok, true);
  assert.equal(lexical.status, "candidates");
  assert.equal(lexical.candidates.length, 2);
  assert.equal(lexical.candidates[0].provenance.packId, "core-semantic-en-zh-runtime-fixture");
  assert.equal(server.calls.length, 0, "Local dictionary lookup must not call Provider");
  await driver.evaluate(async ({ tabId, scripts, styles, main }) => {
    await chrome.scripting.insertCSS({ target: { tabId }, files: styles });
    await chrome.scripting.executeScript({ target: { tabId }, files: scripts });
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: main });
  }, { tabId, scripts: [...CONTENT_SCRIPT_FILES], styles: [...CONTENT_STYLE_FILES], main: [...YOUTUBE_MAIN_BRIDGE_FILES] });
  assert.equal(await page.evaluate(() => window.__TRANSLATE_FLOW_YOUTUBE_MAIN_BRIDGE__?.version), 1);
  const translated = await driver.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: "ABT_TRANSLATE_PAGE", taskId: "wxt-body-smoke" }), tabId);
  assert.equal(translated.ok, true);
  assert.equal(translated.apiTranslated, 3);
  await expect(page.locator(".abt-translation")).toHaveCount(3);
  assert.equal(server.calls.length, 1);
  const rich = page.locator("#rich .abt-translation");
  await expect(rich.locator("a")).toHaveAttribute("href", "/docs");
  await expect(rich.locator("a")).toContainText("API documentation");
  await expect(rich.locator("code")).toHaveText("npm test");
  await expect(rich).not.toContainText("⟦TF:");
  const cleared = await driver.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: "ABT_CLEAR_TRANSLATIONS" }), tabId);
  assert.equal(cleared.ok, true);
  await expect(page.locator(".abt-translation")).toHaveCount(0);
  const restored = await driver.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: "ABT_RESTORE_CACHE" }), tabId);
  assert.equal(restored.ok, true);
  assert.equal(restored.cacheHits, 3);
  await expect(page.locator(".abt-translation")).toHaveCount(3);
  assert.equal(server.calls.length, 1, "Cache restore must not call Provider");
  const registrations = await driver.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(registrations, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  const report = { status: "PASS", browser: context.browser()?.version(), extensionId,
    productionSource: audit.source, productionManifestDifferences: audit.manifestDifferences,
    testCopyChanges: ["Synthetic Core TFLex fixture", "Technical pack built from existing reviewed local extract/source-lock", "Required localhost host permission only in temporary test copy"],
    popup: "PASS", options: "PASS", backgroundCacheStats: "PASS", workerInvalidInputResponses: workerResults,
    mainBridgeVersion: 1, contentOrderedScripts: CONTENT_SCRIPT_FILES.length, lexicalCandidates: lexical.candidates.length,
    bodyTranslations: translated.apiTranslated, restoredCacheHits: restored.cacheHits, localProviderCalls: server.calls.length,
    unexpectedRegistrations: registrations, pageErrors, externalRequests,
    notRun: ["Chrome 102 runtime", "Real YouTube timedtext", "Full E2E", "Same-ID old→WXT upgrade/restart", "Release lexicon certification", "Real paid Provider", "Other browsers"] };
  await writeFile(resolve(ROOT, ".wxt/reports/browser-smoke.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (context) await context.close();
  await server.close();
  await rm(testRoot, { recursive: true, force: true });
}
