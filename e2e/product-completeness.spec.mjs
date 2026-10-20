import { readFile } from "node:fs/promises";
import { test, expect } from "./support/extension-fixture.mjs";
import { READING_METHOD as M } from "../src/shared/reading/constants.js";
import { record, snapshot, artifact } from "../tests/fixtures/reading/contract.mjs";
import { createSourceDigest } from "../src/shared/reading/identity.js";

const preferences = { version: 1, wordMethod: "free-online", textMethod: "free-online" };
const online = { version: 2, mode: "legacy", routing: "fixed", providerId: "mt-microsoft-web", sourceLanguage: "en" };
const consent = { version: 1, routing: "fixed", providerId: "mt-microsoft-web" };
async function document(h, path) { const page = await h.context.newPage(); await page.goto(`chrome-extension://${h.extensionId}/${path}`); return page; }
async function select(page) {
 await page.locator("#technical-competition").evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
 await page.getByRole("button", { name: "查词", exact: true }).click();
}
async function content(h) { const page = await h.open("/selection"); await h.inject(page); return page; }
const reading = (page, method, fields = {}) => page.evaluate(message => chrome.runtime.sendMessage(message), { protocolVersion: 2, method, ...fields });
async function importFile(page, value) {
 await page.locator(".learning-backup input[type=file]").setInputFiles({ name: "synthetic-backup.json", mimeType: "application/json", buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) });
 await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
}
async function savedDownload(page, action) {
 const pending = page.waitForEvent("download"); await action(); const download = await pending; return JSON.parse(await readFile(await download.path(), "utf8"));
}
test.beforeEach(async ({ harness: h }) => {
 await h.setStorage({ translationPreferences: preferences, machineTranslation: online, machineTranslationConsent: consent });
 await h.serviceWorker.evaluate(() => {
  const original = fetch; globalThis.__completenessCalls = []; globalThis.__completeness429 = false;
  globalThis.fetch = async (url, options) => {
   if (new URL(url).hostname !== "edge.microsoft.com") return original(url, options);
   globalThis.__completenessCalls.push({ url: String(url), body: options.body });
   if (globalThis.__completeness429) return new Response("synthetic rate limit", { status: 429, headers: { "Retry-After": "120" } });
   return Response.json(JSON.parse(options.body).map(text => ({ translations: [{ text: `合成译文:${text}` }] })));
  };
 });
});

test("global withdrawal persists and stops uploads even with unavailable AI; first-use error links directly to consent settings", async ({ harness: h }) => {
 await h.setStorage({ translationPreferences: { ...preferences, textMethod: "ai" }, provider: "deepseek", apiKey: "", model: "deepseek-flash", openAICompatible: { apiKey: "", baseUrl: "", model: "" } });
 const settings = await document(h, "options.html#general");
 await settings.locator("#mt-consent").uncheck(); await expect(settings.locator("#mt-save")).toBeEnabled();
 await settings.locator("#mt-save").click(); await expect(settings.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
 await settings.reload(); await expect(settings.locator("#mt-consent")).not.toBeChecked();
 expect((await h.getStorage(["translationPreferences"])).translationPreferences).toEqual({ ...preferences, textMethod: "ai" });
 const page = await content(h); await select(page);
 await expect(page.locator(".tf-selection-panel")).toContainText("请先确认允许");
 const opened = h.context.waitForEvent("page"); await page.getByRole("button", { name: "前往设置，授权或准备所选服务" }).click();
 const recovery = await opened; await expect(recovery).toHaveURL(/options\.html#general$/);
 await recovery.getByRole("group", { name: "句段与全文翻译方式" }).getByRole("radio", { name: "免费在线", exact: true }).check();
 await recovery.locator("#mt-consent").check(); await recovery.locator("#mt-save").click(); await expect(recovery.getByText("翻译偏好已保存。", { exact: true })).toBeVisible();
 await page.getByRole("button", { name: "重试", exact: true }).click(); await expect(page.locator(".tf-selection-primary")).toContainText("合成译文");
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(1); expect(h.server.calls).toHaveLength(0);
 await page.screenshot({ path: test.info().outputPath("consent-recovery.png") });
});

test("site withdrawal saves without translation and blocks global inheritance; word consent remains global", async ({ harness: h }) => {
 const page = await content(h); await page.bringToFront();
 const popup = await document(h, "popup.html");
 // Native activeTab remains the content tab when the extension page is loaded by this fixture.
 await page.bringToFront(); await popup.reload();
 await popup.locator(".mt-consent input").uncheck();
 await popup.getByRole("button", { name: "保存撤回本站联网同意" }).click();
 await expect(popup.getByText("已撤回本站联网同意。单词查词仍使用全局设置。", { exact: true })).toBeVisible();
 const raw = await h.getStorage(["machineTranslationConsent", "siteProfiles"]);
 expect(raw.machineTranslationConsent).toEqual(consent);
 expect(raw.siteProfiles[new URL(h.server.baseUrl).origin.replace(/:\d+$/, "")].machineTranslationConsent).toBeNull();
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(0); expect(h.server.calls).toHaveLength(0);
 await popup.reload(); await expect(popup.locator(".mt-consent input")).not.toBeChecked();
 const tabId = await h.tabId(page);
 const refused = await h.driver.evaluate(async tabId => {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: async () => {
    const segments = [{ id: "selection", text: "A synthetic selected sentence.", format: "plain" }];
    const lookup = await chrome.runtime.sendMessage({ type: "CACHE_LOOKUP", pageUrl: location.href, segments });
    if (!lookup.ok) return lookup;
    return chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", pageUrl: location.href, requestId: "withdrawal-probe", configSnapshotId: lookup.configSnapshotId, segments });
  } });
  return result.result;
 }, tabId);
 expect(refused).toMatchObject({ ok: false, errorCode: "MT_CONSENT" });
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(0);
 await select(page); await expect(page.locator(".tf-selection-primary")).toContainText("合成译文");
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(1);
 expect(h.server.calls).toHaveLength(0);
});

test("online and cached lookup preserve language and source in wordbook; AI tabs are visible before any AI request", async ({ harness: h }) => {
 await h.setStorage({ targetLanguage: "Japanese" });
 const page = await content(h); await select(page); await expect(page.locator(".tf-selection-primary")).toContainText("合成译文");
 for (const name of ["AI · 理解", "AI · 分析", "AI · 用法"]) await expect(page.locator(".tf-selection-view-tab").filter({ hasText: name })).toBeVisible();
 await page.getByRole("button", { name: "收藏到生词本", exact: true }).click();
 await expect(page.getByRole("button", { name: "打开生词本", exact: true })).toBeVisible();
 await page.keyboard.press("Escape"); await select(page); await expect(page.locator(".tf-selection-primary")).toContainText("合成译文");
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(1);
 const center = await document(h, "learning-center.html#wordbook");
 const stored = await center.evaluate(() => chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_LIST" }));
 expect(stored.entries[0]).toMatchObject({ sourceLanguage: "en", targetLanguage: "ja", sources: [{ sourceId: "machine-translation", packId: "mt-microsoft-web" }] });
 await expect(center.locator(".vocabulary-facts")).toContainText("在线译文 · 微软翻译");
 await page.setViewportSize({ width: 360, height: 740 }); await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
 await page.screenshot({ path: test.info().outputPath("ai-labels-narrow-dark.png") });
 expect(h.server.calls).toHaveLength(0);
});

// Synthetic APIs exercise the production Content/runtime/cache/wordbook chain;
// this is not evidence of a downloaded Chrome model or a live AI provider.
async function nativeVocabulary(h, page, probe = false) {
 const tabId = await h.tabId(page);
 return h.driver.evaluate(async ({ tabId, probe }) => {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [probe], func: probe => {
   if (probe) return globalThis.__vocabularyNative;
   const state = globalThis.__vocabularyNative = { inputs: [], pairs: [] };
   Object.defineProperty(globalThis, "Translator", { configurable: true, value: {
    availability: async () => "available", create: async pair => {
     state.pairs.push({ sourceLanguage: pair.sourceLanguage, targetLanguage: pair.targetLanguage });
     return { destroy() {}, translate: async text => { state.inputs.push(text); return `本地合成:${text}`; } };
    }
   } });
   Object.defineProperty(globalThis, "LanguageDetector", { configurable: true, value: {
    availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "en", confidence: 0.99 }], destroy() {} })
   } });
  } }); return result.result;
 }, { tabId, probe });
}
for (const method of ["ai", "browser-local"]) for (const [targetLanguage, code] of [["Japanese", "ja"], ["French", "fr"]]) {
 test(`${method} ${code} cached vocabulary keeps its actual language and source across restart`, async ({ harness: h }) => {
  await h.setStorage({ translationPreferences: { version: 1, wordMethod: method, textMethod: method }, targetLanguage, browserSourceLanguage: "en" });
  let page = await content(h);
  if (method === "browser-local") await nativeVocabulary(h, page);
  await select(page);
  const label = method === "ai" ? "AI 译文" : "Chrome 本地译文";
  await expect(page.locator(".tf-selection-primary")).toContainText(method === "ai" ? "[DEFAULT|PLAIN] session" : "本地合成:session");
  await expect(page.locator(".tf-selection-result")).toContainText(label);
  const count = h.server.calls.length;
  const nativeCount = method === "browser-local" ? (await nativeVocabulary(h, page, true)).inputs.length : 0;
  if (method === "browser-local") {
   expect(nativeCount).toBeGreaterThan(0);
   expect((await nativeVocabulary(h, page, true)).pairs).toContainEqual({ sourceLanguage: "en", targetLanguage: code });
   expect(count).toBe(0);
  } else expect(count).toBe(1);
  await page.keyboard.press("Escape"); await select(page);
  await expect(page.locator(".tf-selection-result")).toContainText(label);
  await page.getByRole("button", { name: "收藏到生词本", exact: true }).click();
  await expect(page.getByRole("button", { name: "打开生词本", exact: true })).toBeVisible();
  expect(h.server.calls).toHaveLength(count);
  if (method === "browser-local") expect((await nativeVocabulary(h, page, true)).inputs).toHaveLength(nativeCount);
  expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(0);
  let center = await document(h, "learning-center.html#wordbook");
  const book = await center.evaluate(() => chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_LIST" }));
  expect(book.entries).toHaveLength(1);
  expect(book.entries[0]).toMatchObject({ headword: "session", sourceLanguage: method === "ai" ? "auto" : "en", targetLanguage: method === "ai" ? targetLanguage : code,
   sources: [{ sourceId: method === "ai" ? "ai-translation" : "browser-translator", packId: method === "ai" ? "openai-chat" : "browser-translator" }] });
  await expect(center.locator(".vocabulary-facts")).toContainText(label);
  await h.restartBrowser(); center = await document(h, "learning-center.html#wordbook");
  expect((await center.evaluate(() => chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_LIST" }))).entries).toEqual(book.entries);
  page = await content(h); if (method === "browser-local") await nativeVocabulary(h, page);
  await select(page); await expect(page.locator(".tf-selection-result")).toContainText(label);
  expect(h.server.calls).toHaveLength(count);
  if (method === "browser-local") expect((await nativeVocabulary(h, page, true)).inputs).toHaveLength(0);
 });
}

test("rate-limit diagnostics survive reload and expire locally without hidden retries", async ({ harness: h }) => {
 await h.serviceWorker.evaluate(() => { __completeness429 = true; });
 const settings = await document(h, "options.html#general");
 await settings.clock.install(); await settings.locator("#mt-test").click();
 await expect(settings.locator(".mt-diagnostics")).toBeVisible(); await settings.locator(".mt-diagnostics summary").click();
 await expect(settings.locator(".mt-diagnostics")).toContainText(/微软翻译.*\d+/);
 const count = await h.serviceWorker.evaluate(() => __completenessCalls.length);
 await settings.reload(); await expect(settings.locator(".mt-diagnostics")).toBeVisible();
 await settings.clock.runFor(125000); await expect(settings.locator(".mt-diagnostics")).toHaveCount(0);
 expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(count); expect(h.server.calls).toHaveLength(0);
});

test("wordbook export/import keeps AI notes, provenance and review schedule across a persistent-profile restart", async ({ harness: h }) => {
 const page = await content(h); await select(page); await expect(page.locator(".tf-selection-primary")).toContainText("合成译文");
 await page.getByRole("button", { name: "收藏到生词本", exact: true }).click();
 const tabId = await h.tabId(page);
 await h.driver.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, func: () => chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_ADD_AI_NOTE", note: { headword: "session", sourceLanguage: "en", targetLanguage: "zh", action: "usage", text: "Synthetic saved AI note; no provider call.", turnId: "backup-turn", provenance: { provider: "mock", model: "mock-model", promptVersion: "fixture-v1", providerConfigFingerprint: "synthetic-fingerprint" }, readingRef: null } }) }), tabId);
 const center = await document(h, "learning-center.html#wordbook");
 await center.evaluate(async () => {
  const book = (await chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_LIST" })).entries;
  await chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_REVIEW", id: book[0].id, rating: "know" });
 });
 const backup = await savedDownload(center, () => center.getByRole("button", { name: "导出生词本 JSON" }).click());
 expect(backup.store.entries[0].reviewCount).toBe(1); expect(backup.store.entries[0].aiNotes).toHaveLength(1);
 await center.locator("[data-entry-id]").getByRole("button", { name: "删除生词" }).click(); await center.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
 await expect(center.locator("[data-entry-id]")).toHaveCount(0);
 await importFile(center, backup); await expect(center.getByText("已导入 1 条，保留 0 条已有条目。", { exact: true })).toBeVisible();
 await importFile(center, backup); await expect(center.getByText("已导入 0 条，保留 1 条已有条目。", { exact: true })).toBeVisible();
 await h.restartBrowser(); const restored = await document(h, "learning-center.html#wordbook");
 expect((await restored.evaluate(() => chrome.runtime.sendMessage({ type: "VOCABULARY_BOOK_BACKUP" }))).backup.store).toEqual(backup.store);
 await restored.setViewportSize({ width: 360, height: 780 }); await restored.emulateMedia({ colorScheme: "dark" });
 await restored.screenshot({ path: test.info().outputPath("wordbook-backup-narrow-dark.png"), fullPage: true });
});

test("Reading imports commit atomically, preserve recording consent and exclusions, export v2 and survive restart", async ({ harness: h }) => {
 const center = await document(h, "learning-center.html");
 const source = snapshot(); source.sourceDigest = await createSourceDigest(source);
 const backup = { format: "translateflow-reading", schemaVersion: 2, exportedAt: 1000, records: [{ siteKey: "https://example.test", record: record({ safeReturnUrl: null }), snapshots: [source], artifacts: [artifact(), artifact("assistant")] }] };
 const before = (await reading(center, M.GET_RECORDING_STATE)).data;
 await importFile(center, backup); await expect(center.getByText("已导入 1 条，保留 0 条已有条目。", { exact: true })).toBeVisible();
 const after = (await reading(center, M.GET_RECORDING_STATE)).data; expect(after.enabled).toBe(before.enabled); expect(after.consentGeneration).toBe(before.consentGeneration); expect(after.recordCount).toBe(1);
 const exported = await savedDownload(center, () => center.getByRole("button", { name: "导出 JSON", exact: true }).click());
 expect(exported.schemaVersion).toBe(2); expect(exported.records[0]).toMatchObject({ record: backup.records[0].record, siteKey: backup.records[0].siteKey, snapshots: backup.records[0].snapshots }); expect(exported.records[0].artifacts.sort((a,b) => a.artifactId.localeCompare(b.artifactId))).toEqual([...backup.records[0].artifacts].sort((a,b) => a.artifactId.localeCompare(b.artifactId)));
 await importFile(center, '{"format":"translateflow-reading","records":['); await expect(center.getByText(/恢复未完成/)).toBeVisible();
 expect((await reading(center, M.GET_RECORDING_STATE)).data.recordCount).toBe(1);
 await importFile(center, backup); await expect(center.getByText("已导入 0 条，保留 1 条已有条目。", { exact: true })).toBeVisible();
 await h.restartBrowser(); const reopened = await document(h, "learning-center.html");
 const restored = (await reading(reopened, M.GET_RECORD, { recordId: backup.records[0].record.recordId })).data;
 expect(restored.record.itemText).toBe(backup.records[0].record.itemText); expect(restored.snapshots).toEqual(backup.records[0].snapshots); expect(restored.artifacts).toEqual(exported.records[0].artifacts);
});

test("Reading staged imports cannot cross documents, survive cancellation or write after navigation", async ({ harness: h }) => {
 const center = await document(h, "learning-center.html"), other = await document(h, "learning-center.html");
 const start = async () => {
  const result = await reading(center, M.IMPORT_START, { bytes: 100 }); expect(result.ok).toBe(true); return result.data.importId;
 };
 let importId = await start();
 expect((await reading(center, M.IMPORT_CHUNK, { importId, sequence: 0, jsonChunk: '{"records":[' })).ok).toBe(true);
 expect(await reading(other, M.IMPORT_FINISH, { importId })).toMatchObject({ ok: false, error: { code: "READING_STALE_OPERATION" } });
 expect((await reading(center, M.IMPORT_CANCEL, { importId })).data).toEqual({ cancelled: true });
 expect(await reading(center, M.IMPORT_FINISH, { importId })).toMatchObject({ ok: false, error: { code: "READING_STALE_OPERATION" } });
 importId = await start(); await center.reload();
 expect(await reading(center, M.IMPORT_FINISH, { importId })).toMatchObject({ ok: false, error: { code: "READING_STALE_OPERATION" } });
 expect((await reading(center, M.GET_RECORDING_STATE)).data).toMatchObject({ enabled: false, recordCount: 0 });
 const fresh = await start(); expect((await reading(center, M.IMPORT_CANCEL, { importId: fresh })).data.cancelled).toBe(true);
 expect(h.server.calls).toHaveLength(0); expect(await h.serviceWorker.evaluate(() => __completenessCalls.length)).toBe(0);
});
