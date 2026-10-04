import { BACKGROUND_MESSAGES, DEFAULT_CONFIG, DEFAULT_OPENAI_COMPATIBLE, PROVIDER_IDS } from "../shared/constants.js";
import { DEFAULT_APPEARANCE_ID, normalizeAppearanceId } from "../shared/appearance.js";
import { getProviderHostPermissionPattern, normalizeOpenAIBaseUrl, normalizeSiteProfile } from "../shared/provider-config.js";
import { normalizeSelectionDepth } from "../shared/selection.js";
import { normalizeOrigin } from "../shared/url.js";

export type OptionsConfig = { provider: string; apiKey: string; model: string; prompt: string; targetLanguage: string; appearance: string; cacheMaxMB: number; openAICompatible: { baseUrl: string; apiKey: string; model: string; streaming: boolean }; youtubeSubtitleMode: string; youtubeSubtitleSize: string; selectionExplanationDepth: string };
export type SiteProfile = { provider?: string; preset?: string; appearance?: string; model?: string; prompt?: string; targetLanguage?: string };
export type SiteEntry = { origin: string; profile: SiteProfile };
export type CacheStats = { pageCount: number; segmentCount: number; bytes: number };

export function optionsClient(api: typeof chrome = chrome) {
  async function loadConfig(): Promise<OptionsConfig> {
    const value = await api.storage.local.get(["provider", "apiKey", "model", "prompt", "targetLanguage", "appearance", "cacheMaxMB", "openAICompatible", "youtubeSubtitleMode", "youtubeSubtitleSize", "selectionExplanationDepth"]) as Record<string, unknown>;
    const openAI = { ...DEFAULT_OPENAI_COMPATIBLE, ...objectRecord(value.openAICompatible) };
    return {
      provider: text(value.provider, DEFAULT_CONFIG.provider), apiKey: text(value.apiKey), model: text(value.model, DEFAULT_CONFIG.model),
      prompt: text(value.prompt, DEFAULT_CONFIG.prompt), targetLanguage: text(value.targetLanguage, DEFAULT_CONFIG.targetLanguage),
      appearance: normalizeAppearanceId(value.appearance) || DEFAULT_APPEARANCE_ID,
      cacheMaxMB: Number(value.cacheMaxMB || DEFAULT_CONFIG.cacheMaxMB),
      openAICompatible: { baseUrl: text(openAI.baseUrl), apiKey: text(openAI.apiKey), model: text(openAI.model), streaming: Boolean(openAI.streaming) },
      youtubeSubtitleMode: typeof value.youtubeSubtitleMode === "string" && ["bilingual", "original", "off"].includes(value.youtubeSubtitleMode) ? value.youtubeSubtitleMode : "bilingual",
      youtubeSubtitleSize: typeof value.youtubeSubtitleSize === "string" && ["small", "standard", "large"].includes(value.youtubeSubtitleSize) ? value.youtubeSubtitleSize : "standard",
      selectionExplanationDepth: normalizeSelectionDepth(value.selectionExplanationDepth)
    };
  }

  async function ensureOpenAIPermission(raw: string) {
    const pattern = getProviderHostPermissionPattern(raw);
    if (!pattern) throw new Error("请先填写 OpenAI-compatible Base URL。");
    if (!await api.permissions.request({ origins: [pattern] })) throw new Error(`未授予 API 地址权限：${pattern}`);
  }

  function normalizeConfig(input: OptionsConfig): OptionsConfig {
    const max = Math.min(2048, Math.max(20, Number(input.cacheMaxMB) || DEFAULT_CONFIG.cacheMaxMB));
    return { ...input, provider: input.provider || PROVIDER_IDS.DEEPSEEK, apiKey: input.apiKey.trim(), model: input.model.trim() || DEFAULT_CONFIG.model,
      prompt: input.prompt.trim() || DEFAULT_CONFIG.prompt, targetLanguage: input.targetLanguage.trim() || DEFAULT_CONFIG.targetLanguage,
      appearance: normalizeAppearanceId(input.appearance) || DEFAULT_APPEARANCE_ID, cacheMaxMB: max,
      openAICompatible: { baseUrl: normalizeOpenAIBaseUrl(input.openAICompatible.baseUrl), apiKey: input.openAICompatible.apiKey.trim(), model: input.openAICompatible.model.trim(), streaming: Boolean(input.openAICompatible.streaming) },
      youtubeSubtitleMode: ["bilingual", "original", "off"].includes(input.youtubeSubtitleMode) ? input.youtubeSubtitleMode : "bilingual",
      youtubeSubtitleSize: ["small", "standard", "large"].includes(input.youtubeSubtitleSize) ? input.youtubeSubtitleSize : "standard",
      selectionExplanationDepth: normalizeSelectionDepth(input.selectionExplanationDepth) };
  }

  async function saveConfig(input: OptionsConfig, requestPermission: boolean) {
    const value = normalizeConfig(input);
    if (requestPermission && value.provider === PROVIDER_IDS.OPENAI_COMPATIBLE) await ensureOpenAIPermission(value.openAICompatible.baseUrl);
    await api.storage.local.set({ provider: value.provider, apiKey: value.apiKey, model: value.model, prompt: value.prompt, targetLanguage: value.targetLanguage,
      appearance: value.appearance, cacheMaxMB: value.cacheMaxMB, openAICompatible: value.openAICompatible,
      youtubeSubtitleMode: value.youtubeSubtitleMode, youtubeSubtitleSize: value.youtubeSubtitleSize, selectionExplanationDepth: value.selectionExplanationDepth });
    return value;
  }

  async function testProvider() {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.TEST_API });
    if (!response?.ok) throw new Error(response?.error || "API 测试失败");
    return String(response.result || "");
  }

  async function profiles(): Promise<SiteEntry[]> {
    const stored = await api.storage.local.get(["siteProfiles"]) as Record<string, unknown>;
    return Object.entries(objectRecord(stored.siteProfiles)).sort(([a], [b]) => a.localeCompare(b)).map(([origin, raw]) => ({ origin, profile: normalizeSiteProfile(objectRecord(raw)) as SiteProfile }));
  }

  async function saveProfile(originInput: string, profileInput: SiteProfile, openAIBaseUrl: string, defaultProvider: string) {
    const origin = normalizeOrigin(originInput), profile = normalizeSiteProfile(profileInput);
    if ((profile.provider || defaultProvider || PROVIDER_IDS.DEEPSEEK) === PROVIDER_IDS.OPENAI_COMPATIBLE) await ensureOpenAIPermission(openAIBaseUrl);
    const stored = await api.storage.local.get(["siteProfiles"]) as Record<string, unknown>, next: Record<string, unknown> = { ...objectRecord(stored.siteProfiles) };
    if (Object.keys(profile).length) next[origin] = profile; else delete next[origin];
    await api.storage.local.set({ siteProfiles: next });
    return { origin, saved: Object.keys(profile).length > 0 };
  }

  async function deleteProfile(origin: string) {
    const stored = await api.storage.local.get(["siteProfiles"]) as Record<string, unknown>, next: Record<string, unknown> = { ...objectRecord(stored.siteProfiles) };
    delete next[origin]; await api.storage.local.set({ siteProfiles: next });
  }

  async function cacheStats(): Promise<CacheStats> {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_STATS });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    return { pageCount: Number(response.pageCount || 0), segmentCount: Number(response.segmentCount || 0), bytes: Number(response.bytes || 0) };
  }
  async function pruneCache() { const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_PRUNE }); if (!response?.ok) throw new Error(response?.error || "缓存清理失败"); return Number(response.deleted || 0); }
  async function clearCache() { const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_CLEAR_ALL }); if (!response?.ok) throw new Error(response?.error || "清空缓存失败"); }
  async function behaviorSites(key: "cacheRestoreSites" | "autoSites") { const value = await api.storage.local.get([key]) as Record<string, unknown>, sites = value[key]; return Array.isArray(sites) ? [...new Set<string>(sites.filter((item): item is string => typeof item === "string"))].sort() : []; }

  async function removeBehavior(key: "cacheRestoreSites" | "autoSites", origin: string) {
    const type = key === "cacheRestoreSites" ? BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER : BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER;
    const response = await api.runtime.sendMessage({ type, origin }); if (!response?.ok) throw new Error(response?.error || "移除站点行为失败");
    const pattern = `${origin}/*`, stored = await api.storage.local.get(["cacheRestoreSites", "autoSites", "quickControlSites", "openAICompatible"]) as Record<string, unknown>;
    const stillNeeded = [stored.cacheRestoreSites, stored.autoSites, stored.quickControlSites].some(values => Array.isArray(values) && values.includes(origin));
    let providerNeeded = false; try { providerNeeded = getProviderHostPermissionPattern(objectRecord(stored.openAICompatible).baseUrl) === pattern; } catch {}
    if (!stillNeeded && !providerNeeded) await api.permissions.remove({ origins: [pattern] });
  }

  return { version: api.runtime.getManifest().version, loadConfig, saveConfig, testProvider, profiles, saveProfile, deleteProfile, cacheStats, pruneCache, clearCache, behaviorSites, removeBehavior };
}
export type OptionsClient = ReturnType<typeof optionsClient>;
function objectRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
