import {
  lookupTranslations,
  storeTranslations,
  getPageCacheStatus,
  clearPageCache,
  clearAllCache,
  getCacheStats,
  pruneCache
} from "./cache-db.js";

const DEFAULTS = {
  apiKey: "",
  model: "deepseek-flash",
  targetLanguage: "Simplified Chinese",
  cacheMaxMB: 200,
  autoSites: [],
  prompt: [
    "You are a professional translator.",
    "Translate the provided English web-page segments into natural Simplified Chinese.",
    "Preserve technical terms, product names, API names, variable names, URLs, Markdown-like symbols and code-like tokens when appropriate.",
    "Do not add explanations.",
    "Return valid JSON only, exactly in this shape: {\"translations\":[{\"id\":\"...\",\"text\":\"...\"}] }.",
    "Every input id must appear exactly once in the output."
  ].join("\n")
};

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  if (reason === "update" || reason === "install") await removeLegacyV1Cache();
  await syncAutoSiteRegistrations();
});

chrome.runtime.onStartup.addListener(() => {
  syncAutoSiteRegistrations().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "TRANSLATE_BATCH":
      return { translations: await translateBatch(message.segments) };
    case "TEST_API":
      return { result: await testApi() };
    case "CACHE_LOOKUP":
      return lookupTranslations({
        pageUrl: message.pageUrl,
        segments: message.segments,
        config: await getConfig()
      });
    case "CACHE_STORE":
      return storeTranslations({
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        items: message.items,
        config: await getConfig()
      });
    case "CACHE_PAGE_STATUS":
      return getPageCacheStatus({ pageUrl: message.pageUrl, config: await getConfig() });
    case "CACHE_CLEAR_PAGE":
      return clearPageCache({ pageUrl: message.pageUrl });
    case "CACHE_CLEAR_ALL":
      return clearAllCache();
    case "CACHE_STATS":
      return getCacheStats();
    case "CACHE_PRUNE": {
      const { cacheMaxMB } = await getConfig();
      return pruneCache(Number(cacheMaxMB || DEFAULTS.cacheMaxMB) * 1024 * 1024);
    }
    case "AUTO_SITE_REGISTER":
      return registerAutoSite(message.origin);
    case "AUTO_SITE_UNREGISTER":
      return unregisterAutoSite(message.origin);
    default:
      throw new Error("未知扩展消息。 ");
  }
}

async function getConfig() {
  const config = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...config };
}

async function requestDeepSeek(body) {
  const { apiKey } = await getConfig();
  if (!apiKey?.trim()) throw new Error("请先在设置中填写 DeepSeek API Key。");

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`DeepSeek 返回了非 JSON 响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(`DeepSeek API 请求失败：${detail}`);
  }
  return data;
}

async function translateBatch(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const { model, prompt } = await getConfig();
  const payload = {
    segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
  };

  const data = await requestDeepSeek({
    model: model?.trim() || DEFAULTS.model,
    messages: [
      { role: "system", content: prompt?.trim() || DEFAULTS.prompt },
      { role: "user", content: JSON.stringify(payload) }
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    stream: false,
    temperature: 0.2
  });

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek 没有返回翻译内容。");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("DeepSeek 返回内容无法解析为 JSON。请重试或检查自定义 Prompt。");
  }
  if (!Array.isArray(parsed.translations)) {
    throw new Error("DeepSeek 返回格式不正确：缺少 translations 数组。");
  }

  const validIds = new Set(segments.map((x) => String(x.id)));
  return parsed.translations
    .filter((item) => validIds.has(String(item.id)) && typeof item.text === "string")
    .map((item) => ({ id: String(item.id), text: item.text.trim() }));
}

async function testApi() {
  const { model } = await getConfig();
  const data = await requestDeepSeek({
    model: model?.trim() || DEFAULTS.model,
    messages: [
      { role: "system", content: "Reply with exactly: OK" },
      { role: "user", content: "Connection test" }
    ],
    thinking: { type: "disabled" },
    stream: false,
    temperature: 0
  });
  return data?.choices?.[0]?.message?.content?.trim() || "OK";
}

async function removeLegacyV1Cache() {
  const all = await chrome.storage.local.get(null);
  const legacyKeys = Object.keys(all).filter((key) => key.startsWith("abt-cache-v1:"));
  if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
}


async function registerAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const match = getOriginMatchPattern(origin);
  const permitted = await chrome.permissions.contains({ origins: [match] });
  if (!permitted) throw new Error("尚未获得此站点的自动翻译权限。");

  const id = await getAutoScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });

  await chrome.scripting.registerContentScripts([{
    id,
    matches: [match],
    js: ["content.js"],
    css: ["content.css"],
    runAt: "document_idle",
    persistAcrossSessions: true
  }]);

  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const next = [...new Set([...(Array.isArray(autoSites) ? autoSites : []), origin])].sort();
  await chrome.storage.local.set({ autoSites: next });
  return { origin, enabled: true };
}

async function unregisterAutoSite(rawOrigin) {
  const origin = normalizeOrigin(rawOrigin);
  const id = await getAutoScriptId(origin);
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // Registration may already be gone after an extension reload/update.
  }

  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const next = (Array.isArray(autoSites) ? autoSites : []).filter((item) => item !== origin);
  await chrome.storage.local.set({ autoSites: next });
  return { origin, enabled: false };
}

async function syncAutoSiteRegistrations() {
  const { autoSites = [] } = await chrome.storage.local.get(["autoSites"]);
  const validSites = [];
  const desiredIds = new Set();

  for (const rawOrigin of Array.isArray(autoSites) ? autoSites : []) {
    let origin;
    try {
      origin = normalizeOrigin(rawOrigin);
    } catch {
      continue;
    }

    const match = getOriginMatchPattern(origin);
    if (!(await chrome.permissions.contains({ origins: [match] }))) continue;
    try {
      await registerAutoSite(origin);
      validSites.push(origin);
      desiredIds.add(await getAutoScriptId(origin));
    } catch {
      // Keep startup resilient if one site registration fails.
    }
  }

  const registered = await chrome.scripting.getRegisteredContentScripts();
  const staleIds = registered
    .map((item) => item.id)
    .filter((id) => id.startsWith("abt_auto_") && !desiredIds.has(id));
  if (staleIds.length) await chrome.scripting.unregisterContentScripts({ ids: staleIds });

  const normalized = [...new Set(validSites)].sort();
  const current = [...new Set((Array.isArray(autoSites) ? autoSites : []).map(String))].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(current)) {
    await chrome.storage.local.set({ autoSites: normalized });
  }
}

function normalizeOrigin(rawOrigin) {
  const url = new URL(String(rawOrigin || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("仅支持 http/https 站点自动翻译。");
  return `${url.protocol}//${url.hostname}`;
}

function getOriginMatchPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

async function getAutoScriptId(origin) {
  const bytes = new TextEncoder().encode(origin);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `abt_auto_${hex}`;
}
