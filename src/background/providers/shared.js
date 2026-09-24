import {
  DEFAULT_RETRY_POLICY,
  classifyProviderFailure,
  computeRetryDelayMs,
  getMaxAttemptsForFailure,
  parseRetryAfterMs
} from "../../shared/retry-policy.js";

export class ProviderRequestError extends Error {
  constructor(message, {
    code = "PROVIDER_ERROR",
    status = 0,
    retryAfterMs = 0,
    cause
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProviderRequestError";
    this.code = code;
    this.status = Number(status || 0);
    this.retryAfterMs = Number(retryAfterMs || 0);
  }
}

export function buildTranslationPrompt(config, fallbackPrompt = "") {
  const prompt = String(config?.prompt || fallbackPrompt || "").trim();
  const targetLanguage = String(config?.targetLanguage || "").trim();
  if (!targetLanguage) return prompt;
  if (!prompt) return `Translate to ${targetLanguage}.`;

  const defaultLanguageInstruction =
    "Translate the provided English web-page segments into natural Simplified Chinese.";
  if (prompt.includes(defaultLanguageInstruction)) {
    return prompt.replaceAll(
      defaultLanguageInstruction,
      `Translate the provided English web-page segments into natural ${targetLanguage}.`
    );
  }

  const promptText = prompt.toLocaleLowerCase();
  if (promptText.includes(targetLanguage.toLocaleLowerCase())) return prompt;
  return `${prompt}\nTarget language: ${targetLanguage}.`;
}

export async function requestChatCompletions({
  url,
  apiKey,
  body,
  providerLabel,
  requireApiKey = true,
  signal,
  retryPolicy = DEFAULT_RETRY_POLICY
}) {
  const token = String(apiKey || "").trim();
  if (requireApiKey && !token) {
    throw new ProviderRequestError(`请先配置 ${providerLabel} API Key。`, { code: "CONFIG" });
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await performRequest({
        url,
        headers,
        body,
        providerLabel,
        signal,
        timeoutMs: retryPolicy.requestTimeoutMs
      });
    } catch (error) {
      const normalized = normalizeProviderError(error, providerLabel);
      const maxAttempts = getMaxAttemptsForFailure(normalized, retryPolicy);
      if (signal?.aborted || normalized.code === "CANCELLED" || attempt >= maxAttempts) {
        throw normalized;
      }

      const { retryable } = classifyProviderFailure(normalized);
      if (!retryable) throw normalized;

      await sleep(
        computeRetryDelayMs({
          attempt,
          retryAfterMs: normalized.retryAfterMs,
          baseDelayMs: retryPolicy.baseDelayMs,
          maxDelayMs: retryPolicy.maxDelayMs
        }),
        signal
      );
    }
  }
}

export async function requestParsedTranslation({
  request,
  segments,
  providerLabel,
  maxAttempts = DEFAULT_RETRY_POLICY.malformedMaxAttempts
}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const data = await request();
    try {
      return parseTranslationResult(data, segments, providerLabel);
    } catch (error) {
      const normalized = normalizeProviderError(error, providerLabel);
      if (normalized.code !== "MALFORMED_RESPONSE" || attempt >= maxAttempts) throw normalized;
    }
  }
}

export function parseTranslationResult(data, segments, providerLabel) {
  const content = extractAssistantText(data?.choices?.[0]?.message?.content);
  if (!content) {
    throw new ProviderRequestError(`${providerLabel} 没有返回翻译内容。`, {
      code: "MALFORMED_RESPONSE"
    });
  }

  const parsed = parseJsonValue(content, providerLabel);
  const translations = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.translations)
      ? parsed.translations
      : Array.isArray(parsed?.segments)
        ? parsed.segments
        : null;

  if (!translations) {
    throw new ProviderRequestError(
      `${providerLabel} 返回格式不正确：缺少 translations 数组。`,
      { code: "MALFORMED_RESPONSE" }
    );
  }

  const sourceSegments = Array.isArray(segments) ? segments : [];
  const validIds = new Set(sourceSegments.map((item) => String(item.id)));
  const byId = new Map();

  for (const item of translations) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "");
    if (!validIds.has(id)) continue;
    if (byId.has(id)) {
      throw new ProviderRequestError(
        `${providerLabel} 返回格式不正确：id ${id} 重复。`,
        { code: "MALFORMED_RESPONSE" }
      );
    }
    if (typeof item.text !== "string") {
      throw new ProviderRequestError(
        `${providerLabel} 返回格式不正确：id ${id} 缺少文本。`,
        { code: "MALFORMED_RESPONSE" }
      );
    }
    byId.set(id, item.text.trim());
  }

  const missingIds = sourceSegments
    .map((item) => String(item.id))
    .filter((id) => !byId.has(id));

  if (missingIds.length > 0) {
    throw new ProviderRequestError(
      `${providerLabel} 返回格式不完整：缺少 ${missingIds.length} 个翻译片段。`,
      { code: "MALFORMED_RESPONSE" }
    );
  }

  return sourceSegments.map((item) => ({
    id: String(item.id),
    text: byId.get(String(item.id))
  }));
}

async function performRequest({ url, headers, body, providerLabel, signal, timeoutMs }) {
  if (signal?.aborted) {
    throw new ProviderRequestError("翻译请求已取消。", { code: "CANCELLED" });
  }

  const linked = createLinkedSignal(signal, timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: linked.signal
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new ProviderRequestError("翻译请求已取消。", { code: "CANCELLED", cause: error });
    }
    if (linked.didTimeout()) {
      throw new ProviderRequestError(`${providerLabel} 请求超时。`, { code: "TIMEOUT", cause: error });
    }
    throw new ProviderRequestError(`${providerLabel} 网络请求失败：${error?.message || error}`, {
      code: "NETWORK",
      cause: error
    });
  } finally {
    linked.cleanup();
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new ProviderRequestError(
      `${providerLabel} 返回了非 JSON 响应（HTTP ${response.status}）。`,
      {
        code: response.ok ? "MALFORMED_RESPONSE" : "HTTP_ERROR",
        status: response.status,
        cause: error
      }
    );
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
    const code = response.status === 401 || response.status === 403
      ? "AUTH"
      : response.status === 429
        ? "RATE_LIMIT"
        : "HTTP_ERROR";
    throw new ProviderRequestError(`${providerLabel} API 请求失败：${detail}`, {
      code,
      status: response.status,
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After"))
    });
  }
  return data;
}

function normalizeProviderError(error, providerLabel) {
  if (error instanceof ProviderRequestError) return error;
  if (error?.name === "AbortError") {
    return new ProviderRequestError("翻译请求已取消。", { code: "CANCELLED", cause: error });
  }
  return new ProviderRequestError(
    `${providerLabel} 请求失败：${error?.message || error}`,
    { code: "NETWORK", cause: error }
  );
}

function extractAssistantText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("")
    .trim();
}

function parseJsonValue(content, providerLabel) {
  const trimmed = String(content || "").trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {}

  const objectStart = unfenced.indexOf("{");
  const objectEnd = unfenced.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(unfenced.slice(objectStart, objectEnd + 1));
    } catch {}
  }

  const arrayStart = unfenced.indexOf("[");
  const arrayEnd = unfenced.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(unfenced.slice(arrayStart, arrayEnd + 1));
    } catch {}
  }

  throw new ProviderRequestError(
    `${providerLabel} 返回内容无法解析为 JSON。请重试或检查 Prompt。`,
    { code: "MALFORMED_RESPONSE" }
  );
}

function createLinkedSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, Number(timeoutMs || DEFAULT_RETRY_POLICY.requestTimeoutMs)));

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  };
}

function sleep(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(new ProviderRequestError("翻译请求已取消。", { code: "CANCELLED" }));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, Number(ms || 0)));

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new ProviderRequestError("翻译请求已取消。", { code: "CANCELLED" }));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
