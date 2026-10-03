import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMockServer } from "./support/mock-server.mjs";
import { request, snapshot } from "../tests/fixtures/reading/contract.mjs";
import { sourceClosure } from "../scripts/wxt-assets.mjs";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";

// Actual production router/runtime + native Chrome APIs. Repository, collector, LC are synthetic fixtures.
// No fallback listener manufactures missing production Reading routing. Never a persisted-save/UI acceptance.
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.READING_ACCESS_SOURCE_ROOT || testRoot;
let context, worker, driver, extensionId, server, temporary, version, extensionDir;
const fixtureBootstrap = `
import { initializeBackground } from './src/background/index.js';
import { configureReadingRuntime } from './src/background/reading-record/runtime.js';
import { repositoryDouble } from './tests/fixtures/reading/access.mjs';
import { ReadingContractError } from './src/shared/reading/validation.js';
import { READING_ERROR as E, READING_METHOD as M } from './src/shared/reading/constants.js';
import { response } from './tests/fixtures/reading/contract.mjs';
import { validateReadingRequest } from './src/shared/reading/dto.js';
import { createReadingAccess, readOwnedCollector } from './src/background/reading-record/access.js';
import { validateOperationToken } from './src/shared/reading/lifecycle.js';
globalThis.__readingClock = 1000;
Date.now = () => globalThis.__readingClock;
globalThis.__readingProofs = [];
chrome.runtime.onMessage.addListener((message,sender) => {
  if (!message?.method?.startsWith('reading.')) return;
  globalThis.__readingLastSender=sender; globalThis.__readingLastMessage=message;
  globalThis.__readingProofs.push({ method:message.method, id:sender.id, url:sender.url, documentId:sender.documentId,
    frameId:sender.frameId, documentLifecycle:sender.documentLifecycle, tab:sender.tab ? {id:sender.tab.id,incognito:sender.tab.incognito} : null });
  if (globalThis.__readingProofs.length>100) globalThis.__readingProofs.shift();
});
chrome.runtime.onConnect.addListener((port) => {
  if (port.name==='reading.invalidate') globalThis.__readingLastPortSender=port.sender;
});
initializeBackground();
globalThis.__resetReadingFixture = () => {
  globalThis.__readingClock=1000; globalThis.__readingExcluded=false; globalThis.__readingPaused=false; globalThis.__readingCrossPage=false;
  globalThis.__readingSavedSourceLanguage=null;
  const repo=repositoryDouble({
    async readPolicy({assertCurrent}) { assertCurrent(); return {siteExcluded:globalThis.__readingExcluded}; },
    async read(input) { input.assertCurrent(); if(globalThis.__readingCrossPage && input.request.method===M.GET_RECORD) return response(M.GET_RECORD).data;
      return repositoryDouble().read(input); },
    async prepareOperation(input) { input.assertCurrent(); if(globalThis.__readingPaused) return {state:'disabled'}; return repositoryDouble().prepareOperation(input); },
    async mutate(input) { input.assertCurrent(); if(globalThis.__readingPaused) throw new ReadingContractError(E.DISABLED,'fixture.policy');
      if(input.registeredOperation) globalThis.__readingSavedSourceLanguage=input.registeredOperation.sourceLanguage;
      return repositoryDouble().mutate(input); },
    async readInvalidationState({access,assertCurrent}) { assertCurrent(); return {protocolVersion:2,type:'reading.invalidate',dataGeneration:1,consentGeneration:1,
      ...(access.scope==='content'?{pageRevision:1}:{catalogRevision:1})}; }
  });
  configureReadingRuntime({repository:repo,learningCenterAvailable:true});
};
globalThis.__resetReadingFixture();
globalThis.__diagnoseReading = async (input) => {
  const stages={};
  try { stages.actualMessage=globalThis.__readingLastMessage; stages.dtoActual=validateReadingRequest(globalThis.__readingLastMessage); stages.dto=validateReadingRequest(input);
    stages.rawProof=await readOwnedCollector(chrome,globalThis.__readingLastSender,{nonce:"diagnostic",action:"begin",recordId:null,operationId:input.operationId});
    const control=createReadingAccess({browser:chrome});
    await control.authorize(globalThis.__readingLastSender,M.REGISTER_DOCUMENT,{documentGeneration:input.sourceSnapshot.documentGeneration});
    stages.access=await control.authorize(globalThis.__readingLastSender,input.method,stages.dto);
    stages.prepared=await repositoryDouble().prepareOperation({request:stages.dto,access:stages.access,sourceSnapshot:stages.access.proof.sourceSnapshot,issuedAt:1000,expiresAt:601000,assertCurrent(){}});
    stages.token=validateOperationToken(stages.prepared.token);
  }catch(error){stages.error={code:error.code,path:error.path,message:error.message};}
  return stages;
};
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
    args: [JSON.stringify(message)], func: (input) => chrome.runtime.sendMessage(JSON.parse(input)) }), { tabId: info.tabId, message });
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
    const extension = join(temporary, "extension"); extensionDir = extension;
    const { buildExtension } = await import(pathToFileURL(join(sourceRoot, "scripts/build-extension.mjs")).href);
    await buildExtension({ outDir: extension, allowExternalOutput: true });
    await mkdir(join(extension, "tests/fixtures/reading"), { recursive: true });
    for (const file of ["contract.mjs", "access.mjs"]) await cp(join(testRoot, "tests/fixtures/reading", file), join(extension, "tests/fixtures/reading", file));
    // This story deliberately replaces the compiled worker with a synthetic
    // repository/authority harness. Its source imports are test-only assets,
    // separate from actual production-artifact acceptance.
    const roots = [...fixtureBootstrap.matchAll(/from ['"]\.\/(src\/[^'"]+)['"]/gu)].map(match => match[1]);
    for (const path of await sourceClosure(roots, sourceRoot)) {
      await mkdir(dirname(join(extension, path)), { recursive: true });
      await cp(join(sourceRoot, path), join(extension, path));
    }
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
    await writeFile(test.info().outputPath("extension-native.json"), JSON.stringify({ version, list, ...diagnostic }));
    await test.info().attach("extension-native.json", { body: Buffer.from(JSON.stringify({ version, list, ...diagnostic })), contentType: "application/json" });
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
    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html#general`);
    expect(await sendPage(options, request(M.OPEN_LEARNING_CENTER))).toMatchObject({ protocolVersion: 2, ok: true, data: { opened: true } });
    const entry = await worker.evaluate(async () => {
      const proof = globalThis.__readingProofs.at(-1);
      return { proof, contexts: await chrome.runtime.getContexts({ documentIds: [proof.documentId] }) };
    });
    expect(entry.proof.url).toBe(`chrome-extension://${extensionId}/options.html#general`);
    expect(entry.contexts).toHaveLength(1); expect(entry.contexts[0]).toMatchObject({ documentId: entry.proof.documentId, documentUrl: entry.proof.url, incognito: false });
    await writeFile(test.info().outputPath("entry-hash-native.json"), JSON.stringify(entry));
    expect((await sendPage(options, request(M.LIST_RECORDS))).error.code).toBe(E.FORBIDDEN);
    await options.goto(`chrome-extension://${extensionId}/learning-center.html#general`);
    expect((await sendPage(options, request(M.OPEN_LEARNING_CENTER))).error.code).toBe(E.FORBIDDEN);
    await options.close();
    await center.close(); await unknown.close();
  });

  test("Actual Content sender/doc, cross-page and navigation failclosed; web world cannot forge isolated collector", async () => {
    const { page, info, registration } = await openContent();
    const begin = request(M.BEGIN_QUERY, { sourceSnapshot: info.snapshot, pageKey: registration.pageKey });
    const beginResult = await sendContent(info, begin);
    await writeFile(test.info().outputPath("begin-native.json"), JSON.stringify({ beginResult, proof: await worker.evaluate(() => globalThis.__readingProofs.at(-1)), stages: await worker.evaluate((input) => globalThis.__diagnoseReading(input), begin) }));
    expect(beginResult).toMatchObject({ protocolVersion: 2, ok: true, data: { state: "ready" } });
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

  test("Native same-document navigation closes Reading port, preserves unrelated LC and denies mismatched URL; full reload permits fresh reconnect", async () => {
    const center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    expect(await center.evaluate(() => new Promise((done) => {
      const state = globalThis.__nativeReadingPort = { messages: [], disconnected: false };
      state.port = chrome.runtime.connect({ name: "reading.invalidate" });
      state.port.onMessage.addListener((value) => { state.messages.push(value); done(value); });
      state.port.onDisconnect.addListener(() => { state.disconnected = true; });
    }))).toMatchObject({ type: "reading.invalidate", catalogRevision: 1 });
    const { page, info } = await openContent();
    const connect = async () => {
      const [result] = await driver.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
        func: () => new Promise((done) => {
          const state = globalThis.__nativeReadingPort = { messages: [], disconnected: false };
          state.port = chrome.runtime.connect({ name: "reading.invalidate" });
          state.port.onMessage.addListener((value) => { state.messages.push(value); done(value); });
          state.port.onDisconnect.addListener(() => { state.disconnected = true; });
        }) }), info.tabId);
      expect(result.result).toMatchObject({ type: "reading.invalidate", pageRevision: 1 });
    };
    const state = async () => {
      const [result] = await driver.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
        func: () => ({ disconnected: globalThis.__nativeReadingPort.disconnected, messages: globalThis.__nativeReadingPort.messages }) }), info.tabId);
      return result.result;
    };
    await connect();
    const native = await worker.evaluate(() => globalThis.__readingLastPortSender);
    expect(native.tab.id).toBe(info.tabId); expect(native.documentId).toBe(info.nativeDocumentId);
    const rounds = [];
    for (let index = 0; index < 3; index++) {
      const previousDocument = (await worker.evaluate(() => globalThis.__readingLastPortSender)).documentId;
      // pushState keeps the same actual document and native Port; runtime's tabs listener must close it.
      await page.evaluate((index) => history.pushState({}, "", `?route=${index}#reading-fixture`), index);
      await expect.poll(async () => (await state()).disconnected).toBe(true);
      expect((await state()).messages).toHaveLength(1);
      expect(await center.evaluate(() => globalThis.__nativeReadingPort.disconnected)).toBe(false);
      const fresh = await installCollector(page);
      const registration = await sendContent(fresh, request(M.REGISTER_DOCUMENT, { documentGeneration: fresh.generation }));
      const sender = await worker.evaluate(() => ({ url: globalThis.__readingLastSender.url,
        tabUrl: globalThis.__readingLastSender.tab.url, documentId: globalThis.__readingLastSender.documentId }));
      expect(fresh.nativeDocumentId).toBe(previousDocument);
      expect(sender.documentId).toBe(previousDocument); expect(sender.url).not.toBe(sender.tabUrl);
      expect(registration).toMatchObject({ ok: false, error: { code: E.FORBIDDEN } });
      // Current native sender URL is intentionally strict. Reloading creates a new proved document.
      await page.reload(); const reloaded = await installCollector(page);
      expect(reloaded.nativeDocumentId).not.toBe(previousDocument);
      const recovered = await sendContent(reloaded, request(M.REGISTER_DOCUMENT, { documentGeneration: reloaded.generation }));
      expect(recovered).toMatchObject({ ok: true });
      await connect(); rounds.push({ index, previousPortClosed: true, sameDocumentIdBeforeReload: true, registration, sender,
        newDocumentIdAfterReload: reloaded.nativeDocumentId, recovered, freshConnected: true });
      await writeFile(test.info().outputPath(`native-reconnect-${index}.json`), JSON.stringify(rounds.at(-1)));
    }
    const current = await worker.evaluate(() => globalThis.__readingLastPortSender);
    expect(current.documentId).not.toBe(native.documentId);
    await writeFile(test.info().outputPath("native-port-navigation.json"), JSON.stringify({ version, documentUnchangedByPushState: true, senderTab: native.tab.id,
      rounds, unrelatedLearningCenterConnected: true, repository: "synthetic", productUI: "NOT RUN", realIDB: "NOT RUN" }));
    expect(server.calls).toHaveLength(0);
    await page.close(); await center.close();
  });

  test("Native Content BEGIN retains validated language in SAVE registeredOperation without a second metadata store", async () => {
    const { page, info, registration } = await openContent();
    const begin = request(M.BEGIN_QUERY, { sourceSnapshot: info.snapshot, pageKey: registration.pageKey, sourceLanguage: "fr-CA" });
    const ready = await sendContent(info, begin); expect(ready).toMatchObject({ ok: true, data: { state: "ready" } });
    const saved = await sendContent(info, request(M.SAVE_QUERY_RESULT, { token: ready.data.token }));
    expect(saved).toMatchObject({ ok: true, data: { state: "saved" } });
    const sourceLanguage = await worker.evaluate(() => globalThis.__readingSavedSourceLanguage);
    expect(sourceLanguage).toBe("fr-CA");
    expect(await sendContent(info, begin)).toEqual(ready);
    await writeFile(test.info().outputPath("native-operation-language.json"), JSON.stringify({ version, sourceLanguage,
      repository: "synthetic; no persisted ReadingRecord", nativeDocumentId: info.nativeDocumentId }));
    expect(server.calls).toHaveLength(0); await page.close();
  });

  test("Native private Content denies every history route; simulated missing getContexts is capability-limited", async () => {
    const center = await context.newPage(); await center.goto(`chrome-extension://${extensionId}/learning-center.html`);
    await worker.evaluate(() => { globalThis.__originalGetContexts = chrome.runtime.getContexts; chrome.runtime.getContexts = undefined; });
    try { expect((await sendPage(center, request(M.LIST_RECORDS))).error.code).toBe(E.CAPABILITY_LIMITED); }
    finally { await worker.evaluate(() => { chrome.runtime.getContexts = globalThis.__originalGetContexts; }); }
    // Change only this dedicated fixture profile's own extension-incognito preference, then restart.
    // Chrome's native isAllowedIncognitoAccess/getContexts prove the effect; no user profile is opened.
    await center.close(); await context.close();
    const preferencePath = join(temporary, "isolated-profile", "Default", "Preferences");
    const preferences = JSON.parse(await readFile(preferencePath, "utf8"));
    expect(preferences.extensions.settings[extensionId]).toBeTruthy();
    preferences.extensions.settings[extensionId].incognito = true;
    await writeFile(preferencePath, JSON.stringify(preferences));
    context = await chromium.launchPersistentContext(join(temporary, "isolated-profile"), { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`] });
    worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    driver = await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/popup.html`);
    expect(await driver.evaluate(() => new Promise((done) => chrome.extension.isAllowedIncognitoAccess(done)))).toBe(true);
    const privateWindow = await worker.evaluate((baseUrl) => chrome.windows.create({ incognito: true, url: `${baseUrl}/article?privatefixture=1` }), server.baseUrl);
    try {
      const requests = Object.values(M).map((method) => request(method));
      const [injected] = await driver.evaluate(async ({ tabId, requests }) => chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
        args: [JSON.stringify(requests)], func: async (serialized) => Promise.all(JSON.parse(serialized).map((input) => chrome.runtime.sendMessage(input))) }), { tabId: privateWindow.tabs[0].id, requests });
      await writeFile(test.info().outputPath("native-private-results.json"), JSON.stringify(requests.map((req,i)=>({method:req.method,result:injected.result[i]}))));
      expect(injected.result).toHaveLength(requests.length);
      for (const result of injected.result) expect(result).toMatchObject({ protocolVersion: 2, ok: false, error: { code: E.FORBIDDEN } });
      const proof = await worker.evaluate(() => globalThis.__readingProofs.at(-1));
      expect(proof.tab.incognito).toBe(true);
      const backgroundIncognito = await worker.evaluate(() => chrome.extension.inIncognitoContext);
      expect(backgroundIncognito).toBe(false); // Actual spanning background is not private-page proof.
      await writeFile(test.info().outputPath("native-private.json"), JSON.stringify({ proof, methodCount: requests.length,
        result: "all forbidden", backgroundIncognito, extensionPageInSpanningIncognito: "browser blocked; no native extension context", realChrome102: "NOT RUN" }));
    } finally { await worker.evaluate((id) => chrome.windows.remove(id), privateWindow.id); }
  });


  test("Ordinary lookup keeps the production legacy router and uses only a local synthetic provider", async () => {
    await driver.evaluate(async (baseUrl) => chrome.storage.local.set({ provider: "openai-compatible", targetLanguage: "Simplified Chinese",
      openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "mock-model" } }), server.baseUrl);
    const lookup = await sendPage(driver, { type: "SELECTION_RESOLVE", text: "React", pageUrl: `${server.baseUrl}/article`, context: null, depth: "basic" });
    expect(lookup.ok).toBe(true); expect(lookup).not.toHaveProperty("protocolVersion");
    expect(lookup.intent).toMatchObject({ kind: "lexical", tokenCount: 1 }); expect(lookup.lookup).toBeTruthy();
    expect(server.calls.every((call) => call.path?.startsWith("/v1") || call.requestId !== undefined)).toBe(true);
    test.info().annotations.push({ type: "provider", description: "Local mock only; paid provider calls=0. No Reading repository writes claimed." });
  });
});
