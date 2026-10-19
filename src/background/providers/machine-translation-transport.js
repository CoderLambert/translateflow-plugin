import { machineError, machineLanguage, machineProvider } from "../../shared/machine-translation.js";
import { parseRetryAfterMs } from "../../shared/retry-policy.js";

const RESPONSE_LIMIT = 512 * 1024;
const queues = new Map();
const memoryCooldowns = new Map();
const active = new Set();

// One actual HTTP exchange per provider. Queue cancellation does not acquire a slot.
async function withSlot(id, signal, operation) {
  if (signal?.aborted) throw machineError("CANCELLED");
  let queue = queues.get(id);
  if (!queue) { queue = { busy: false, waiting: [] }; queues.set(id, queue); }
  if (queue.waiting.length >= 64) throw machineError("MT_BUSY");
  await new Promise((resolve, reject) => {
    const item = { start: () => { signal?.removeEventListener("abort", cancel); queue.busy = true; resolve(); } };
    const cancel = () => { const index = queue.waiting.indexOf(item); if (index >= 0) queue.waiting.splice(index, 1); reject(machineError("CANCELLED")); };
    if (!queue.busy) item.start();
    else { queue.waiting.push(item); signal?.addEventListener("abort", cancel, { once: true }); }
  });
  try { if (signal?.aborted) throw machineError("CANCELLED"); return await operation(); }
  finally { const next = queue.waiting.shift(); if (next) next.start(); else { queue.busy = false; queues.delete(id); } }
}

async function cooldown(id, value) {
  const key = `tfMtCooldown:${id}`, storage = globalThis.chrome?.storage?.local;
  if (value) {
    // A provider's HTTP 429/403 is authoritative even when storage is
    // unavailable. Keep the in-memory fence instead of turning the response
    // into an unrelated storage/network error.
    memoryCooldowns.set(id, value);
    try { await storage?.set({ [key]: value }); } catch { /* memory-only cooldown */ }
    return value;
  }
  let saved = null;
  try { saved = storage ? (await storage.get([key]))[key] : null; }
  catch { /* use the surviving in-memory cooldown */ }
  return [saved, memoryCooldowns.get(id)].filter(item => Number.isFinite(item?.until))
    .sort((a, b) => b.until - a.until)[0];
}

export function abortMachineHttp() { for (const controller of active) controller.abort(); }

export async function requestMachineTexts(config, texts, { signal, timeoutMs = 15000 } = {}) {
  const provider = machineProvider(config.provider);
  if (config.apiBaseUrl !== provider.origin + provider.path) throw machineError("MT_CONFIG");
  const from = machineLanguage(provider.id, config.sourceLanguage), to = machineLanguage(provider.id, config.targetLanguage, true);
  return withSlot(provider.id, signal, async () => {
    const limited = await cooldown(provider.id);
    if (limited?.until > Date.now()) throw machineError(limited.code === "MT_BLOCKED" ? "MT_BLOCKED" : "MT_RATE_LIMIT", { retryAfterMs: limited.until - Date.now() });
    if (globalThis.chrome && !await chrome.permissions.contains({ origins: [`${provider.origin}/*`] })) throw machineError("MT_PERMISSION");
    if (signal?.aborted) throw machineError("CANCELLED");
    const controller = new AbortController(); active.add(controller);
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const { url, body } = buildMachineRequest(provider.id, texts, from, to);
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
      if (response.status === 429 || response.status === 403) {
        const code = response.status === 429 ? "MT_RATE_LIMIT" : "MT_BLOCKED";
        const delay = Math.max(response.status === 429 ? 60000 : 300000, parseRetryAfterMs(response.headers.get("Retry-After")) || 0);
        await cooldown(provider.id, { until: Date.now() + delay, code });
        await response.body?.cancel();
        throw machineError(code, { retryAfterMs: delay, status: response.status });
      }
      if (!response.ok) { await response.body?.cancel(); throw machineError("MT_HTTP", { status: response.status }); }
      const raw = await readBoundedBody(response, controller.signal);
      if (controller.signal.aborted) throw machineError("CANCELLED");
      let data;
      try { data = JSON.parse(raw); } catch { throw machineError("MT_RESPONSE"); }
      return parseMachineResponse(provider.id, data, texts);
    } catch (error) {
      if (signal?.aborted) throw machineError("CANCELLED");
      if (timedOut) throw machineError("MT_TIMEOUT");
      if (controller.signal.aborted) throw machineError("CANCELLED");
      if (error?.code?.startsWith("MT_")) throw error;
      throw machineError("MT_NETWORK");
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel); active.delete(controller);
    }
  });
}

async function readBoundedBody(response, signal) {
  if (Number(response.headers.get("content-length") || 0) > RESPONSE_LIMIT) { await response.body?.cancel(); throw machineError("MT_RESPONSE"); }
  if (!response.body) throw machineError("MT_RESPONSE");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "", complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw machineError("CANCELLED");
      const next = await reader.read();
      if (next.done) { complete = true; break; }
      bytes += next.value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw machineError("MT_RESPONSE");
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { signal.removeEventListener("abort", cancel); if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function buildMachineRequest(providerId, texts, from, to) {
  const provider = machineProvider(providerId);
  if (!Array.isArray(texts) || !texts.length || texts.length > provider.batchSize || texts.some(text => typeof text !== "string" || !text.trim())) throw machineError("MT_INPUT");
  const url = new URL(provider.origin + provider.path);
  if (providerId === "mt-microsoft-web") {
    url.search = new URLSearchParams({ from, to, isEnterpriseClient: "false" }).toString();
    return { url: url.href, body: texts.map(escapeHtmlText) };
  }
  return { url: url.href, body: { header: { fn: "auto_translation", client_key: `browser-chrome-110.0.0-Mac OS-${crypto.randomUUID()}-${Date.now()}` },
    type: "plain", model_category: "normal", source: { text_list: texts, lang: from }, target: { lang: to } } };
}

export function parseMachineResponse(providerId, data, sources) {
  machineProvider(providerId);
  let translations;
  if (providerId === "mt-microsoft-web") {
    if (!Array.isArray(data) || data.length !== sources.length) throw machineError("MT_RESPONSE");
    translations = data.map((item, index) => {
      if (!Array.isArray(item?.translations) || item.translations.length !== 1 || typeof item.translations[0]?.text !== "string") throw machineError("MT_RESPONSE");
      const translated = decodeHtmlText(item.translations[0].text);
      for (const [entity, count] of entities(sources[index])) if (entities(translated).get(entity) !== count) throw machineError("MT_RESPONSE");
      return translated;
    });
  } else {
    if (data?.header?.ret_code !== "succ") throw machineError(data?.header?.ret_code === "Auth-Failed" ? "MT_BLOCKED" : "MT_RESPONSE");
    translations = data.auto_translation;
  }
  if (!Array.isArray(translations) || translations.length !== sources.length || translations.some(text => typeof text !== "string" || !text.trim() || /⟦TF:|[\u0000\u0008\u000b\u000c]/u.test(text))) throw machineError("MT_RESPONSE");
  return translations.map(text => text.trim());
}
function escapeHtmlText(text) {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}
function decodeHtmlText(text) {
  const table = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" };
  return text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/giu, (_match, key) => table[key.toLowerCase()]);
}
function entities(text) {
  const values = new Map();
  for (const item of String(text).matchAll(/&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/gu)) values.set(item[0], (values.get(item[0]) || 0) + 1);
  return values;
}
