import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMockServer } from "./support/mock-server.mjs";
import { request, snapshot } from "../tests/fixtures/reading/contract.mjs";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";

// Actual production router/runtime + native Chrome APIs. Repository, collector, LC are synthetic fixtures.
// No fallback listener manufactures missing production Reading routing. Never a persisted-save/UI acceptance.
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.READING_ACCESS_SOURCE_ROOT || testRoot;
let context, worker, driver, extensionId, server, temporary, version;
const fixtureBootstrap = `
import { initializeBackground } from './src/background/index.js';
import { configureReadingRuntime } from './src/background/reading-record/runtime.js';
import { repositoryDouble } from './tests/fixtures/reading/access.mjs';
import { ReadingContractError } from './src/shared/reading/validation.js';
import { READING_ERROR as E, READING_METHOD as M } from './src/shared/reading/constants.js';
import { response } from './tests/fixtures/reading/contract.mjs';
globalThis.__readingClock = 1000;
Date.now = () => globalThis.__readingClock;
globalThis.__readingProofs = [];
chrome.runtime.onMessage.addListener((message,sender) => {
  if (!message?.method?.startsWith('reading.')) return;
  globalThis.__readingProofs.push({ method:message.method, id:sender.id, url:sender.url, documentId:sender.documentId,
    frameId:sender.frameId, documentLifecycle:sender.documentLifecycle, tab:sender.tab ? {id:sender.tab.id,incognito:sender.tab.incognito} : null });
  if (globalThis.__readingProofs.length>100) globalThis.__readingProofs.shift();
});
initializeBackground();
globalThis.__resetReadingFixture = () => {
  globalThis.__readingClock=1000; globalThis.__readingExcluded=false; globalThis.__readingPaused=false; globalThis.__readingCrossPage=false;
  const repo=repositoryDouble({
    async readPolicy({assertCurrent}) { assertCurrent(); return {siteExcluded:globalThis.__readingExcluded}; },
    async read(input) { input.assertCurrent(); if(globalThis.__readingCrossPage && input.request.method===M.GET_RECORD) return response(M.GET_RECORD).data;
      return repositoryDouble().read(input); },
    async prepareOperation(input) { input.assertCurrent(); if(globalThis.__readingPaused) return {state:'disabled'}; return repositoryDouble().prepareOperation(input); },
    async mutate(input) { input.assertCurrent(); if(globalThis.__readingPaused) throw new ReadingContractError(E.DISABLED,'fixture.policy'); return repositoryDouble().mutate(input); }
  });
  configureReadingRuntime({repository:repo,learningCenterAvailable:true});
};
globalThis.__resetReadingFixture();
`;

async function sendPage(page, message) { return page.evaluate((input) => chrome.runtime.sendMessage(input), message); }
async function tabId(page) {
  return driver.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
}
async function installCollector(page, safety = { selection: "safe", context: "safe", root: "light-dom" }) {
  const id = await tabId(page);
  const [injection] = await driver.evaluate(async ({ id, input, safety }) => chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, world: "ISOLATED",
    args: [input, safety], func: (source, state) => {
      const generation = `doc-${crypto.randomUUID()}`;
      const frozen = { ...source, documentGeneration: generation };
      globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
      globalThis.__TRANSLATE_FLOW_CONTENT__.modules ||= {};
      globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingAccessCollector = { read(challenge) {
        return { nonce: challenge.nonce, documentGeneration: generation, selectionGeneration: 1, captureSafety: state, sourceSnapshot: frozen,
          intent: ["register", "inspect"].includes(challenge.action) ? null : { action: challenge.action, recordId: challenge.recordId, operationId: challenge.operationId } };
      } };
      return { generation, snapshot: frozen };
    } }), { id, input: snapshot(), safety });
  return { ...injection.result, nativeDocumentId: injection.documentId, tabId: id };
}
async function sendContent(info, message) {
  const [result] = await driver.evaluate(async ({ tabId, message }) => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "ISOLATED",
    args: [message], func: (input) => chrome.runtime.sendMessage(input) }), { tabId: info.tabId, message });
  return result.result;
}
async function openContent(path = "/article?id=1#section-2") {
  const page = await context.newPage(); await page.goto(`${server.baseUrl}${path}`);
  const info = await installCollector(page);
  const registration = await sendContent(info, request(M.REGISTER_DOCUMENT, { documentGeneration: info.generation }));
  await writeFile(test.info().outputPath("registration-native.json"), JSON.stringify({ registration, info, proof: await worker.evaluate(() => globalThis.__readingProofs.at(-1)) }));
  await test.info().attach("registration-native.json", { body: Buffer.from(JSON.stringify({ registration, info, proof: await worker.evaluate(() => globalThis.__readingProofs.at(-1)) })), contentType: "application/json" });
  expect(registration).toMatchObject({ protocolVersion: 2, ok: true });
  return { page, info, registration: registration.data };
}

test.describe("Reading native authority (synthetic repository / owned collector fixture)", () => {
  test.setTimeout(60000);
  test.beforeAll(async () => {
    server = await startMockServer(); temporary = await mkdtemp(join(tmpdir(), "translateflow-reading-access-"));
    const extension = join(temporary, "extension");
    const { buildExtension } = await import(pathToFileURL(join(sourceRoot, "scripts/build-extension.mjs")).href);
    await buildExtension({ outDir: extension, allowExternalOutput: true });
    await mkdir(join(extension, "tests/fixtures/reading"), { recursive: true });
    for (const file of ["contract.mjs", "access.mjs"]) await cp(join(testRoot, "tests/fixtures/reading", file), join(extension, "tests/fixtures/reading", file));
    await writeFile(join(extension, "background.js"), fixtureBootstrap);
    // Test assets only. Production does not yet claim the #235 learning-center artifact exists.
    for (const name of ["learning-center.html", "unexpected.html"]) await writeFile(join(extension, name), "<!doctype html><title>Synthetic Reading authority fixture; not product UI</title><p>Fixture only</p>");
    const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting"]);
    manifest.host_permissions.push("http://127.0.0.1/*");
    await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(join(temporary, "isolated-profile"), { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"); extensionId = new URL(worker.url()).host;
    driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/popup.html`);
    version = await driver.evaluate(() => navigator.userAgent);
  });
  test.beforeEach(async () => { await worker.evaluate(() => globalThis.__resetReadingFixture()); server.reset(); });
  test.afterAll(async () => {
    await context?.close(); await server?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  test("Native sender.documentId equals getContexts document with optional tab; only fixed learning center has history authority", async () => {
    const center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    const list = await sendPage(center, request(M.LIST_RECORDS));
    const diagnostic = await worker.evaluate(async () => ({ proof: globalThis.__readingProofs.at(-1), contexts: await chrome.runtime.getContexts({}) }));
    await writeFile(test.info().outputPath("extension-native.json"), JSON.stringify({ list, ...diagnostic }));
    await test.info().attach("extension-native.json", { body: Buffer.from(JSON.stringify({ list, ...diagnostic })), contentType: "application/json" });
    expect(list).toMatchObject({ protocolVersion: 2, ok: true });
    const proof = await worker.evaluate(() => globalThis.__readingProofs.at(-1));
    const contexts = await worker.evaluate((documentId) => chrome.runtime.getContexts({ documentIds: [documentId] }), proof.documentId);
    expect(contexts).toHaveLength(1); expect(contexts[0]).toMatchObject({ documentId: proof.documentId, documentUrl: proof.url, contextType: "TAB", incognito: false });
    if (proof.tab) expect(proof.tab.id).toBe(contexts[0].tabId); // Native optional field, never fabricated.
    test.info().annotations.push({ type: "native", description: JSON.stringify({ version, senderHasTab: !!proof.tab, documentIdMatches: true, contextType: contexts[0].contextType, incognito: contexts[0].incognito }) });
    expect((await sendPage(driver, request(M.LIST_RECORDS))).error.code).toBe(E.FORBIDDEN);
    const unknown = await context.newPage(); await unknown.goto(`chrome-extension://${extensionId}/unexpected.html`);
    expect((await sendPage(unknown, request(M.LIST_RECORDS))).error.code).toBe(E.FORBIDDEN);
    expect((await sendPage(driver, request(M.OPEN_LEARNING_CENTER, { url: "https://example.test/" }))).error.code).toBe(E.BAD_DTO);
    expect(await sendPage(driver, request(M.OPEN_LEARNING_CENTER))).toMatchObject({ protocolVersion: 2, ok: true, data: { opened: true } });
    await center.close(); await unknown.close();
  });

  test("Actual Content sender/doc, cross-page and navigation failclosed; web world cannot forge isolated collector", async () => {
    const { page, info, registration } = await openContent();
    const begin = request(M.BEGIN_QUERY, { sourceSnapshot: info.snapshot, pageKey: registration.pageKey });
    expect(await sendContent(info, begin)).toMatchObject({ protocolVersion: 2, ok: true, data: { state: "ready" } });
    const proof = await worker.evaluate(() => globalThis.__readingProofs.at(-1));
    expect(proof.documentId).toBe(info.nativeDocumentId); expect(proof.tab.incognito).toBe(false); expect(proof.frameId).toBe(0);
    expect((await sendContent(info, request(M.LIST_RECORDS))).error.code).toBe(E.FORBIDDEN);
    expect((await sendContent(info, { ...begin, operationId: "cross-page", pageKey: `rp1:${"d".repeat(64)}` })).error.code).toBe(E.FORBIDDEN);
    await worker.evaluate(() => { globalThis.__readingCrossPage = true; });
    expect((await sendContent(info, request(M.GET_RECORD))).error.code).toBe(E.FORBIDDEN);
    await worker.evaluate(() => { globalThis.__readingCrossPage = false; });
    await page.evaluate(() => { globalThis.__TRANSLATE_FLOW_CONTENT__ = { modules: { readingAccessCollector: { read: () => ({ fake: true }) } } }; window.postMessage({ method: "reading.list-records", protocolVersion: 2 }, "*"); });
    expect(await sendContent(info, request(M.GET_RECORD))).toMatchObject({ protocolVersion: 2, ok: true });
    await page.goto(`${server.baseUrl}/article?id=2#section-2`);
    const replacement = await installCollector(page);
    expect((await sendContent(replacement, request(M.GET_RECORD))).error.code).toBe(E.STALE_OPERATION);
    expect(server.calls).toHaveLength(0);
    await page.close();
  });

  test("Sensitive/unsupported/unknown proof, site exclusion, pause and expired capability reject actual Content messages", async () => {
    for (const state of [{ selection: "sensitive", context: "safe", root: "light-dom" }, { selection: "safe", context: "unknown", root: "light-dom" }, { selection: "safe", context: "safe", root: "unsupported" }]) {
      const page = await context.newPage(); await page.goto(`${server.baseUrl}/article`); const info = await installCollector(page, state);
      expect((await sendContent(info, request(M.REGISTER_DOCUMENT, { documentGeneration: info.generation }))).error.code).toBe(E.FORBIDDEN); await page.close();
    }
    const { page, info, registration } = await openContent();
    const begin = await sendContent(info, request(M.BEGIN_QUERY, { sourceSnapshot: info.snapshot, pageKey: registration.pageKey }));
    expect(begin.ok).toBe(true);
    await worker.evaluate(() => { globalThis.__readingExcluded = true; });
    expect((await sendContent(info, request(M.GET_PAGE_SUMMARY))).error.code).toBe(E.DISABLED);
    await worker.evaluate(() => { globalThis.__readingExcluded = false; globalThis.__readingPaused = true; });
    expect((await sendContent(info, request(M.SAVE_QUERY_RESULT, { token: begin.data.token }))).error.code).toBe(E.DISABLED);
    await worker.evaluate(() => { globalThis.__readingPaused = false; globalThis.__readingClock = 601000; });
    expect((await sendContent(info, request(M.SAVE_QUERY_RESULT, { token: begin.data.token }))).error.code).toBe(E.STALE_OPERATION);
    expect((await sendContent(info, request(M.GET_SITE_RECORDING, { siteKey: "https://other.test" }))).error.code).toBe(E.FORBIDDEN);
    expect(server.calls).toHaveLength(0); await page.close();
  });

  test("Ordinary lookup keeps the production legacy router and uses only a local synthetic provider", async () => {
    await driver.evaluate(async (baseUrl) => chrome.storage.local.set({ provider: "openai-compatible", targetLanguage: "Simplified Chinese",
      openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "mock-model" } }), server.baseUrl);
    const lookup = await sendPage(driver, { type: "SELECTION_RESOLVE", text: "React", pageUrl: `${server.baseUrl}/article`, context: null, depth: "basic" });
    expect(lookup.ok).toBe(true); expect(lookup).not.toHaveProperty("protocolVersion");
    expect(server.calls.every((call) => call.path?.startsWith("/v1") || call.requestId !== undefined)).toBe(true);
    test.info().annotations.push({ type: "provider", description: "Local mock only; paid provider calls=0. No Reading repository writes claimed." });
  });
});
