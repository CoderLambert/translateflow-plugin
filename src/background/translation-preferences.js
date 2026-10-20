import { CONFIG_KEYS, DEFAULT_CONFIG } from "../shared/constants.js";
import { normalizeTranslationPreferences, selectedTranslationMethod, TEXT_METHODS, preferenceError } from "../shared/translation-preferences.js";
import { normalizeMachineTranslation, DEFAULT_MACHINE_TRANSLATION, MACHINE_AUTO_PROVIDERS, machineProvider, rawTranslationSite, resolveMachineTranslation } from "../shared/machine-translation.js";
import { resolveTranslationConfig, getProviderHostPermissionPattern } from "../shared/provider-config.js";
import { hasConfiguredAi } from "../shared/browser-translation.js";
import { resolvePreparationPair } from "../browser-native/preparation.js";
import { migrateLegacyProviderState } from "../shared/provider-connections.js";
import { browserLanguage } from "../shared/browser-translation.js";
import { normalizeOrigin } from "../shared/url.js";

import { machineHealth } from "./providers/machine-translation-health.js";

let initializing;
export function aiConfigurationComplete(stored, pageUrl = "") {
  try {
    if (!hasConfiguredAi(stored, rawTranslationSite(stored, pageUrl))) return false;
    const legacy = migrateLegacyProviderState(stored);
    const config = resolveTranslationConfig({ ...stored, providerConnections: legacy.connections, providerCredentials: legacy.credentials, defaultService: legacy.defaultService }, pageUrl);
    return Boolean(config.model && (config.provider === "chatgpt-plan" || config.apiKey || config.allowEmptyApiKey));
  } catch { return false; }
}
// Probe existing authorized documents only. availability() never creates or downloads a model.
export async function probeReadyBrowser(stored) {
  let timer;
  try {
    const pair = resolvePreparationPair(stored.browserSourceLanguage, stored.targetLanguage);
    const work = (async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find(item => Number.isInteger(item.id));
      if (!tab) return false;
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", args: [pair], func: async pair => {
        try {
          if (!globalThis.Translator?.availability || !globalThis.LanguageDetector?.availability) return false;
          const [translator, detector] = await Promise.all([globalThis.Translator.availability(pair), globalThis.LanguageDetector.availability()]);
          return translator === "available" && detector === "available";
        } catch { return false; }
      } });
      return results[0]?.result === true;
    })();
    return await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(false), 900); })]);
  } catch { return false; }
  finally { clearTimeout(timer); }
}
export function migrateTranslationPreferences(stored, browserReady = false) {
  const textMethod = aiConfigurationComplete(stored) ? "ai" : browserReady ? "browser-local" : "free-online";
  const profiles = {};
  for (const [origin, raw] of Object.entries(stored.siteProfiles || {})) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const site = { ...raw };
    if (!site.textMethod) {
      if (site.machineTranslation?.mode === "free-online") site.textMethod = "free-online";
      else if (site.serviceRef || site.provider) site.textMethod = "ai";
      else if (site.machineTranslation?.mode === "legacy") site.textMethod = hasConfiguredAi(stored, site) ? "ai" : "browser-local";
    }
    profiles[origin] = site;
  }
  return { translationPreferences: { version: 1, textMethod, wordMethod: "free-online" }, siteProfiles: profiles };
}
export async function ensureTranslationPreferences() {
  if (initializing) return initializing;
  initializing = (async () => {
    const raw = await chrome.storage.local.get(CONFIG_KEYS);
    if (raw.translationPreferences != null) return normalizeTranslationPreferences(raw.translationPreferences);
    const stored = { ...DEFAULT_CONFIG, ...raw };
    const browserReady = !aiConfigurationComplete(stored) && await probeReadyBrowser(stored);
    const latest = { ...DEFAULT_CONFIG, ...await chrome.storage.local.get(CONFIG_KEYS) };
    if (latest.translationPreferences != null) return normalizeTranslationPreferences(latest.translationPreferences);
    const patch = migrateTranslationPreferences(latest, browserReady);
    // An explicit v2 online setting was saved behind the old consent gate. A new default is never consent.
    const consentFor = value => ({ version: 1, routing: value.routing, providerId: value.providerId });
    if (raw.machineTranslation?.version === 2 && raw.machineTranslation.mode === "free-online") patch.machineTranslationConsent = consentFor(raw.machineTranslation);
    for (const profile of Object.values(patch.siteProfiles)) if (profile.machineTranslation?.version === 2 && profile.machineTranslation.mode === "free-online") profile.machineTranslationConsent = consentFor(profile.machineTranslation);
    await chrome.storage.local.set(patch);
    return patch.translationPreferences;
  })();
  try { return await initializing; } finally { initializing = null; }
}
export function onlineSettings(stored, site, surface = "page") {
  return normalizeMachineTranslation((surface === "selection-word" ? null : site?.machineTranslation) || stored.machineTranslation || DEFAULT_MACHINE_TRANSLATION);
}
export function onlineConsentValid(stored, site, surface = "page") {
  const settings = onlineSettings(stored, site, surface);
  const consent = surface !== "selection-word" && site && Object.hasOwn(site, "machineTranslationConsent") ? site.machineTranslationConsent : stored.machineTranslationConsent;
  return consent?.version === 1 && consent.routing === settings.routing && (settings.routing === "auto" || consent.providerId === settings.providerId);
}
export async function assertOnlineConsent(pageUrl, surface = "page") {
  const stored = await chrome.storage.local.get(["machineTranslation", "machineTranslationConsent", "siteProfiles"]);
  if (!onlineConsentValid(stored, rawTranslationSite(stored, pageUrl), surface)) throw Object.assign(new Error("请先确认允许向免费在线服务发送待翻译文本。"), { code: "MT_CONSENT" });
}
export async function readTranslationPreferences(pageUrl = "") {
  await ensureTranslationPreferences();
  const stored = { ...DEFAULT_CONFIG, ...await chrome.storage.local.get([...CONFIG_KEYS, "tfDictionaryPackStateV1", "tfRichMdictStateV1", "tfRichMdictPreferencesV1"]) }, site = rawTranslationSite(stored, pageUrl);
  const preferences = normalizeTranslationPreferences(stored.translationPreferences);
  const config = onlineSettings(stored, null), selected = onlineSettings(stored, site);
  let aiPermission = "";
  try { const ai = resolveTranslationConfig(stored, pageUrl); if (ai.provider !== "chatgpt-plan") aiPermission = getProviderHostPermissionPattern(ai.apiBaseUrl); } catch {}
  const health = await Promise.all([...new Set([...(config.routing === "auto" ? MACHINE_AUTO_PROVIDERS : [config.providerId]), ...(selected.routing === "auto" ? MACHINE_AUTO_PROVIDERS : [selected.providerId])])].map(async providerId => {
    const value = await machineHealth(providerId);
    return { providerId, until: value.until, code: value.code || "" };
  }));
  return { preferences, aiPermission, health, config: { ...config, method: preferences.textMethod }, selected: { ...selected, method: selectedTranslationMethod(stored, site) },
    siteOverride: site?.textMethod !== undefined, consent: onlineConsentValid(stored, site),
    globalConsent: onlineConsentValid(stored, null), targetLanguage: site?.targetLanguage || stored.targetLanguage,
    availability: { ai: aiConfigurationComplete(stored, pageUrl), browser: await probeReadyBrowser(stored), dictionary:
      Object.values(stored.tfDictionaryPackStateV1?.packs || {}).some(pack => pack?.status === "healthy" && pack.active) ||
      Object.entries(stored.tfRichMdictStateV1?.packs || {}).some(([id, pack]) => pack?.status === "healthy" && pack.active && stored.tfRichMdictPreferencesV1?.dictionaries?.[id]?.enabled !== false) }, errorCode: "" };
}
export async function saveTranslationPreferences(input) {
  await ensureTranslationPreferences();
  if (!["global", "site"].includes(input?.scope)) throw preferenceError();
  const stored = { ...DEFAULT_CONFIG, ...await chrome.storage.local.get(CONFIG_KEYS) };
  const preferences = input.scope === "global" ? normalizeTranslationPreferences(input.preferences) : normalizeTranslationPreferences(stored.translationPreferences);
  if (input.scope === "site" && (Object.hasOwn(input, "wordMethod") || input.preferences != null)) throw preferenceError();
  const method = input.scope === "global" ? preferences.textMethod : input.inherit ? preferences.textMethod : input.textMethod;
  if (!TEXT_METHODS.includes(method)) throw preferenceError();
  const config = normalizeMachineTranslation(input.config || stored.machineTranslation);
  const scopeSite = input.scope === "site" ? rawTranslationSite(stored, input.pageUrl) : null;
  const online = method === "free-online" || (input.scope === "global" && preferences.wordMethod === "free-online");
  if (online) {
    const onlineConfig = { ...stored, translationPreferences: { ...preferences, textMethod: "free-online" }, machineTranslation: { ...config, mode: "free-online" } };
    if (method === "free-online") resolveMachineTranslation(onlineConfig, input.scope === "site" ? { ...scopeSite, textMethod: "free-online", machineTranslation: config } : null);
    if (input.scope === "global" && preferences.wordMethod === "free-online") resolveMachineTranslation(onlineConfig, null, "selection-word");
    if (input.consent === true) {
      const providers = (config.routing === "auto" ? MACHINE_AUTO_PROVIDERS : [config.providerId]).map(machineProvider);
      if (!await chrome.permissions.contains({ origins: providers.map(p => `${p.origin}/*`) })) throw Object.assign(new Error("未授予服务访问权限。"), { code: "MT_PERMISSION" });
    }
  }
  if (method === "browser-local" && !browserLanguage(scopeSite?.targetLanguage || stored.targetLanguage) ||
      input.scope === "global" && preferences.wordMethod === "browser-local" && !browserLanguage(stored.targetLanguage)) throw Object.assign(new Error("请选择 Chrome 本地支持的目标语言。"), { code: "MT_LANGUAGE" });
  // Broken AI must be visible and must never select another method. Existing unavailable selections may still be retained.
  const previous = normalizeTranslationPreferences(stored.translationPreferences);
  const aiChanged = input.scope === "global" ? (preferences.textMethod === "ai" && previous.textMethod !== "ai") || (preferences.wordMethod === "ai" && previous.wordMethod !== "ai") : method === "ai" && selectedTranslationMethod(stored, scopeSite) !== "ai";
  if (!input.inherit && (aiChanged || input.consent === true && (method === "ai" || (input.scope === "global" && preferences.wordMethod === "ai")))) {
    if (!aiConfigurationComplete(stored, input.scope === "site" ? input.pageUrl : "")) throw Object.assign(new Error("请先完成 AI 连接配置。"), { code: "AI_REQUIRED" });
    const resolved = resolveTranslationConfig(stored, input.scope === "site" ? input.pageUrl : "");
    const origin = resolved.provider === "chatgpt-plan" ? "" : getProviderHostPermissionPattern(resolved.apiBaseUrl);
    if (origin && !await chrome.permissions.contains({ origins: [origin] })) throw Object.assign(new Error("未授予 AI 服务访问权限。"), { code: "MT_PERMISSION" });
  }
  const consent = input.consent === true ? { version: 1, routing: config.routing, providerId: config.providerId } : null;
  if (input.scope === "global") await chrome.storage.local.set({ translationPreferences: preferences, machineTranslation: config, machineTranslationConsent: consent });
  else {
    const origin = normalizeOrigin(input.pageUrl), profiles = { ...stored.siteProfiles }, profile = { ...(scopeSite || {}) };
    if (input.inherit) { delete profile.textMethod; delete profile.machineTranslation; delete profile.machineTranslationConsent; if (online && (input.consent === false || input.consent === true && !onlineConsentValid(stored, null))) profile.machineTranslationConsent = consent; }
    else { profile.textMethod = method; profile.machineTranslation = config; profile.machineTranslationConsent = consent; }
    if (Object.keys(profile).length) profiles[origin] = profile; else delete profiles[origin];
    await chrome.storage.local.set({ siteProfiles: profiles });
  }
  return readTranslationPreferences(input.scope === "site" ? input.pageUrl : "");
}
