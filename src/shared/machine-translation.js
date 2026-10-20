import { selectedTranslationMethod } from "./translation-preferences.js";
import { browserLanguage } from "./browser-translation.js";
import { normalizeOrigin } from "./url.js";
import { normalizeSourceText } from "./text.js";

// Product mode is deliberately separate from AI connections and credentials.
export const MACHINE_ENGINE = "machine-translation";
// The visible-URL privacy policy changes actual free-MT transport: never
// restore translations produced before URL protection from the DB4 cache.
export const MACHINE_INPUT_VERSION = "mt-slots-v2";
export const MACHINE_PROVIDERS = Object.freeze([
  { id: "mt-microsoft-web", label: "Microsoft", origin: "https://edge.microsoft.com", path: "/translate/translatetext", batchSize: 12 },
  { id: "mt-bilibili", label: "Bilibili Index Translate", origin: "https://index-translate.bilibili.com", path: "/v1/chat/completions", batchSize: 1, model: "Index-Translate-35B-A3B" },
  { id: "mt-google-web", label: "Google", origin: "https://translate.googleapis.com", path: "/translate_a/single", batchSize: 1 },
  { id: "mt-volcengine-web", label: "Volcengine", origin: "https://translate.volcengine.com", path: "/crx/translate/v1", batchSize: 1 },
  { id: "mt-youdao-web", label: "Youdao", origin: "https://aidemo.youdao.com", path: "/trans", batchSize: 1 },
  { id: "mt-tencent-transmart", label: "Tencent Transmart", origin: "https://transmart.qq.com", path: "/api/imt", batchSize: 1 }
].map(item => Object.freeze({ maxCodePoints: 1000, adapterVersion: "1", ...item })));
// Enable a new web protocol in the default pool only after real MV3 acceptance.
export const MACHINE_AUTO_PROVIDERS = Object.freeze(["mt-microsoft-web", "mt-bilibili", "mt-google-web", "mt-youdao-web"]);
export const DEFAULT_MACHINE_TRANSLATION = Object.freeze({ version: 2, mode: "legacy", routing: "auto", providerId: "mt-microsoft-web", sourceLanguage: "auto" });

export function machineError(code, detail = {}) {
  return Object.assign(new Error(code), { code, ...detail });
}
export function machineProvider(id) {
  const provider = MACHINE_PROVIDERS.find(item => item.id === id);
  if (!provider) throw machineError("MT_CONFIG");
  return provider;
}
export function normalizeMachineTranslation(value) {
  if (value === undefined || value?.version === 1) return { ...DEFAULT_MACHINE_TRANSLATION };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["version", "mode", "routing", "providerId", "sourceLanguage"].includes(key)) ||
      value.version !== 2 || !["legacy", "free-online"].includes(value.mode) || !["auto", "fixed"].includes(value.routing)) throw machineError("MT_CONFIG");
  const provider = machineProvider(value.providerId);
  const sourceLanguage = value.sourceLanguage === "auto" ? "auto" : browserLanguage(value.sourceLanguage);
  if (!sourceLanguage) throw machineError("MT_LANGUAGE");
  return { version: 2, mode: value.mode, routing: value.routing, providerId: provider.id, sourceLanguage };
}
export function rawTranslationSite(stored, pageUrl = "") {
  if (!pageUrl) return null;
  let origin;
  try { const url = new URL(pageUrl); if (!/^https?:$/u.test(url.protocol)) return null; origin = normalizeOrigin(pageUrl); } catch { return null; }
  const site = stored?.siteProfiles?.[origin];
  return site && typeof site === "object" && !Array.isArray(site) ? site : null;
}
export function machineTranslationSettings(stored, site = null, surface = "page") {
  // Subtitle/assistant routes retain their existing AI contract.
  if (surface === "subtitle" || surface === "assistant" || surface === "selection-ai") return null;
  if (stored?.translationPreferences) {
    const method = selectedTranslationMethod(stored, site, surface);
    const value = normalizeMachineTranslation((surface === "selection-word" ? null : site?.machineTranslation) || stored.machineTranslation);
    return { ...value, mode: method === "free-online" ? "free-online" : "legacy" };
  }
  if (site?.machineTranslation !== undefined) return normalizeMachineTranslation(site.machineTranslation);
  // Do not silently replace a user's explicitly selected site AI service.
  if (site?.serviceRef || site?.provider) return { ...DEFAULT_MACHINE_TRANSLATION };
  return normalizeMachineTranslation(stored?.machineTranslation);
}
export function resolveMachineTranslation(stored, site = null, surface = "page") {
  const settings = machineTranslationSettings(stored, site, surface);
  if (!settings || settings.mode !== "free-online") return null;
  const target = site?.targetLanguage || stored?.targetLanguage;
  if (settings.routing === "fixed") return createMachineConfig(settings, target);
  const candidates = MACHINE_AUTO_PROVIDERS.filter(id => machineSupports(id, settings.sourceLanguage, browserLanguage(target)))
    .map(providerId => createMachineConfig({ ...settings, routing: "fixed", providerId }, target));
  if (!candidates.length) throw machineError("MT_LANGUAGE");
  return Object.freeze({ ...candidates[0], routing: "auto", routeCandidates: candidates });
}
export function createMachineConfig(settings, target) {
  const normalized = normalizeMachineTranslation(settings), provider = machineProvider(normalized.providerId);
  const targetLanguage = browserLanguage(target);
  if (!targetLanguage || !machineSupports(provider.id, normalized.sourceLanguage, targetLanguage)) throw machineError("MT_LANGUAGE");
  return Object.freeze({ engine: MACHINE_ENGINE, provider: provider.id, providerLabel: provider.label,
    model: provider.model || "not-disclosed", adapterVersion: provider.adapterVersion, prompt: "", sourceLanguage: normalized.sourceLanguage, targetLanguage,
    apiBaseUrl: provider.origin + provider.path, protocol: ["mt-microsoft-web", "mt-tencent-transmart"].includes(provider.id) ? "mt-web-v1" : `${provider.id}-v${provider.adapterVersion}`, inputVersion: MACHINE_INPUT_VERSION });
}
export function normalizeProtectedIds(value = []) {
  if (!Array.isArray(value) || value.length > 512 || value.some(id => !Number.isSafeInteger(id) || id < 0 || id > 100000)) throw machineError("MT_STRUCTURE");
  return [...new Set(value)].sort((a, b) => a - b);
}
export function machineSourceIdentity(text, protectedIds = []) {
  return JSON.stringify([MACHINE_INPUT_VERSION, normalizeSourceText(text), normalizeProtectedIds(protectedIds)]);
}
export function machineLanguage(providerId, language, target = false) {
  machineProvider(providerId);
  if (language === "auto" && !target) return providerId === "mt-microsoft-web" ? "" : "auto";
  const code = browserLanguage(language);
  if (!code) throw machineError("MT_LANGUAGE");
  if (providerId === "mt-microsoft-web") return code === "zh" ? "zh-Hans" : code === "sr" ? "sr-Cyrl" : code;
  return code === "zh-Hant" ? "zh-tw" : code;
}

export function machineSupports(id, from, to) {
  machineProvider(id);
  from = from === "auto" ? "auto" : browserLanguage(from);
  to = browserLanguage(to);
  if (!to || !from) return false;
  if (id === "mt-youdao-web") return ["en", "zh"].includes(to) && ["auto", "en", "zh"].includes(from) && from !== to;
  if (id === "mt-bilibili") return ["en", "zh", "ja", "ko", "fr", "de", "es", "ru", "pt", "it", "ar", "vi", "th", "id"].includes(to);
  return true;
}
