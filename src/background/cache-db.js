import { CACHE_SCHEMA_VERSION, PROVIDER_IDS } from "../shared/constants.js";
import { byteLength, sha256 } from "../shared/hash.js";
import { normalizeOpenAIBaseUrl } from "../shared/provider-config.js";
import { normalizeSourceText } from "../shared/text.js";
import { normalizeUrl } from "../shared/url.js";

const DB_NAME = "ai_bilingual_translator";
const DB_VERSION = 1;
const TRANSLATIONS = "translations";
const PAGES = "pages";

let dbPromise;

export async function getCacheContext(pageUrl, config) {
  const normalizedUrl = normalizeUrl(pageUrl);
  const [pageKey, configHash] = await Promise.all([sha256(normalizedUrl), getConfigHash(config)]);
  return { normalizedUrl, pageKey, configHash, pageConfigKey: `${pageKey}:${configHash}` };
}

export async function lookupTranslations({ pageUrl, segments, config }) {
  if (!Array.isArray(segments) || segments.length === 0) return { hits: [], pageKey: "", normalizedUrl: "" };
  const db = await openDb();
  const ctx = await getCacheContext(pageUrl, config);
  const hashed = await Promise.all(segments.map(async (segment) => ({ id: String(segment.id), text: String(segment.text), sourceHash: await sha256(normalizeSourceText(segment.text)) })));
  const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite");
  const store = tx.objectStore(TRANSLATIONS);
  const now = Date.now();
  const hits = [];
  const lookups = hashed.map((segment) => ({ segment, cacheKey: `${ctx.pageConfigKey}:${segment.sourceHash}` }));
  const records = await Promise.all(lookups.map(({ cacheKey }) => requestAsPromise(store.get(cacheKey))));
  for (let i = 0; i < lookups.length; i += 1) {
    const { segment } = lookups[i]; const record = records[i];
    if (!record?.translation || normalizeSourceText(record.sourceText) !== normalizeSourceText(segment.text)) continue;
    hits.push({ id: segment.id, text: record.translation }); record.lastAccessedAt = now; store.put(record);
  }
  if (hits.length) { const pages = tx.objectStore(PAGES); const page = await requestAsPromise(pages.get(ctx.pageKey)); if (page) pages.put({ ...page, lastAccessedAt: now }); }
  await transactionDone(tx); return { hits, pageKey: ctx.pageKey, normalizedUrl: ctx.normalizedUrl };
}

export async function storeTranslations({ pageUrl, pageTitle = "", items, config }) {
  if (!Array.isArray(items) || items.length === 0) return { stored: 0 };
  const db = await openDb(); const ctx = await getCacheContext(pageUrl, config);
  const prepared = await Promise.all(items.map(async (item) => { const sourceText = String(item.sourceText || ""); const translation = String(item.translation || "").trim(); const sourceHash = await sha256(normalizeSourceText(sourceText)); const cacheKey = `${ctx.pageConfigKey}:${sourceHash}`; return { cacheKey, pageKey: ctx.pageKey, pageConfigKey: ctx.pageConfigKey, configHash: ctx.configHash, sourceHash, sourceText, translation, bytes: byteLength(sourceText) + byteLength(translation) + byteLength(cacheKey) + 256 }; }));
  const now = Date.now(); const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite"); const translations = tx.objectStore(TRANSLATIONS); const pages = tx.objectStore(PAGES); let stored = 0;
  for (const record of prepared) { if (!record.sourceText || !record.translation) continue; const existing = await requestAsPromise(translations.get(record.cacheKey)); translations.put({ ...existing, ...record, createdAt: existing?.createdAt || now, lastAccessedAt: now }); stored += 1; }
  const existingPage = await requestAsPromise(pages.get(ctx.pageKey)); pages.put({ ...existingPage, pageKey: ctx.pageKey, url: ctx.normalizedUrl, title: String(pageTitle || existingPage?.title || "").slice(0, 500), createdAt: existingPage?.createdAt || now, lastAccessedAt: now });
  await transactionDone(tx); return { stored, pageKey: ctx.pageKey, normalizedUrl: ctx.normalizedUrl };
}

export async function getPageCacheStatus({ pageUrl, config }) { const db = await openDb(); const ctx = await getCacheContext(pageUrl, config); const tx = db.transaction([TRANSLATIONS, PAGES], "readonly"); const translations = tx.objectStore(TRANSLATIONS); const page = await requestAsPromise(tx.objectStore(PAGES).get(ctx.pageKey)); const count = await requestAsPromise(translations.index("pageConfigKey").count(ctx.pageConfigKey)); const totalCount = await requestAsPromise(translations.index("pageKey").count(ctx.pageKey)); await transactionDone(tx); return { count, totalCount, pageKey: ctx.pageKey, normalizedUrl: ctx.normalizedUrl, title: page?.title || "", lastAccessedAt: page?.lastAccessedAt || null }; }
export async function clearPageCache({ pageUrl }) { const db = await openDb(); const normalizedUrl = normalizeUrl(pageUrl); const pageKey = await sha256(normalizedUrl); const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite"); const translations = tx.objectStore(TRANSLATIONS); const index = translations.index("pageKey"); let deleted = 0; await iterateCursor(index.openCursor(IDBKeyRange.only(pageKey)), (cursor) => { cursor.delete(); deleted += 1; }); tx.objectStore(PAGES).delete(pageKey); await transactionDone(tx); return { deleted, normalizedUrl }; }
export async function clearAllCache() { const db = await openDb(); const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite"); tx.objectStore(TRANSLATIONS).clear(); tx.objectStore(PAGES).clear(); await transactionDone(tx); return { cleared: true }; }
export async function getCacheStats() { const db = await openDb(); const tx = db.transaction([TRANSLATIONS, PAGES], "readonly"); const translations = tx.objectStore(TRANSLATIONS); const segmentCount = await requestAsPromise(translations.count()); const pageCount = await requestAsPromise(tx.objectStore(PAGES).count()); let bytes = 0; await iterateCursor(translations.openCursor(), (cursor) => { bytes += Number(cursor.value?.bytes || 0); }); await transactionDone(tx); return { pageCount, segmentCount, bytes }; }
export async function pruneCache(maxBytes) { const limit = Math.max(5 * 1024 * 1024, Number(maxBytes) || 0); const stats = await getCacheStats(); if (!limit || stats.bytes <= limit) return { ...stats, deleted: 0 }; const db = await openDb(); const tx = db.transaction(TRANSLATIONS, "readwrite"); const index = tx.objectStore(TRANSLATIONS).index("lastAccessedAt"); let bytes = stats.bytes; let deleted = 0; const affectedPages = new Set(); await iterateCursor(index.openCursor(), (cursor) => { if (bytes <= limit) return false; const record = cursor.value || {}; bytes -= Number(record.bytes || 0); if (record.pageKey) affectedPages.add(record.pageKey); cursor.delete(); deleted += 1; return true; }); await transactionDone(tx); if (affectedPages.size) await removeOrphanPages(affectedPages); const finalStats = await getCacheStats(); return { ...finalStats, deleted }; }

async function getConfigHash(config) {
  const provider = String(config?.provider || PROVIDER_IDS.DEEPSEEK).trim();
  const payload = { cacheSchema: CACHE_SCHEMA_VERSION, provider, model: String(config?.model || "").trim(), targetLanguage: String(config?.targetLanguage || "").trim(), prompt: String(config?.prompt || "").trim() };
  if (provider === PROVIDER_IDS.OPENAI_COMPATIBLE) payload.endpoint = normalizeOpenAIBaseUrl(config?.apiBaseUrl || "");
  if (Array.isArray(config?.glossaryIdentity) && config.glossaryIdentity.length) payload.glossary = config.glossaryIdentity;
  return sha256(JSON.stringify(payload));
}

async function removeOrphanPages(pageKeys) { const db = await openDb(); for (const pageKey of pageKeys) { const checkTx = db.transaction(TRANSLATIONS, "readonly"); const count = await requestAsPromise(checkTx.objectStore(TRANSLATIONS).index("pageKey").count(pageKey)); await transactionDone(checkTx); if (count > 0) continue; const deleteTx = db.transaction(PAGES, "readwrite"); deleteTx.objectStore(PAGES).delete(pageKey); await transactionDone(deleteTx); } }
function openDb() { if (dbPromise) return dbPromise; dbPromise = new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, DB_VERSION); request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(TRANSLATIONS)) { const store = db.createObjectStore(TRANSLATIONS, { keyPath: "cacheKey" }); store.createIndex("pageKey", "pageKey", { unique: false }); store.createIndex("pageConfigKey", "pageConfigKey", { unique: false }); store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false }); } if (!db.objectStoreNames.contains(PAGES)) { const store = db.createObjectStore(PAGES, { keyPath: "pageKey" }); store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false }); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("无法打开 IndexedDB。")); request.onblocked = () => reject(new Error("IndexedDB 升级被其他扩展页面阻塞，请关闭扩展设置页后重试。")); }); return dbPromise; }
function requestAsPromise(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败。")); }); }
function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error || new Error("IndexedDB 事务失败。")); tx.onabort = () => reject(tx.error || new Error("IndexedDB 事务已中止。")); }); }
function iterateCursor(request, callback) { return new Promise((resolve, reject) => { request.onerror = () => reject(request.error || new Error("IndexedDB 游标失败。")); request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(); const shouldContinue = callback(cursor); if (shouldContinue === false) return resolve(); cursor.continue(); }; }); }
