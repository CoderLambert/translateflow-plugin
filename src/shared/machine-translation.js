import { browserLanguage } from "./browser-translation.js";
import { normalizeOrigin } from "./url.js";
import { normalizeSourceText } from "./text.js";

// Product mode is deliberately separate from AI connections and credentials.
export const MACHINE_ENGINE = "machine-translation";
export const MACHINE_INPUT_VERSION = "mt-slots-v1";
export const MACHINE_PROVIDERS = Object.freeze([
  Object.freeze({ id: "mt-microsoft-web", label: "Microsoft", origin: "https://edge.microsoft.com", path: "/translate/translatetext", batchSize: 12 }),
  Object.freeze({ id: "mt-tencent-transmart", label: "Tencent Transmart", origin: "https://transmart.qq.com", path: "/api/imt", batchSize: 1 })
]);
export const DEFAULT_MACHINE_TRANSLATION = Object.freeze({ version: 1, mode: "legacy", providerId: "mt-microsoft-web", sourceLanguage: "auto" });

export function machineError(code, detail = {}) {
  return Object.assign(new Error(code), { code, ...detail });
}
export function machineProvider(id) {
  const provider = MACHINE_PROVIDERS.find(item => item.id === id);
  if (!provider) throw machineError("MT_CONFIG");
  return provider;
}
export function normalizeMachineTranslation(value) {
  if (value === undefined) return { ...DEFAULT_MACHINE_TRANSLATION };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["version", "mode", "providerId", "sourceLanguage"].includes(key)) ||
      value.version !== 1 || !["legacy", "free-online"].includes(value.mode)) throw machineError("MT_CONFIG");
  const provider = machineProvider(value.providerId);
  const sourceLanguage = value.sourceLanguage === "auto" ? "auto" : browserLanguage(value.sourceLanguage);
  if (!sourceLanguage) throw machineError("MT_LANGUAGE");
  return { version: 1, mode: value.mode, providerId: provider.id, sourceLanguage };
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
  if (site?.machineTranslation !== undefined) return normalizeMachineTranslation(site.machineTranslation);
  // Do not silently replace a user's explicitly selected site AI service.
  if (site?.serviceRef || site?.provider) return { ...DEFAULT_MACHINE_TRANSLATION };
  return normalizeMachineTranslation(stored?.machineTranslation);
}
export function resolveMachineTranslation(stored, site = null, surface = "page") {
  const settings = machineTranslationSettings(stored, site, surface);
  if (!settings || settings.mode !== "free-online") return null;
  return createMachineConfig(settings, site?.targetLanguage || stored?.targetLanguage);
}
export function createMachineConfig(settings, target) {
  const normalized = normalizeMachineTranslation(settings), provider = machineProvider(normalized.providerId);
  const targetLanguage = browserLanguage(target);
  if (!targetLanguage) throw machineError("MT_LANGUAGE");
  return Object.freeze({ engine: MACHINE_ENGINE, provider: provider.id, providerLabel: provider.label,
    model: "not-disclosed", prompt: "", sourceLanguage: normalized.sourceLanguage, targetLanguage,
    apiBaseUrl: provider.origin + provider.path, protocol: "mt-web-v1", inputVersion: MACHINE_INPUT_VERSION });
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
