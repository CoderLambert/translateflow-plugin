import { MACHINE_ENGINE, normalizeProtectedIds } from "../shared/machine-translation.js";
import { executeTranslation } from "./translation-gateway.js";

const inflightByKey = new Map();
const requestsById = new Map();

export async function runTranslationRequest({ requestId, segments, config, pageUrl = "", ownerTabId = null }) {
  const id = String(requestId || crypto.randomUUID());
  const requestConfig = withStructuredMarkerInstruction(segments, config);
  const key = buildTranslationRequestKey(segments, requestConfig);

  let entry = inflightByKey.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      key,
      controller,
      consumers: new Set(),
      pages: new Map(),
      tabs: new Map(),
      engine: requestConfig.engine,
      settled: false,
      promise: null
    };
    entry.promise = executeTranslation({
      segments,
      config: requestConfig,
      signal: controller.signal
    })
      .finally(() => {
        entry.settled = true;
        inflightByKey.delete(key);
      });
    inflightByKey.set(key, entry);
  }

  entry.consumers.add(id);
  entry.pages.set(id, pageUrl); entry.tabs.set(id, ownerTabId);
  requestsById.set(id, entry);

  try {
    const translations = await entry.promise;
    if (!entry.consumers.has(id)) throw createCancelledError();
    return translations;
  } finally {
    entry.consumers.delete(id); entry.pages.delete(id); entry.tabs.delete(id);
    if (requestsById.get(id) === entry) requestsById.delete(id);
  }
}

export function cancelTranslationRequest(requestId) {
  const id = String(requestId || "");
  const entry = requestsById.get(id);
  if (!entry) return { cancelled: false };

  entry.consumers.delete(id); entry.pages.delete(id); entry.tabs.delete(id);
  requestsById.delete(id);

  if (!entry.settled && entry.consumers.size === 0) {
    entry.controller.abort();
  }
  return { cancelled: true };
}

export function cancelTextTranslations(pageUrl = "") {
  for (const [id, entry] of requestsById) if (!pageUrl || entry.pages.get(id) === pageUrl) cancelTranslationRequest(id);
}

export function cancelMachineTranslations(tabId = null) {
  for (const [id, entry] of requestsById) if (entry.engine === MACHINE_ENGINE && (tabId === null || entry.tabs.get(id) === tabId)) cancelTranslationRequest(id);
}

export function buildTranslationRequestKey(segments, config) {
  return JSON.stringify({
    ...(config?.engine === MACHINE_ENGINE ? { engine: config.engine, sourceLanguage: config.sourceLanguage, inputVersion: config.inputVersion } : {}),
    provider: String(config?.provider || ""),
    connectionId: String(config?.connectionId || ""),
    connectionRevision: Number(config?.connectionRevision || 0),
    apiBaseUrl: String(config?.apiBaseUrl || ""),
    model: String(config?.model || ""),
    prompt: String(config?.prompt || ""),
    targetLanguage: String(config?.targetLanguage || ""),
    segments: (Array.isArray(segments) ? segments : []).map((item) => ({
      id: String(item.id),
      text: String(item.text),
      ...(config?.engine === MACHINE_ENGINE ? { protectedIds: normalizeProtectedIds(item.protectedIds) } : {})
    }))
  });
}

function createCancelledError() {
  const error = new Error("翻译请求已取消。");
  error.code = "CANCELLED";
  return error;
}


function withStructuredMarkerInstruction(segments, config) {
  if (config?.engine === MACHINE_ENGINE) return config;
  const hasMarkers = (Array.isArray(segments) ? segments : [])
    .some((item) => /⟦TF:\d+:[SE]⟧/.test(String(item?.text || "")));
  if (!hasMarkers) return config;
  const protocol = [
    "TranslateFlow structured-marker protocol:",
    "Preserve every marker matching ⟦TF:<number>:S⟧ or ⟦TF:<number>:E⟧ exactly,",
    "keep marker pairs balanced and nested, and do not add, remove, reorder, or translate marker text.",
    "Text inside code or kbd marker pairs is technical content and should remain unchanged."
  ].join(" ");
  return { ...config, prompt: `${String(config?.prompt || "").trim()}\n${protocol}`.trim() };
}
