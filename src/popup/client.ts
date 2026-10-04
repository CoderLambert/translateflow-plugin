import { BACKGROUND_MESSAGES, CONTENT_MESSAGES, CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../shared/constants.js";
import { DEFAULT_APPEARANCE_ID, TRANSLATION_APPEARANCES, normalizeAppearanceId, resolveAppearance } from "../shared/appearance.js";
import { getProviderHostPermissionPattern } from "../shared/provider-config.js";
import { READING_METHOD, READING_PROTOCOL_VERSION } from "../shared/reading/constants.js";
import { getOriginMatchPattern, normalizeOrigin } from "../shared/url.js";

export type Site = { tab: { id: number; url: string }; origin: string; match: string };
export type EffectiveContext = { hostname?: string; origin?: string; provider?: string; model?: string; presetId?: string; presetLabel?: string; presetSource?: string; temporaryPresetActive?: boolean; temporaryPresetId?: string; savedPresetId?: string; selectedPresetId?: string; hasSitePromptOverride?: boolean; glossaryCount?: number };
export type CacheStatus = { count: number; totalCount: number; lastAccessedAt?: number };
export type TaskStatus = { state: string; done: number; total: number; error?: string };
export type ToggleStatus = { enabled: boolean; hidden?: boolean; origin: string };
export type AppearanceStatus = { available: boolean; selected: string; defaultId: string; title: string };

type RuntimeResponse = { ok?: boolean; error?: string; [key: string]: unknown };

export function popupClient(api: typeof chrome = chrome) {
  async function getActiveSite(): Promise<Site> {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("未找到当前标签页。");
    if (!/^https?:/iu.test(tab.url || "")) throw new Error("Chrome 内部页面、扩展页等受保护页面无法注入脚本。请在普通 http/https 网页上使用。");
    const url = tab.url as string;
    const origin = normalizeOrigin(url);
    return { tab: { id: tab.id, url }, origin, match: getOriginMatchPattern(origin) };
  }

  async function sendRuntime(message: object): Promise<RuntimeResponse> {
    return await api.runtime.sendMessage(message) as RuntimeResponse;
  }

  async function ensureInjected(tabId: number) {
    let injected = false;
    try { injected = Boolean((await api.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.STATUS }))?.ok); } catch {}
    if (!injected) {
      await api.scripting.insertCSS({ target: { tabId }, files: [...CONTENT_STYLE_FILES] });
      await api.scripting.executeScript({ target: { tabId }, files: [...CONTENT_SCRIPT_FILES] });
    }
    try { await api.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.QUICK_CONTROL_SHOW }); } catch {}
  }

  async function sendContent(type: string, fields: Record<string, unknown> = {}) {
    const site = await getActiveSite();
    await ensureInjected(site.tab.id);
    return await api.tabs.sendMessage(site.tab.id, { type, ...fields }) as RuntimeResponse;
  }

  async function context(): Promise<EffectiveContext> {
    const site = await getActiveSite();
    const response = await sendRuntime({ type: BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT, pageUrl: site.tab.url });
    if (!response.ok) throw new Error(response.error || "无法读取有效翻译配置。");
    return response.context as EffectiveContext;
  }

  async function cacheStatus(): Promise<CacheStatus> {
    const result = await sendContent(CONTENT_MESSAGES.CACHE_STATUS);
    if (!result.ok) throw new Error(result.error || "无法读取缓存状态");
    return { count: Number(result.count || 0), totalCount: Number(result.totalCount || 0), ...(result.lastAccessedAt ? { lastAccessedAt: Number(result.lastAccessedAt) } : {}) };
  }

  async function toggleStatus(kind: "auto" | "cache" | "quick"): Promise<ToggleStatus> {
    const site = await getActiveSite();
    const keys = kind === "auto" ? ["autoSites"] : kind === "cache" ? ["cacheRestoreSites"] : ["quickControlSites", "quickControlHiddenSites"];
    const stored = await api.storage.local.get(keys) as Record<string, unknown>;
    const permitted = await api.permissions.contains({ origins: [site.match] });
    const values = kind === "auto" ? stored.autoSites : kind === "cache" ? stored.cacheRestoreSites : stored.quickControlSites;
    return { enabled: Array.isArray(values) && values.includes(site.origin) && permitted, ...(kind === "quick" ? { hidden: Array.isArray(stored.quickControlHiddenSites) && stored.quickControlHiddenSites.includes(site.origin) } : {}), origin: site.origin };
  }

  async function appearance(): Promise<AppearanceStatus> {
    try {
      const site = await getActiveSite();
      const stored = await api.storage.local.get(["appearance", "siteProfiles"]) as Record<string, unknown>;
      const defaultId = normalizeAppearanceId(stored.appearance) || DEFAULT_APPEARANCE_ID;
      const profiles = objectRecord(stored.siteProfiles), profile = objectRecord(profiles[site.origin]);
      const selected = normalizeAppearanceId(profile.appearance) || "";
      const resolved = resolveAppearance(defaultId, selected);
      return { available: true, selected, defaultId, title: `当前：${resolved.label}（${resolved.source === "site" ? "本站" : "默认"}）` };
    } catch { return { available: false, selected: "", defaultId: DEFAULT_APPEARANCE_ID, title: "不可用于当前页面" }; }
  }

  async function saveAppearance(value: string): Promise<AppearanceStatus> {
    const site = await getActiveSite();
    const stored = await api.storage.local.get(["appearance", "siteProfiles"]) as Record<string, unknown>;
    const defaultId = normalizeAppearanceId(stored.appearance) || DEFAULT_APPEARANCE_ID;
    const storedProfiles = objectRecord(stored.siteProfiles);
    const nextProfile: Record<string, unknown> = { ...objectRecord(storedProfiles[site.origin]) };
    const selected = normalizeAppearanceId(value) || "";
    if (selected) nextProfile.appearance = selected; else delete nextProfile.appearance;
    const siteProfiles: Record<string, unknown> = { ...storedProfiles };
    if (Object.keys(nextProfile).length) siteProfiles[site.origin] = nextProfile; else delete siteProfiles[site.origin];
    await api.storage.local.set({ siteProfiles });
    const resolved = resolveAppearance(defaultId, selected);
    return { available: true, selected, defaultId, title: `当前：${resolved.label}（${resolved.source === "site" ? "本站" : "默认"}）` };
  }

  async function maybeRelease(site: Site) {
    const stored = await api.storage.local.get(["cacheRestoreSites", "autoSites", "quickControlSites", "openAICompatible"]) as Record<string, unknown>;
    const { cacheRestoreSites = [], autoSites = [], quickControlSites = [] } = stored;
    let providerNeeded = false;
    try { providerNeeded = getProviderHostPermissionPattern(objectRecord(stored.openAICompatible).baseUrl) === site.match; } catch {}
    const needed = providerNeeded || [cacheRestoreSites, autoSites, quickControlSites].some(value => Array.isArray(value) && value.includes(site.origin));
    if (!needed) await api.permissions.remove({ origins: [site.match] });
  }

  async function toggleSite(kind: "auto" | "cache" | "quick", current: ToggleStatus) {
    const site = await getActiveSite();
    if (kind === "quick" && current.hidden) {
      const response = await sendRuntime({ type: BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_SHOW, origin: site.origin });
      if (!response.ok) throw new Error(response.error || "恢复 Quick Control 失败");
      await ensureInjected(site.tab.id);
      return "已允许 Quick Control 在当前页显示；尚未开启本站持久显示。";
    }
    if (current.enabled) {
      const type = kind === "auto" ? BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER : kind === "cache" ? BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER : BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_UNREGISTER;
      if (kind === "auto") { try { await api.tabs.sendMessage(site.tab.id, { type: CONTENT_MESSAGES.DISABLE_AUTO }); } catch {} }
      const response = await sendRuntime({ type, origin: site.origin });
      if (!response.ok) throw new Error(response.error || "关闭站点功能失败");
      await maybeRelease(site);
      return kind === "auto" ? "已关闭本站自动增量翻译；已有 IndexedDB 缓存仍保留。" : kind === "cache" ? "已关闭本站自动缓存恢复；已有 IndexedDB 缓存仍保留。" : "已关闭本站持久 Quick Control；当前标签页仍可继续使用。";
    }
    const granted = await api.permissions.request({ origins: [site.match] });
    if (!granted) throw new Error(kind === "auto" ? "未授予本站权限，自动翻译未开启。" : kind === "cache" ? "未授予本站权限，自动缓存恢复未开启。" : "未授予本站权限，Quick Control 不会持久显示。");
    const type = kind === "auto" ? BACKGROUND_MESSAGES.AUTO_SITE_REGISTER : kind === "cache" ? BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_REGISTER : BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_REGISTER;
    const response = await sendRuntime({ type, origin: site.origin });
    if (!response.ok) throw new Error(response.error || "站点功能注册失败");
    await ensureInjected(site.tab.id);
    if (kind === "auto") {
      const started = await api.tabs.sendMessage(site.tab.id, { type: CONTENT_MESSAGES.ENABLE_AUTO });
      if (!started?.ok) throw new Error(started?.error || "当前页面自动翻译启动失败");
    }
    return kind === "auto" ? "本站已开启自动增量翻译。以后进入该站会自动恢复缓存并补译新增内容。" : kind === "cache" ? "本站已开启自动缓存恢复。以后进入本站会优先从 IndexedDB 还原译文，不会因此调用 API。" : "本站 Quick Control 已开启持久显示。";
  }

  return {
    appearances: TRANSLATION_APPEARANCES, context, cacheStatus, toggleStatus, appearance, saveAppearance, toggleSite,
    openOptions: () => api.runtime.openOptionsPage(),
    openLearning: async () => { const response = await sendRuntime({ protocolVersion: READING_PROTOCOL_VERSION, method: READING_METHOD.OPEN_LEARNING_CENTER }); if (!response.ok) throw new Error("无法打开学习中心，请重试。"); },
    prepareTranslation: async (taskId: string) => { const site = await getActiveSite(); await ensureInjected(site.tab.id); return { site, run: () => api.tabs.sendMessage(site.tab.id, { type: CONTENT_MESSAGES.TRANSLATE_PAGE, taskId }) as Promise<RuntimeResponse> }; },
    cancel: (tabId: number, taskId: string) => api.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.CANCEL_TASK, taskId }),
    taskStatus: (tabId: number, taskId: string) => api.tabs.sendMessage(tabId, { type: CONTENT_MESSAGES.TASK_STATUS, taskId }) as Promise<{ task?: TaskStatus }>,
    action: (type: string) => sendContent(type),
    applyPreset: async (preset: string, persist: boolean) => { const site = await getActiveSite(); const before = await context(); const response = await sendRuntime({ type: persist ? BACKGROUND_MESSAGES.SITE_PRESET_SAVE : BACKGROUND_MESSAGES.TEMP_PRESET_SET, pageUrl: site.tab.url, preset }); if (!response.ok) throw new Error(response.error || "翻译模式切换失败。"); return { before, context: response.context as EffectiveContext }; }
  };
}

export type PopupClient = ReturnType<typeof popupClient>;

function objectRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
