import { ProviderRequestError, buildTranslationPrompt, parseJsonObject } from "./shared.js";

export function requireConnectionConfig(config, protocolLabel) {
  const model = String(config?.model || "").trim();
  if (!model) throw providerError(`请先配置 ${protocolLabel} Model。`, "CONFIG");
  const apiKey = String(config?.apiKey || "").trim();
  if (!apiKey && !config?.allowEmptyApiKey) throw providerError(`请先配置 ${protocolLabel} API Key。`, "CONFIG");
  return { model, apiKey, label: String(config?.providerLabel || protocolLabel).trim() || protocolLabel };
}

export function translationInput(segments, config) {
  return {
    systemPrompt: buildTranslationPrompt(config, `Translate to ${config?.targetLanguage || "Simplified Chinese"} and return JSON only.`),
    prompt: JSON.stringify({ segments: (Array.isArray(segments) ? segments : []).map(item => ({ id: String(item.id), text: String(item.text) })) })
  };
}

export function parseTranslationText(text, segments, providerLabel) {
  const parsed = parseJsonObject(text, providerLabel);
  if (!Array.isArray(parsed?.translations)) throw providerError(`${providerLabel} 返回格式不正确：缺少 translations 数组。`, "MALFORMED_RESPONSE");
  const expected = new Set((segments || []).map(item => String(item.id)));
  const result = parsed.translations.filter(item => expected.has(String(item?.id)) && typeof item?.text === "string")
    .map(item => ({ id: String(item.id), text: item.text.trim() }));
  if (result.length !== expected.size || new Set(result.map(item => item.id)).size !== expected.size) {
    throw providerError(`${providerLabel} 没有返回完整且唯一的翻译结果。`, "MALFORMED_RESPONSE");
  }
  return result;
}

export function parseStructuredText(text, parseResult, providerLabel) {
  const parsed = parseJsonObject(text, providerLabel);
  try { return typeof parseResult === "function" ? parseResult(parsed) : parsed; }
  catch (cause) { throw providerError(`${providerLabel} 返回的结构化内容不符合 Selection 协议：${cause?.message || cause}`, "MALFORMED_RESPONSE", cause); }
}

export async function requestParsedStructuredText({ request, extract, parseResult, providerLabel, maxAttempts = 2 }) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try { return parseStructuredText(extract(await request()), parseResult, providerLabel); }
    catch (error) { if (error?.code !== "MALFORMED_RESPONSE" || attempt >= maxAttempts) throw error; }
  }
}

export function exactTestResult(text, providerLabel) {
  const result = String(text || "").trim();
  if (result !== "OK") throw providerError(`${providerLabel} 连接测试返回了非预期内容。`, "MALFORMED_RESPONSE");
  return result;
}

export async function assertConnectionPermission(baseUrl, providerLabel) {
  const url = new URL(String(baseUrl || ""));
  const pattern = `${url.protocol}//${url.hostname}/*`;
  if (!await chrome.permissions.contains({ origins: [pattern] })) throw providerError(`尚未授权访问 ${providerLabel} API 地址，请在设置页保存连接并授权后重试。`, "PERMISSION");
}

export function optionalGenerationSettings(config, names = { temperature: "temperature", outputTokens: "max_tokens" }) {
  const result = {};
  if (Number.isFinite(config?.temperature)) result[names.temperature] = Number(config.temperature);
  if (Number.isSafeInteger(config?.outputTokens) && config.outputTokens > 0) result[names.outputTokens] = config.outputTokens;
  return result;
}

function providerError(message, code, cause) { return new ProviderRequestError(message, { code, cause }); }
