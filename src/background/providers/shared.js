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
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderRequestError(`${providerLabel} 没有返回翻译内容。`, {
      code: "MALFORMED_RESPONSE"
    });
  }

  const parsed = parseJsonObject(content, providerLabel);
  if (!Array.isArray(parsed.translations)) {
    throw new ProviderRequestError(`${providerLabel} 返回格式不正确：缺少 translations 数组。`, {
      code: "MALFORMED_RESPONSE"
    });
  }

  const validIds = new Set(segments.map((item) => String(item.id)));
  return parsed.translations
    .filter((item) => validIds.has(String(item.id)) && typeof item.text === "string")
    .map((item) => ({ id: String(item.id), text: item.text.trim() }));
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

function parseJsonObject(content, providerLabel) {
  const trimmed = String(content || "").trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {}

  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
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
