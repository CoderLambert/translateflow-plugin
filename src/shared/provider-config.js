import {
  DEFAULT_CONFIG,
  DEFAULT_OPENAI_COMPATIBLE,
  PROVIDER_IDS
} from "./constants.js";
import { normalizeOrigin } from "./url.js";

export function normalizeProviderId(value) {
  const provider = String(value || PROVIDER_IDS.DEEPSEEK).trim().toLowerCase();
  if (provider === PROVIDER_IDS.DEEPSEEK || provider === PROVIDER_IDS.OPENAI_COMPATIBLE) {
    return provider;
  }
  throw new Error(`不支持的翻译 Provider：${provider}`);
}

export function normalizeOpenAIBaseUrl(rawUrl) {
  const value = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!value) return "";

  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("OpenAI-compatible Base URL 仅支持 http/https。");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

export function buildChatCompletionsUrl(rawBaseUrl) {
  const baseUrl = normalizeOpenAIBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("请先配置 OpenAI-compatible Base URL。");
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

export function getProviderHostPermissionPattern(rawBaseUrl) {
  const baseUrl = normalizeOpenAIBaseUrl(rawBaseUrl);
  if (!baseUrl) return "";
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export function resolveTranslationConfig(config = DEFAULT_CONFIG, pageUrl = "") {
  const globalConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    openAICompatible: {
      ...DEFAULT_OPENAI_COMPATIBLE,
      ...(config?.openAICompatible || {})
    },
    siteProfiles: isPlainObject(config?.siteProfiles) ? config.siteProfiles : {}
  };

  const siteProfile = getSiteProfile(globalConfig.siteProfiles, pageUrl);
  const provider = normalizeProviderId(siteProfile?.provider || globalConfig.provider);

  const base = provider === PROVIDER_IDS.OPENAI_COMPATIBLE
    ? {
        provider,
        apiKey: String(globalConfig.openAICompatible.apiKey || "").trim(),
        apiBaseUrl: normalizeOpenAIBaseUrl(globalConfig.openAICompatible.baseUrl),
        model: String(globalConfig.openAICompatible.model || "").trim()
      }
    : {
        provider,
        apiKey: String(globalConfig.apiKey || "").trim(),
        apiBaseUrl: "https://api.deepseek.com",
        model: String(globalConfig.model || DEFAULT_CONFIG.model).trim() || DEFAULT_CONFIG.model
      };

  return {
    ...base,
    model: String(siteProfile?.model || base.model || "").trim(),
    prompt: String(siteProfile?.prompt || globalConfig.prompt || DEFAULT_CONFIG.prompt).trim() || DEFAULT_CONFIG.prompt,
    targetLanguage: String(
      siteProfile?.targetLanguage || globalConfig.targetLanguage || DEFAULT_CONFIG.targetLanguage
    ).trim() || DEFAULT_CONFIG.targetLanguage,
    siteOrigin: siteProfile?.origin || ""
  };
}

export function normalizeSiteProfile(rawProfile = {}) {
  const profile = {};
  if (rawProfile.provider) profile.provider = normalizeProviderId(rawProfile.provider);

  const model = String(rawProfile.model || "").trim();
  if (model) profile.model = model;

  const prompt = String(rawProfile.prompt || "").trim();
  if (prompt) profile.prompt = prompt;

  const targetLanguage = String(rawProfile.targetLanguage || "").trim();
  if (targetLanguage) profile.targetLanguage = targetLanguage;

  return profile;
}

export function getSiteProfile(siteProfiles, pageUrl) {
  if (!pageUrl || !isPlainObject(siteProfiles)) return null;

  let origin;
  try {
    origin = normalizeOrigin(pageUrl);
  } catch {
    return null;
  }

  const rawProfile = siteProfiles[origin];
  if (!isPlainObject(rawProfile)) return null;
  return { origin, ...normalizeSiteProfile(rawProfile) };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
