import {
  DEFAULT_RETRY_POLICY,
  classifyProviderFailure,
  computeRetryDelayMs,
  getMaxAttemptsForFailure,
  parseRetryAfterMs
} from "../../shared/retry-policy.js";
import { ProviderRequestError, sleep } from "./shared.js";

export async function requestChatCompletionsStream(options) {
  const policy = options.retryPolicy || DEFAULT_RETRY_POLICY;
  let emitted = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await performStreamRequest({ ...options, timeoutMs: options.timeoutMs ?? policy.requestTimeoutMs,
        onProgress(event) { emitted = true; options.onProgress?.(event); },
        onTextDelta(text) { emitted = true; options.onTextDelta?.(text); }
      });
    } catch (error) {
      if (options.signal?.aborted) throw cancelled(error);
      if (emitted || error.code === "MALFORMED_RESPONSE" || !classifyProviderFailure(error).retryable || attempt >= getMaxAttemptsForFailure(error, policy)) throw error;
      await sleep(computeRetryDelayMs({ attempt, retryAfterMs: error.retryAfterMs, baseDelayMs: policy.baseDelayMs, maxDelayMs: policy.maxDelayMs }), options.signal);
    }
  }
}

async function performStreamRequest({
  url,
  apiKey,
  headers: requestHeaders = {},
  body,
  providerLabel,
  requireApiKey = true,
  signal,
  onProgress,
  onTextDelta,
  timeoutMs = DEFAULT_RETRY_POLICY.requestTimeoutMs
}) {
  const token = String(apiKey || "").trim();
  if (requireApiKey && !token) {
    throw new ProviderRequestError(`请先配置 ${providerLabel} API Key。`, { code: "CONFIG" });
  }
  if (signal?.aborted) throw cancelled();

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...requestHeaders
  };
  if (token && !Object.keys(headers).some(name => ["authorization", "api-key"].includes(name.toLowerCase()))) headers.Authorization = `Bearer ${token}`;

  // Streams are bounded by inactivity, not by total duration: a long but healthy
  // generation must not be killed at the deadline of its first token.
  const linked = createLinkedSignal(signal, timeoutMs, { idle: true });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal: linked.signal
    });

    if (!response.ok) {
      const raw = await response.text();
      throw buildHttpError(response, raw, providerLabel);
    }

    const contentType = String(response.headers?.get?.("Content-Type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      return parseJsonResponse(await response.text(), providerLabel, response.status);
    }

    return await readOpenAIEventStream(response, {
      providerLabel,
      signal: linked.signal,
      bumpTimeout: () => linked.bump(),
      onProgress,
      onTextDelta
    });
  } catch (error) {
    if (signal?.aborted) throw cancelled(error);
    if (linked.didTimeout()) {
      throw new ProviderRequestError(`${providerLabel} 请求超时。`, {
        code: "TIMEOUT",
        cause: error
      });
    }
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError(
      `${providerLabel} 流式请求失败：${error?.message || error}`,
      { code: "NETWORK", cause: error }
    );
  } finally {
    linked.cleanup();
  }
}

export function isUnsupportedStreamingError(error) {
  if (!error || error.code !== "HTTP_ERROR") return false;
  if (![400, 404, 405, 415, 422, 501].includes(Number(error.status || 0))) return false;
  return /(?:stream|streaming).*(?:unsupported|not supported|invalid|unknown|unrecognized)|(?:unsupported|not supported).*(?:stream|streaming)/i
    .test(String(error.message || ""));
}

async function readOpenAIEventStream(response, {
  providerLabel,
  signal,
  bumpTimeout,
  onProgress,
  onTextDelta
}) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return consumeChunks([await response.text()], {
      providerLabel,
      signal,
      onProgress,
      onTextDelta
    });
  }

  const decoder = new TextDecoder();
  const state = createStreamState(providerLabel, signal, onProgress, onTextDelta);
  try {
    while (!state.done) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) throw cancelled();
      bumpTimeout?.();
      state.push(decoder.decode(value, { stream: true }));
    }
    state.push(decoder.decode());
    return state.finish();
  } catch (error) {
    if (signal?.aborted) throw cancelled(error);
    throw error;
  } finally {
    try { await reader.cancel(); } catch {}
    reader.releaseLock?.();
  }
}

function consumeChunks(chunks, { providerLabel, signal, onProgress, onTextDelta }) {
  const state = createStreamState(providerLabel, signal, onProgress, onTextDelta);
  for (const chunk of chunks) state.push(String(chunk || ""));
  return state.finish();
}

function createStreamState(providerLabel, signal, onProgress, onTextDelta) {
  let buffer = "";
  let dataLines = [];
  let content = "";
  let eventCount = 0;
  let done = false;

  const dispatch = () => {
    if (!dataLines.length || done) {
      dataLines = [];
      return;
    }
    const data = dataLines.join("\n");
    dataLines = [];
    if (data.trim() === "[DONE]") {
      done = true;
      return;
    }

    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw malformed(providerLabel, "SSE data 事件不是有效 JSON。", error);
    }
    if (event?.error) {
      throw new ProviderRequestError(
        `${providerLabel} 流式响应失败：${event.error?.message || "unknown error"}`,
        { code: "HTTP_ERROR" }
      );
    }

    const delta = event?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      content += delta;
      eventCount += 1;
      notify(onProgress, {
        type: "streaming",
        receivedChars: content.length,
        eventCount
      });
      notifyText(onTextDelta, delta);
    }
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    if (field !== "data") return;
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    dataLines.push(value);
  };

  return {
    get done() {
      return done;
    },
    push(chunk) {
      if (done || !chunk) return;
      if (signal?.aborted) throw cancelled();
      buffer += chunk;
      let newline;
      while (!done && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processLine(line);
      }
    },
    finish() {
      if (signal?.aborted) throw cancelled();
      if (!done) {
        throw malformed(providerLabel, "SSE 响应在 [DONE] 前提前结束。");
      }
      if (!content) {
        throw malformed(providerLabel, "SSE 响应没有返回翻译内容。");
      }
      return { choices: [{ message: { content } }] };
    }
  };
}

function notifyText(listener, text) {
  if (typeof listener !== "function") return;
  try { listener(String(text)); } catch {}
}

function buildHttpError(response, raw, providerLabel) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {}
  const detail = data?.error?.message || data?.message || raw || `HTTP ${response.status}`;
  const code = response.status === 401 || response.status === 403
    ? "AUTH"
    : response.status === 429
      ? "RATE_LIMIT"
      : "HTTP_ERROR";
  return new ProviderRequestError(`${providerLabel} API 请求失败：${detail}`, {
    code,
    status: response.status,
    retryAfterMs: parseRetryAfterMs(response.headers?.get?.("Retry-After"))
  });
}

function parseJsonResponse(raw, providerLabel, status) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProviderRequestError(
      `${providerLabel} 返回了非 JSON 响应（HTTP ${status}）。`,
      { code: "MALFORMED_RESPONSE", status, cause: error }
    );
  }
}

function createLinkedSignal(externalSignal, timeoutMs, { idle = false } = {}) {
  const controller = new AbortController();
  let timedOut = false, timer = null;
  const window = Math.max(1000, Number(timeoutMs || DEFAULT_RETRY_POLICY.requestTimeoutMs));
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, window);
  };
  arm();

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    // Idle mode: a stream that keeps producing output is never cut off, only a
    // stalled one is. Non-streaming requests keep the single overall deadline.
    bump() { if (idle && !controller.signal.aborted) arm(); },
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

function notify(listener, event) {
  if (typeof listener !== "function") return;
  try {
    listener(Object.freeze({ ...event }));
  } catch {}
}

function malformed(providerLabel, detail, cause) {
  return new ProviderRequestError(`${providerLabel} ${detail}`, {
    code: "MALFORMED_RESPONSE",
    cause
  });
}

function cancelled(cause) {
  return new ProviderRequestError("翻译请求已取消。", {
    code: "CANCELLED",
    cause
  });
}
