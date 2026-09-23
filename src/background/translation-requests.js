import { translateBatch } from "./providers/index.js";

const inflightByKey = new Map();
const requestsById = new Map();

export async function runTranslationRequest({ requestId, segments, config }) {
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
      settled: false,
      promise: null
    };
    entry.promise = translateBatch(segments, requestConfig, { signal: controller.signal })
      .finally(() => {
        entry.settled = true;
        inflightByKey.delete(key);
      });
    inflightByKey.set(key, entry);
  }

  entry.consumers.add(id);
  requestsById.set(id, entry);

  try {
    const translations = await entry.promise;
    if (!entry.consumers.has(id)) throw createCancelledError();
    return translations;
  } finally {
    entry.consumers.delete(id);
    if (requestsById.get(id) === entry) requestsById.delete(id);
  }
}

export function cancelTranslationRequest(requestId) {
  const id = String(requestId || "");
  const entry = requestsById.get(id);
  if (!entry) return { cancelled: false };

  entry.consumers.delete(id);
  requestsById.delete(id);

  if (!entry.settled && entry.consumers.size === 0) {
    entry.controller.abort();
  }
  return { cancelled: true };
}

export function buildTranslationRequestKey(segments, config) {
  return JSON.stringify({
    provider: String(config?.provider || ""),
    apiBaseUrl: String(config?.apiBaseUrl || ""),
    model: String(config?.model || ""),
    prompt: String(config?.prompt || ""),
    targetLanguage: String(config?.targetLanguage || ""),
    segments: (Array.isArray(segments) ? segments : []).map((item) => ({
      id: String(item.id),
      text: String(item.text)
    }))
  });
}

function createCancelledError() {
  const error = new Error("翻译请求已取消。");
  error.code = "CANCELLED";
  return error;
}


function withStructuredMarkerInstruction(segments, config) {
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
