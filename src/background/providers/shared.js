import { translationSource, validateTranslationValue } from "../../shared/translation-cache-identity.js";
import { DEFAULT_RETRY_POLICY } from "../../shared/retry-policy.js";

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

// Compatibility envelope for existing translation/JSON validation and recovery.
export { requestSdkCompletion as requestChatCompletions } from "./ai-sdk-transport.js";

export function openAIAuthenticationHeaders() { return {}; }

export async function requestParsedTranslation({
  request,
  segments,
  providerLabel,
  maxAttempts = DEFAULT_RETRY_POLICY.malformedMaxAttempts,
  parseResult = parseTranslationResult
}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const data = await request();
      return validateParsedTranslation(parseResult(data, segments, providerLabel), segments, providerLabel);
    } catch (error) {
      const normalized = normalizeProviderError(error, providerLabel);
      if (normalized.code !== "MALFORMED_RESPONSE" || attempt >= maxAttempts) throw normalized;
    }
  }
}

export async function requestParsedJson({
  request,
  providerLabel,
  parseResult = (value) => value,
  maxAttempts = DEFAULT_RETRY_POLICY.malformedMaxAttempts
}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const data = await request();
      const message = data?.choices?.[0]?.message;
      const raw = message?.parsed ?? message?.content;
      if (raw === undefined || raw === null || raw === "") {
        throw new ProviderRequestError(`${providerLabel} 没有返回结构化内容。`, {
          code: "MALFORMED_RESPONSE"
        });
      }

      const parsed = typeof raw === "string"
        ? parseJsonObject(raw, providerLabel)
        : raw;
      try {
        return parseResult(parsed);
      } catch (error) {
        if (error instanceof ProviderRequestError) throw error;
        throw new ProviderRequestError(
          `${providerLabel} 返回的结构化内容不符合 Selection 协议：${error?.message || error}`,
          { code: "MALFORMED_RESPONSE", cause: error }
        );
      }
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
  const items = Array.isArray(parsed.translations) ? parsed.translations : parsed.segments;
  if (!Array.isArray(items)) {
    throw new ProviderRequestError(`${providerLabel} 返回格式不正确：缺少 translations 或 segments 数组。`, {
      code: "MALFORMED_RESPONSE"
    });
  }

  return validateParsedTranslation(items.map((item) => ({ id: String(item?.id), text: typeof item?.text === "string" ? item.text.trim() : item?.text })), segments, providerLabel);
}

export function validateParsedTranslation(items, segments, providerLabel = "Provider") {
  const expected = new Map(segments.map(segment => [String(segment.id), segment])), seen = new Set();
  const invalid = () => new ProviderRequestError(`${providerLabel} 返回的译文不完整或破坏了原文格式。`, { code: "MALFORMED_RESPONSE" });
  if (!Array.isArray(items) || items.length !== segments.length) throw invalid();
  for (const item of items) {
    const id = String(item?.id), segment = expected.get(id);
    if (!segment || seen.has(id) || typeof item?.text !== "string" || !item.text.trim()) throw invalid();
    seen.add(id);
    if (typeof segment.text === "string") {
      const source = translationSource(segment);
      if (!validateTranslationValue({ source, sourceText: source.cacheSource, translation: item.text })) throw invalid();
    }
  }
  return items;
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

export function parseJsonObject(content, providerLabel) {
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

export function sleep(ms, signal) {
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
