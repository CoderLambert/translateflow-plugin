import { machineError, machineLanguage, machineProvider } from "../../shared/machine-translation.js";
import pLimit from "p-limit";
import { buildMachineRequest, parseMachineResponse } from "./machine-translation-adapters/index.js";
import { assertMachineAvailable, machineFailed, machineSucceeded } from "./machine-translation-health.js";
import { ensureBilibiliRule } from "./machine-translation-dnr.js";
export { buildMachineRequest, parseMachineResponse } from "./machine-translation-adapters/index.js";
import { parseRetryAfterMs } from "../../shared/retry-policy.js";

const RESPONSE_LIMIT = 512 * 1024;
const queues = new Map();
const globalLimit = pLimit(2);
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

export function abortMachineHttp() { for (const controller of active) controller.abort(); }

export async function requestMachineTexts(config, texts, { signal, timeoutMs = config.provider === "mt-bilibili" ? 8000 : 5000, deadline = Infinity } = {}) {
  const provider = machineProvider(config.provider);
  if (config.apiBaseUrl !== provider.origin + provider.path) throw machineError("MT_CONFIG");
  const from = machineLanguage(provider.id, config.sourceLanguage), to = machineLanguage(provider.id, config.targetLanguage, true);
  const descriptor = buildMachineRequest(provider.id, texts, from, to), url = new URL(descriptor.url);
  if (url.origin !== provider.origin || url.pathname !== provider.path || url.username || url.password || url.hash ||
      !["GET", "POST"].includes(descriptor.method) || (descriptor.method === "GET") !== (provider.id === "mt-google-web")) throw machineError("MT_CONFIG");
  if (globalLimit.pendingCount >= 64) throw machineError("MT_BUSY");
  const queued = new AbortController(), cancelQueued = () => queued.abort();
  signal?.addEventListener("abort", cancelQueued, { once: true });
  const remaining = Math.min(timeoutMs, deadline - performance.now());
  if (remaining <= 0) { signal?.removeEventListener("abort", cancelQueued); throw machineError("MT_TIMEOUT"); }
  const queueTimer = setTimeout(() => queued.abort(), Math.max(0, remaining));
  let started = false, rejectWait;
  const aborted = new Promise((_resolve, reject) => {
    rejectWait = () => reject(machineError(signal?.aborted ? "CANCELLED" : "MT_TIMEOUT"));
    queued.signal.addEventListener("abort", rejectWait, { once: true });
  });
  // Deadline starts before either queue. The consumer can leave while the
  // operation retains its real HTTP permits until response cleanup settles.
  try {
    if (signal?.aborted) throw machineError("CANCELLED");
    const operation = withSlot(provider.id, queued.signal, () => globalLimit(async () => {
      if (queued.signal.aborted) throw machineError(signal?.aborted ? "CANCELLED" : "MT_TIMEOUT");
      await assertMachineAvailable(provider.id);
      if (globalThis.chrome && !await chrome.permissions.contains({ origins: [`${provider.origin}/*`] })) throw machineError("MT_PERMISSION");
      if (provider.id === "mt-bilibili") await ensureBilibiliRule();
      if (queued.signal.aborted) throw machineError(signal?.aborted ? "CANCELLED" : "MT_TIMEOUT");
      const controller = new AbortController(); active.add(controller);
      const cancel = () => controller.abort();
      queued.signal.addEventListener("abort", cancel, { once: true });
      try {
        started = true;
        const response = await fetch(descriptor.url, { method: descriptor.method, headers: descriptor.method === "GET" ? {} : { "Content-Type": descriptor.contentType },
          ...(descriptor.method === "GET" ? {} : { body: typeof descriptor.body === "string" ? descriptor.body : JSON.stringify(descriptor.body) }),
          credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
        if (response.status === 429 || response.status === 403) {
          const code = response.status === 429 ? "MT_RATE_LIMIT" : "MT_BLOCKED";
          const delay = Math.max(response.status === 429 ? 60000 : 300000, parseRetryAfterMs(response.headers.get("Retry-After")) || 0);
          await discardResponseBody(response);
          throw machineError(code, { retryAfterMs: delay, status: response.status });
        }
        if (!response.ok) { await discardResponseBody(response); throw machineError("MT_HTTP", { status: response.status }); }
        const raw = await readBoundedBody(response, controller.signal);
        if (controller.signal.aborted) throw machineError("CANCELLED");
        let data;
        try { data = JSON.parse(raw); } catch { throw machineError("MT_RESPONSE"); }
        const result = parseMachineResponse(provider.id, data, texts, config);
        await machineSucceeded(config);
        return result;
      } catch (error) {
        const failure = signal?.aborted ? machineError("CANCELLED") : queued.signal.aborted ? machineError("MT_TIMEOUT") : controller.signal.aborted ? machineError("CANCELLED") : error?.code?.startsWith("MT_") ? error : machineError("MT_NETWORK");
        throw failure;
      } finally {
        queued.signal.removeEventListener("abort", cancel); active.delete(controller);
      }
    }));
    return await Promise.race([operation, aborted]);
  } catch (error) {
    const failure = signal?.aborted ? machineError("CANCELLED") : queued.signal.aborted ? machineError("MT_TIMEOUT") : error;
    if (started) await machineFailed(provider.id, failure, failure.retryAfterMs || 0);
    throw failure;
  } finally {
    clearTimeout(queueTimer); signal?.removeEventListener("abort", cancelQueued);
    queued.signal.removeEventListener("abort", rejectWait);
  }
}

// Keep ownership until body cancellation settles, even when the consumer has left.
async function discardResponseBody(response) {
  try { await response.body?.cancel(); } catch { /* already closed */ }
}

async function readBoundedBody(response, signal) {
  if (Number(response.headers.get("content-length") || 0) > RESPONSE_LIMIT) { await discardResponseBody(response); throw machineError("MT_RESPONSE"); }
  if (!response.body) throw machineError("MT_RESPONSE");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "", complete = false;
  let cancellation;
  const cancel = () => { cancellation ||= reader.cancel().catch(() => {}); };
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
  } finally {
    signal.removeEventListener("abort", cancel);
    // Actual transport permits outlive consumer cancellation.
    if (!complete) cancel();
    if (cancellation) await cancellation;
    reader.releaseLock();
  }
}
