import { MACHINE_ENGINE, machineSourceIdentity } from "../shared/machine-translation.js";
import { CACHE_SCHEMA_VERSION, PROVIDER_IDS } from "../shared/constants.js";
import { byteLength, sha256 } from "../shared/hash.js";
import { normalizeOpenAIBaseUrl } from "../shared/provider-config.js";
import { isProviderProtocol, normalizeProviderBaseUrl } from "../shared/provider-connections.js";
import { normalizeSourceText } from "../shared/text.js";
import { normalizeUrl } from "../shared/url.js";

const DB_NAME = "ai_bilingual_translator";
// This upgrade discards old translation/page rows; Reading records use another database.
const DB_VERSION = 3;
const TRANSLATIONS = "translations";
const PAGES = "pages";
const SELECTION_EXPLANATIONS = "selection_explanations";
const MAX_SELECTION_EXPLANATIONS = 256;

let dbPromise;

export async function getCacheContext(pageUrl, config) {
  const normalizedUrl = normalizeUrl(pageUrl);
  const [pageKey, configHash] = await Promise.all([
    sha256(normalizedUrl),
    getConfigHash(config)
  ]);
  return { normalizedUrl, pageKey, configHash, pageConfigKey: `${pageKey}:${configHash}` };
}

export async function lookupTranslations({ pageUrl, segments, config }) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { hits: [], pageKey: "", normalizedUrl: "" };
  }

  const db = await openDb();
  const ctx = await getCacheContext(pageUrl, config);
  const hashed = await Promise.all(segments.map(async (segment) => ({
    id: String(segment.id),
    text: String(segment.text),
    sourceHash: await translationSourceHash(segment.text, config, segment.protectedIds)
  })));

  const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite");
  const store = tx.objectStore(TRANSLATIONS);
  const now = Date.now();
  const hits = [];

  const lookups = hashed.map((segment) => ({
    segment,
    cacheKey: `${ctx.pageConfigKey}:${segment.sourceHash}`
  }));
  const records = await Promise.all(lookups.map(({ cacheKey }) => requestAsPromise(store.get(cacheKey))));

  for (let i = 0; i < lookups.length; i += 1) {
    const { segment } = lookups[i];
    const record = records[i];
    if (!record?.translation || record.cacheSchema !== CACHE_SCHEMA_VERSION) continue;
    if (normalizeSourceText(record.sourceText) !== normalizeSourceText(segment.text)) continue;

    hits.push({ id: segment.id, text: record.translation });
    record.lastAccessedAt = now;
    store.put(record);
  }

  if (hits.length) {
    const pages = tx.objectStore(PAGES);
    const page = await requestAsPromise(pages.get(ctx.pageKey));
    if (page) pages.put({ ...page, lastAccessedAt: now });
  }

  await transactionDone(tx);
  return { hits, pageKey: ctx.pageKey, normalizedUrl: ctx.normalizedUrl };
}

export async function storeTranslations({ pageUrl, pageTitle = "", items, config }) {
  if (!Array.isArray(items) || items.length === 0) return { stored: 0 };

  const db = await openDb();
  const ctx = await getCacheContext(pageUrl, config);
  const prepared = await Promise.all(items.map(async (item) => {
    const sourceText = String(item.sourceText || "");
    const translation = String(item.translation || "").trim();
    const sourceHash = await translationSourceHash(sourceText, config, item.protectedIds);
    const cacheKey = `${ctx.pageConfigKey}:${sourceHash}`;
    return {
      cacheKey,
      cacheSchema: CACHE_SCHEMA_VERSION,
      pageKey: ctx.pageKey,
      pageConfigKey: ctx.pageConfigKey,
      configHash: ctx.configHash,
      sourceHash,
      sourceText,
      translation,
      bytes: byteLength(sourceText) + byteLength(translation) + byteLength(cacheKey) + 256
    };
  }));

  const now = Date.now();
  const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite");
  const translations = tx.objectStore(TRANSLATIONS);
  const pages = tx.objectStore(PAGES);
  let stored = 0;

  for (const record of prepared) {
    if (!record.sourceText || !record.translation) continue;
    const existing = await requestAsPromise(translations.get(record.cacheKey));
    translations.put({
      ...existing,
      ...record,
      createdAt: existing?.createdAt || now,
      lastAccessedAt: now
    });
    stored += 1;
  }

  const existingPage = await requestAsPromise(pages.get(ctx.pageKey));
  pages.put({
    ...existingPage,
    pageKey: ctx.pageKey,
    url: ctx.normalizedUrl,
    title: String(pageTitle || existingPage?.title || "").slice(0, 500),
    createdAt: existingPage?.createdAt || now,
    lastAccessedAt: now
  });

  await transactionDone(tx);
  return { stored, pageKey: ctx.pageKey, normalizedUrl: ctx.normalizedUrl };
}

export async function lookupSelectionExplanation({ cacheKey }) {
  const key = String(cacheKey || "");
  if (!key) return { hit: null };

  const db = await openDb();
  const tx = db.transaction(SELECTION_EXPLANATIONS, "readwrite");
  const store = tx.objectStore(SELECTION_EXPLANATIONS);
  const record = await requestAsPromise(store.get(key));
  if (record) {
    record.lastAccessedAt = Date.now();
    store.put(record);
  }
  await transactionDone(tx);
  return {
    hit: record?.result || null,
    createdAt: record?.createdAt || null
  };
}

export async function storeSelectionExplanation({ cacheKey, result }) {
  const key = String(cacheKey || "");
  if (!key || !result || typeof result !== "object" || Array.isArray(result)) {
    return { stored: 0 };
  }

  const db = await openDb();
  const serialized = JSON.stringify(result);
  const now = Date.now();
  const tx = db.transaction(SELECTION_EXPLANATIONS, "readwrite");
  const store = tx.objectStore(SELECTION_EXPLANATIONS);
  const existing = await requestAsPromise(store.get(key));
  store.put({
    ...existing,
    cacheKey: key,
    result,
    bytes: byteLength(key) + byteLength(serialized) + 256,
    createdAt: existing?.createdAt || now,
    lastAccessedAt: now
  });
  await transactionDone(tx);
  await pruneSelectionExplanationCount(db);
  return { stored: 1 };
}

export async function getPageCacheStatus({ pageUrl, config }) {
  const db = await openDb();
  const ctx = await getCacheContext(pageUrl, config);
  const tx = db.transaction([TRANSLATIONS, PAGES], "readonly");
  const translations = tx.objectStore(TRANSLATIONS);
  const page = await requestAsPromise(tx.objectStore(PAGES).get(ctx.pageKey));
  const count = await requestAsPromise(translations.index("pageConfigKey").count(ctx.pageConfigKey));
  const totalCount = await requestAsPromise(translations.index("pageKey").count(ctx.pageKey));
  await transactionDone(tx);

  return {
    count,
    totalCount,
    pageKey: ctx.pageKey,
    normalizedUrl: ctx.normalizedUrl,
    title: page?.title || "",
    lastAccessedAt: page?.lastAccessedAt || null
  };
}

export async function clearPageCache({ pageUrl }) {
  const db = await openDb();
  const normalizedUrl = normalizeUrl(pageUrl);
  const pageKey = await sha256(normalizedUrl);
  const tx = db.transaction([TRANSLATIONS, PAGES], "readwrite");
  const translations = tx.objectStore(TRANSLATIONS);
  const index = translations.index("pageKey");
  let deleted = 0;

  await iterateCursor(index.openCursor(IDBKeyRange.only(pageKey)), (cursor) => {
    cursor.delete();
    deleted += 1;
  });
  tx.objectStore(PAGES).delete(pageKey);
  await transactionDone(tx);
  return { deleted, normalizedUrl };
}

export async function clearAllCache() {
  const db = await openDb();
  const tx = db.transaction([TRANSLATIONS, PAGES, SELECTION_EXPLANATIONS], "readwrite");
  tx.objectStore(TRANSLATIONS).clear();
  tx.objectStore(PAGES).clear();
  tx.objectStore(SELECTION_EXPLANATIONS).clear();
  await transactionDone(tx);
  return { cleared: true };
}

export async function getCacheStats() {
  const db = await openDb();
  const tx = db.transaction([TRANSLATIONS, PAGES, SELECTION_EXPLANATIONS], "readonly");
  const translations = tx.objectStore(TRANSLATIONS);
  const explanations = tx.objectStore(SELECTION_EXPLANATIONS);
  const [segmentCount, pageCount, selectionExplanationCount] = await Promise.all([
    requestAsPromise(translations.count()),
    requestAsPromise(tx.objectStore(PAGES).count()),
    requestAsPromise(explanations.count())
  ]);
  let bytes = 0;

  await iterateCursor(translations.openCursor(), (cursor) => {
    bytes += Number(cursor.value?.bytes || 0);
  });
  await iterateCursor(explanations.openCursor(), (cursor) => {
    bytes += Number(cursor.value?.bytes || 0);
  });
  await transactionDone(tx);
  return { pageCount, segmentCount, selectionExplanationCount, bytes };
}

export async function pruneCache(maxBytes) {
  const limit = Math.max(5 * 1024 * 1024, Number(maxBytes) || 0);
  const stats = await getCacheStats();
  if (!limit || stats.bytes <= limit) return { ...stats, deleted: 0 };

  const db = await openDb();
  const tx = db.transaction(TRANSLATIONS, "readwrite");
  const index = tx.objectStore(TRANSLATIONS).index("lastAccessedAt");
  let bytes = stats.bytes;
  let deleted = 0;
  const affectedPages = new Set();

  await iterateCursor(index.openCursor(), (cursor) => {
    if (bytes <= limit) return false;
    const record = cursor.value || {};
    bytes -= Number(record.bytes || 0);
    if (record.pageKey) affectedPages.add(record.pageKey);
    cursor.delete();
    deleted += 1;
    return true;
  });
  await transactionDone(tx);

  if (affectedPages.size) await removeOrphanPages(affectedPages);
  const finalStats = await getCacheStats();
  return { ...finalStats, deleted };
}

export function translationSourceHash(text, config, protectedIds) {
  return sha256(config?.engine === MACHINE_ENGINE ? machineSourceIdentity(text, protectedIds) : normalizeSourceText(text));
}

export async function getConfigHash(config) {
  if (config?.engine === MACHINE_ENGINE) return sha256(JSON.stringify({
    cacheSchema: CACHE_SCHEMA_VERSION, engine: MACHINE_ENGINE, provider: config.provider, endpoint: config.apiBaseUrl,
    sourceLanguage: config.sourceLanguage, targetLanguage: config.targetLanguage, protocol: config.protocol, inputVersion: config.inputVersion
  }));
  const provider = String(config?.provider || PROVIDER_IDS.DEEPSEEK).trim();
  const payload = {
    cacheSchema: CACHE_SCHEMA_VERSION,
    provider,
    model: String(config?.model || "").trim(),
    targetLanguage: String(config?.targetLanguage || "").trim(),
    prompt: String(config?.prompt || "").trim()
  };

  if (provider === "browser-translator") payload.sourceLanguage = String(config.sourceLanguage || "");

  if (config?.connectionId) {
    payload.connectionId = String(config.connectionId);
    payload.connectionRevision = Number(config.connectionRevision || 0);
    payload.protocol = String(config.protocol || provider);
  }

  if (isProviderProtocol(provider)) {
    payload.endpoint = normalizeProviderBaseUrl(config?.apiBaseUrl || "");
  } else if (provider === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    payload.endpoint = normalizeOpenAIBaseUrl(config?.apiBaseUrl || "");
  } else if (provider === PROVIDER_IDS.CHATGPT_PLAN) {
    payload.endpoint = String(config?.apiBaseUrl || "");
  }

  if (Array.isArray(config?.glossaryIdentity) && config.glossaryIdentity.length) {
    payload.glossary = config.glossaryIdentity;
  }

  return sha256(JSON.stringify(payload));
}

async function removeOrphanPages(pageKeys) {
  const db = await openDb();
  for (const pageKey of pageKeys) {
    const checkTx = db.transaction(TRANSLATIONS, "readonly");
    const count = await requestAsPromise(checkTx.objectStore(TRANSLATIONS).index("pageKey").count(pageKey));
    await transactionDone(checkTx);
    if (count > 0) continue;

    const deleteTx = db.transaction(PAGES, "readwrite");
    deleteTx.objectStore(PAGES).delete(pageKey);
    await transactionDone(deleteTx);
  }
}

function openDb() {
  if (dbPromise) return dbPromise;
  const opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let rejected = false;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // One-way cache reset: never parse, migrate or fall back to pre-v3 translations.
      // Only these two translation stores are disposable. In particular,
      // selection_explanations and the separate ReadingRecord database survive.
      if (event.oldVersion > 0 && event.oldVersion < DB_VERSION) {
        if (db.objectStoreNames.contains(TRANSLATIONS)) db.deleteObjectStore(TRANSLATIONS);
        if (db.objectStoreNames.contains(PAGES)) db.deleteObjectStore(PAGES);
      }
      if (!db.objectStoreNames.contains(TRANSLATIONS)) {
        const store = db.createObjectStore(TRANSLATIONS, { keyPath: "cacheKey" });
        store.createIndex("pageKey", "pageKey", { unique: false });
        store.createIndex("pageConfigKey", "pageConfigKey", { unique: false });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(PAGES)) {
        const store = db.createObjectStore(PAGES, { keyPath: "pageKey" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(SELECTION_EXPLANATIONS)) {
        const store = db.createObjectStore(SELECTION_EXPLANATIONS, { keyPath: "cacheKey" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked upgrade can subsequently finish after callers have received
      // the error. Close that late connection rather than leaking a v3 handle.
      if (rejected) { db.close(); return; }
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { rejected = true; reject(request.error || new Error("无法打开 IndexedDB。")); };
    request.onblocked = () => { rejected = true; reject(new Error("IndexedDB 升级被其他扩展页面阻塞，请关闭扩展设置页后重试。")); };
  });
  dbPromise = opening.catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

async function pruneSelectionExplanationCount(db) {
  const countTx = db.transaction(SELECTION_EXPLANATIONS, "readonly");
  const count = await requestAsPromise(countTx.objectStore(SELECTION_EXPLANATIONS).count());
  await transactionDone(countTx);
  let excess = count - MAX_SELECTION_EXPLANATIONS;
  if (excess <= 0) return;

  const pruneTx = db.transaction(SELECTION_EXPLANATIONS, "readwrite");
  const index = pruneTx.objectStore(SELECTION_EXPLANATIONS).index("lastAccessedAt");
  await iterateCursor(index.openCursor(), (cursor) => {
    if (excess <= 0) return false;
    cursor.delete();
    excess -= 1;
    return true;
  });
  await transactionDone(pruneTx);
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败。"));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB 事务失败。"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB 事务已中止。"));
  });
}

function iterateCursor(request, callback) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error || new Error("IndexedDB 游标失败。"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const shouldContinue = callback(cursor);
      if (shouldContinue === false) return resolve();
      cursor.continue();
    };
  });
}
