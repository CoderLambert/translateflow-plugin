import { BACKGROUND_MESSAGES, DEFAULT_CONFIG, DEFAULT_OPENAI_COMPATIBLE, PROVIDER_IDS } from "../shared/constants.js";
import { DEFAULT_APPEARANCE_ID, normalizeAppearanceId } from "../shared/appearance.js";
import { getProviderHostPermissionPattern, normalizeOpenAIBaseUrl, normalizeSiteProfile } from "../shared/provider-config.js";
import { normalizeSelectionDepth } from "../shared/selection.js";
import { normalizeOrigin } from "../shared/url.js";
import { createI18n } from "../i18n/index.js";
import type { I18n } from "../i18n/index.js";
import { CHATGPT_PLAN_NATIVE_PERMISSION } from "../shared/chatgpt-native-host.js";
import { getConnectionHostPermissionPattern, normalizeProviderBaseUrl } from "../shared/provider-connections.js";

export type OptionsConfig = { provider: string; apiKey: string; model: string; chatgptPlanModel: string; prompt: string; targetLanguage: string; appearance: string; cacheMaxMB: number; openAICompatible: { baseUrl: string; apiKey: string; model: string; streaming: boolean }; youtubeSubtitleMode: string; youtubeSubtitleSize: string; selectionExplanationDepth: string };
export type ServiceRef = { kind: "api-key"; connectionId: string } | { kind: "chatgpt-plan" };
export type ProviderConnection = { id: string; revision: number; name: string; platform: string; protocol: string; baseUrl: string; credentialId: string; defaultModel: string; hasApiKey: boolean; settings: { streaming: boolean; outputTokens: number; temperature: number | null; reasoning: string; allowEmptyApiKey: boolean; allowInsecureHttp: boolean } };
export type ProviderConnectionState = { version: number; defaultService: ServiceRef | null; connections: ProviderConnection[] };
export type SiteProfile = { serviceRef?: ServiceRef; provider?: string; preset?: string; appearance?: string; model?: string; prompt?: string; targetLanguage?: string };
export type SiteEntry = { origin: string; profile: SiteProfile };
export type CacheStats = { pageCount: number; segmentCount: number; bytes: number };
export type ChatGPTPlanAccount = { id: string; label: string; email?: string; connected: boolean };
export type ChatGPTPlanAuthStatus = { connected: boolean; canInfer: boolean; expiresAt?: string; storage: string; activeAccountId?: string; accounts: ChatGPTPlanAccount[]; hostVersion?: string; protocolVersion?: number };
export type ChatGPTPlanModel = { slug: string; displayName: string };

export function optionsClient(api: typeof chrome = chrome, i18n: I18n = createI18n({ browserLocale: api.i18n.getUILanguage() })) {
  async function loadConfig(): Promise<OptionsConfig> {
    const value = await api.storage.local.get(["provider", "apiKey", "model", "chatgptPlanModel", "prompt", "targetLanguage", "appearance", "cacheMaxMB", "openAICompatible", "youtubeSubtitleMode", "youtubeSubtitleSize", "selectionExplanationDepth"]) as Record<string, unknown>;
    const openAI = { ...DEFAULT_OPENAI_COMPATIBLE, ...objectRecord(value.openAICompatible) };
    return {
      provider: text(value.provider, DEFAULT_CONFIG.provider), apiKey: text(value.apiKey),
      model: text(value.model, DEFAULT_CONFIG.model),
      chatgptPlanModel: text(value.chatgptPlanModel),
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
    if (!pattern) throw new Error(i18n.t("options.openaiBaseRequired"));
    if (!await api.permissions.request({ origins: [pattern] })) throw new Error(i18n.t("options.apiPermissionDenied", { pattern }));
  }

  async function ensureConnectionPermission(raw: string) {
    const pattern = getConnectionHostPermissionPattern(raw);
    if (!pattern) throw new Error(i18n.t("options.openaiBaseRequired"));
    if (!await api.permissions.request({ origins: [pattern] })) throw new Error(i18n.t("options.apiPermissionDenied", { pattern }));
  }

  function normalizeConfig(input: OptionsConfig): OptionsConfig {
    const max = Math.min(2048, Math.max(20, Number(input.cacheMaxMB) || DEFAULT_CONFIG.cacheMaxMB));
    const provider = input.provider || PROVIDER_IDS.DEEPSEEK;
    return { ...input, provider, apiKey: input.apiKey.trim(), model: input.model.trim() || DEFAULT_CONFIG.model, chatgptPlanModel: input.chatgptPlanModel.trim(),
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
    await api.storage.local.set({ provider: value.provider, apiKey: value.apiKey, model: value.model, chatgptPlanModel: value.chatgptPlanModel, prompt: value.prompt, targetLanguage: value.targetLanguage,
      appearance: value.appearance, cacheMaxMB: value.cacheMaxMB, openAICompatible: value.openAICompatible,
      youtubeSubtitleMode: value.youtubeSubtitleMode, youtubeSubtitleSize: value.youtubeSubtitleSize, selectionExplanationDepth: value.selectionExplanationDepth });
    return value;
  }

  async function testProvider() {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.TEST_API });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.apiTestFailed"));
    return String(response.result || "");
  }

  async function providerConnections(): Promise<ProviderConnectionState> {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.PROVIDER_CONNECTIONS_LIST });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.readFailed"));
    return { version: Number(response.version || 1), defaultService: response.defaultService || null, connections: Array.isArray(response.connections) ? response.connections : [] };
  }

  async function saveProviderConnection(connection: Omit<ProviderConnection, "hasApiKey">, expectedRevision: number, apiKey: string, updateCredential: boolean) {
    await ensureConnectionPermission(normalizeProviderBaseUrl(connection.baseUrl));
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.PROVIDER_CONNECTION_UPSERT, connection, expectedRevision, apiKey, updateCredential });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.apiTestFailed"));
    return response.connection as ProviderConnection;
  }

  async function deleteProviderConnection(connection: ProviderConnection) {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.PROVIDER_CONNECTION_DELETE, connectionId: connection.id, expectedRevision: connection.revision });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.apiTestFailed"));
  }

  async function setDefaultService(service: ServiceRef) {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.DEFAULT_SERVICE_SET, service });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.apiTestFailed"));
    return response.defaultService as ServiceRef;
  }

  async function testProviderConnection(connectionId: string) {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.PROVIDER_CONNECTION_TEST, connectionId });
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.apiTestFailed"));
    return String(response.result || "");
  }

  async function hasChatGPTPlanPermission() {
    const manifest = api.runtime.getManifest();
    if (manifest.permissions?.includes(CHATGPT_PLAN_NATIVE_PERMISSION)) return true;
    if (!manifest.optional_permissions?.includes(CHATGPT_PLAN_NATIVE_PERMISSION)) return false;
    return api.permissions.contains({ permissions: [CHATGPT_PLAN_NATIVE_PERMISSION] });
  }

  async function requestChatGPTPlanPermission() {
    if (await hasChatGPTPlanPermission()) return true;
    const manifest = api.runtime.getManifest();
    if (!manifest.optional_permissions?.includes(CHATGPT_PLAN_NATIVE_PERMISSION)) return false;
    return api.permissions.request({ permissions: [CHATGPT_PLAN_NATIVE_PERMISSION] });
  }

  async function chatGPTPlanAction(action: "status" | "models" | "restart" | "connect" | "add" | "select" | "logout", accountId?: string) {
    const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CHATGPT_PLAN_ACTION, action, accountId });
    if (!response?.ok) {
      const error = Object.assign(new Error(String(response?.error || i18n.t("options.chatgptPlan.actionFailed"))), {
        code: String(response?.errorCode || ""),
        modelSelectionCleared: Boolean(response?.modelSelectionCleared)
      });
      throw error;
    }
    return response as { status?: ChatGPTPlanAuthStatus; models?: ChatGPTPlanModel[]; connected?: boolean; restarted?: boolean; selected?: boolean; modelSelectionCleared?: boolean; revocationConfirmed?: boolean };
  }

  async function profiles(): Promise<SiteEntry[]> {
    const stored = await api.storage.local.get(["siteProfiles"]) as Record<string, unknown>;
    return Object.entries(objectRecord(stored.siteProfiles)).sort(([a], [b]) => a.localeCompare(b)).map(([origin, raw]) => ({ origin, profile: normalizeSiteProfile(objectRecord(raw)) as SiteProfile }));
  }

  async function saveProfile(originInput: string, profileInput: SiteProfile) {
    const origin = normalizeOrigin(originInput), profile = normalizeSiteProfile(profileInput);
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
    if (!response?.ok) throw new Error(response?.error || i18n.t("options.readFailed"));
    return { pageCount: Number(response.pageCount || 0), segmentCount: Number(response.segmentCount || 0), bytes: Number(response.bytes || 0) };
  }
  async function pruneCache() { const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_PRUNE }); if (!response?.ok) throw new Error(response?.error || i18n.t("options.cachePruneFailed")); return Number(response.deleted || 0); }
  async function clearCache() { const response = await api.runtime.sendMessage({ type: BACKGROUND_MESSAGES.CACHE_CLEAR_ALL }); if (!response?.ok) throw new Error(response?.error || i18n.t("options.cacheClearFailed")); }
  async function behaviorSites(key: "cacheRestoreSites" | "autoSites") { const value = await api.storage.local.get([key]) as Record<string, unknown>, sites = value[key]; return Array.isArray(sites) ? [...new Set<string>(sites.filter((item): item is string => typeof item === "string"))].sort() : []; }

  async function removeBehavior(key: "cacheRestoreSites" | "autoSites", origin: string) {
    const type = key === "cacheRestoreSites" ? BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER : BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER;
    const response = await api.runtime.sendMessage({ type, origin }); if (!response?.ok) throw new Error(response?.error || i18n.t("options.behaviorRemoveFailed"));
    const pattern = `${origin}/*`, stored = await api.storage.local.get(["cacheRestoreSites", "autoSites", "quickControlSites", "openAICompatible"]) as Record<string, unknown>;
    const stillNeeded = [stored.cacheRestoreSites, stored.autoSites, stored.quickControlSites].some(values => Array.isArray(values) && values.includes(origin));
    let providerNeeded = false; try { providerNeeded = getProviderHostPermissionPattern(objectRecord(stored.openAICompatible).baseUrl) === pattern; } catch {}
    if (!providerNeeded) { try { providerNeeded = (await providerConnections()).connections.some(connection => getConnectionHostPermissionPattern(connection.baseUrl) === pattern); } catch {} }
    if (!stillNeeded && !providerNeeded) await api.permissions.remove({ origins: [pattern] });
  }

  return { version: api.runtime.getManifest().version, loadConfig, saveConfig, testProvider, providerConnections, saveProviderConnection,
    deleteProviderConnection, setDefaultService, testProviderConnection, hasChatGPTPlanPermission, requestChatGPTPlanPermission,
    chatGPTPlanAction, profiles, saveProfile, deleteProfile, cacheStats, pruneCache, clearCache, behaviorSites, removeBehavior };
}
export type OptionsClient = ReturnType<typeof optionsClient>;
function objectRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
