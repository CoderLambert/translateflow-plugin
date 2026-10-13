import { DEFAULT_CONFIG, DEFAULT_OPENAI_COMPATIBLE, PROVIDER_IDS } from "./constants.js";

export const PROVIDER_CONNECTIONS_VERSION = 1;
export const PROVIDER_PROTOCOLS = Object.freeze({
  OPENAI_CHAT: "openai-chat",
  OPENAI_RESPONSES: "openai-responses",
  ANTHROPIC_MESSAGES: "anthropic-messages",
  GEMINI_GENERATE: "gemini-generate"
});

export const PROVIDER_PLATFORMS = Object.freeze([
  preset("openai", "OpenAI", PROVIDER_PROTOCOLS.OPENAI_RESPONSES, "https://api.openai.com/v1"),
  preset("anthropic", "Anthropic", PROVIDER_PROTOCOLS.ANTHROPIC_MESSAGES, "https://api.anthropic.com/v1"),
  preset("gemini", "Google Gemini", PROVIDER_PROTOCOLS.GEMINI_GENERATE, "https://generativelanguage.googleapis.com/v1beta"),
  preset("deepseek", "DeepSeek", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.deepseek.com"),
  preset("openrouter", "OpenRouter", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://openrouter.ai/api/v1"),
  preset("groq", "Groq", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.groq.com/openai/v1"),
  preset("xai", "xAI", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.x.ai/v1"),
  preset("mistral", "Mistral AI", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.mistral.ai/v1"),
  preset("dashscope", "Alibaba Cloud Model Studio", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://dashscope.aliyuncs.com/compatible-mode/v1"),
  preset("siliconflow", "SiliconFlow", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.siliconflow.cn/v1"),
  preset("moonshot", "Moonshot AI", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://api.moonshot.cn/v1"),
  preset("zhipu", "Zhipu AI", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://open.bigmodel.cn/api/paas/v4"),
  preset("volcengine", "Volcengine Ark", PROVIDER_PROTOCOLS.OPENAI_CHAT, "https://ark.cn-beijing.volces.com/api/v3"),
  preset("azure-v1", "Azure OpenAI v1", PROVIDER_PROTOCOLS.OPENAI_RESPONSES, ""),
  preset("local", "Local / self-hosted", PROVIDER_PROTOCOLS.OPENAI_CHAT, "http://127.0.0.1:11434/v1", true),
  preset("custom", "Custom", PROVIDER_PROTOCOLS.OPENAI_CHAT, "", true)
]);

const PROTOCOL_SET = new Set(Object.values(PROVIDER_PROTOCOLS));
const PLATFORM_SET = new Set(PROVIDER_PLATFORMS.map(item => item.id));

export function normalizeProviderBaseUrl(rawUrl) {
  const value = String(rawUrl || "").trim().replace(/\/+$/u, "");
  if (!value) return "";
  const url = new URL(value);
  if (!/^https?:$/u.test(url.protocol)) throw new Error("Provider Base URL 仅支持 http/https。");
  if (url.username || url.password) throw new Error("Provider Base URL 不能包含用户名或密码。");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/u, "");
}

export function normalizeServiceRef(value) {
  if (value?.kind === "chatgpt-plan") return Object.freeze({ kind: "chatgpt-plan" });
  const connectionId = normalizeConnectionId(value?.connectionId);
  return connectionId ? Object.freeze({ kind: "api-key", connectionId }) : null;
}

export function normalizeProviderConnection(value, fallbackId = "") {
  const id = normalizeConnectionId(value?.id || fallbackId);
  if (!id) throw new Error("连接 ID 无效。");
  const protocol = String(value?.protocol || "").trim().toLowerCase();
  if (!PROTOCOL_SET.has(protocol)) throw new Error(`不支持的 Provider 协议：${protocol || "empty"}`);
  const baseUrl = normalizeProviderBaseUrl(value?.baseUrl);
  if (!baseUrl) throw new Error("请填写 Provider Base URL。");
  const platformValue = String(value?.platform || "custom").trim().toLowerCase();
  const platform = PLATFORM_SET.has(platformValue) ? platformValue : "custom";
  const model = String(value?.defaultModel || "").trim();
  const revision = positiveInteger(value?.revision, 1);
  const rawSettings = plainObject(value?.settings);
  if (/^http:/iu.test(baseUrl) && rawSettings.allowInsecureHttp !== true) {
    throw new Error("HTTP Provider 仅允许用于明确启用的不安全本地/自托管连接。");
  }
  return Object.freeze({
    id,
    revision,
    name: clampText(value?.name || platformLabel(platform), 80) || id,
    platform,
    protocol,
    baseUrl,
    credentialId: normalizeConnectionId(value?.credentialId || id) || id,
    defaultModel: model,
    settings: Object.freeze({
      streaming: rawSettings.streaming !== false,
      outputTokens: boundedInteger(rawSettings.outputTokens, 4096, 128, 32768),
      temperature: optionalNumber(rawSettings.temperature, 0, 2),
      reasoning: clampText(rawSettings.reasoning, 24),
      allowEmptyApiKey: rawSettings.allowEmptyApiKey === true,
      allowInsecureHttp: rawSettings.allowInsecureHttp === true
    })
  });
}

export function normalizeProviderConnectionState(stored = {}) {
  const input = plainObject(stored.providerConnections);
  const connections = {};
  for (const [id, value] of Object.entries(input)) {
    try { connections[id] = normalizeProviderConnection(value, id); } catch {}
  }
  const credentials = {};
  for (const [id, value] of Object.entries(plainObject(stored.providerCredentials))) {
    const key = normalizeConnectionId(id);
    if (key && typeof value === "string") credentials[key] = value;
  }
  return {
    version: positiveInteger(stored.providerConnectionsVersion, PROVIDER_CONNECTIONS_VERSION),
    connections,
    credentials,
    defaultService: normalizeServiceRef(stored.defaultService)
  };
}

export function migrateLegacyProviderState(stored = {}) {
  const normalized = normalizeProviderConnectionState(stored);
  if (Object.keys(normalized.connections).length) {
    return { ...normalized, version: PROVIDER_CONNECTIONS_VERSION, migrated: false };
  }

  const connections = {};
  const credentials = {};
  connections.deepseek = normalizeProviderConnection({
    id: "deepseek", revision: 1, name: "DeepSeek", platform: "deepseek",
    protocol: PROVIDER_PROTOCOLS.OPENAI_CHAT, baseUrl: "https://api.deepseek.com",
    credentialId: "deepseek", defaultModel: String(stored.model || DEFAULT_CONFIG.model).trim() || DEFAULT_CONFIG.model,
    settings: { streaming: false, allowEmptyApiKey: false }
  });
  credentials.deepseek = String(stored.apiKey || "").trim();

  const legacyOpenAI = { ...DEFAULT_OPENAI_COMPATIBLE, ...plainObject(stored.openAICompatible) };
  if (legacyOpenAI.baseUrl || legacyOpenAI.model || legacyOpenAI.apiKey || stored.provider === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    connections["openai-compatible"] = normalizeProviderConnection({
      id: "openai-compatible", revision: 1, name: "OpenAI-compatible", platform: "custom",
      protocol: PROVIDER_PROTOCOLS.OPENAI_CHAT, baseUrl: legacyOpenAI.baseUrl || "http://127.0.0.1:11434/v1",
      credentialId: "openai-compatible", defaultModel: legacyOpenAI.model,
      settings: { streaming: Boolean(legacyOpenAI.streaming), allowEmptyApiKey: !String(legacyOpenAI.apiKey || "").trim(), allowInsecureHttp: /^http:/iu.test(String(legacyOpenAI.baseUrl || "")) }
    });
    credentials["openai-compatible"] = String(legacyOpenAI.apiKey || "").trim();
  }

  const legacyProvider = String(stored.provider || DEFAULT_CONFIG.provider).trim().toLowerCase();
  const defaultService = legacyProvider === PROVIDER_IDS.CHATGPT_PLAN
    ? { kind: "chatgpt-plan" }
    : { kind: "api-key", connectionId: legacyProvider === PROVIDER_IDS.OPENAI_COMPATIBLE && connections["openai-compatible"] ? "openai-compatible" : "deepseek" };
  return { version: PROVIDER_CONNECTIONS_VERSION, connections, credentials, defaultService, migrated: true };
}

export function publicProviderConnection(connection, apiKey = "") {
  const value = normalizeProviderConnection(connection, connection?.id);
  return { ...value, hasApiKey: Boolean(String(apiKey || "").trim()) };
}

export function providerPlatformPreset(id) {
  return PROVIDER_PLATFORMS.find(item => item.id === id) || PROVIDER_PLATFORMS.at(-1);
}

export function buildProviderProtocolUrl(connection, model = "") {
  const value = normalizeProviderConnection(connection, connection?.id);
  if (value.protocol === PROVIDER_PROTOCOLS.OPENAI_CHAT) return appendPath(value.baseUrl, "/chat/completions");
  if (value.protocol === PROVIDER_PROTOCOLS.OPENAI_RESPONSES) return appendPath(value.baseUrl, "/responses");
  if (value.protocol === PROVIDER_PROTOCOLS.ANTHROPIC_MESSAGES) return appendPath(value.baseUrl, "/messages");
  const selectedModel = String(model || value.defaultModel || "").trim();
  if (!selectedModel) throw new Error("请先配置 Gemini Model。");
  if (/\/models\/[^/]+:generateContent$/iu.test(value.baseUrl)) return value.baseUrl;
  const modelId = selectedModel.replace(/^models\//iu, "");
  return `${value.baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
}

export function getConnectionHostPermissionPattern(rawBaseUrl) {
  const baseUrl = normalizeProviderBaseUrl(rawBaseUrl);
  if (!baseUrl) return "";
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export function isProviderProtocol(value) { return PROTOCOL_SET.has(String(value || "").trim().toLowerCase()); }

function appendPath(baseUrl, suffix) {
  const normalized = normalizeProviderBaseUrl(baseUrl);
  const escaped = suffix.replaceAll("/", "\\/");
  if (new RegExp(`${escaped}$`, "iu").test(normalized)) return normalized;
  return `${normalized}${suffix}`;
}
function preset(id, label, protocol, baseUrl, allowEmptyApiKey = false) { return Object.freeze({ id, label, protocol, baseUrl, allowEmptyApiKey }); }
function platformLabel(id) { return providerPlatformPreset(id)?.label || "Custom"; }
function normalizeConnectionId(value) { const id = String(value || "").trim().toLowerCase(); return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id) ? id : ""; }
function clampText(value, max) { return String(value || "").trim().slice(0, max); }
function plainObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : fallback; }
function boundedInteger(value, fallback, min, max) { const number = Number(value); return Number.isSafeInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function optionalNumber(value, min, max) { if (value === "" || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : null; }
