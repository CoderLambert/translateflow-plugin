import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { EXTENSION_PAGES } from "../shared/runtime-assets.js";
import { DEFAULT_MACHINE_TRANSLATION, MACHINE_PROVIDERS, createMachineConfig, machineError,
  normalizeMachineTranslation, rawTranslationSite, machineTranslationSettings } from "../shared/machine-translation.js";
import { browserLanguage } from "../shared/browser-translation.js";
import { normalizeOrigin } from "../shared/url.js";
import { cancelTextTranslations, runTranslationRequest } from "./translation-requests.js";
import { invalidateMachineSnapshots } from "./effective-config-snapshots.js";

export async function readMachineTranslationSettings(pageUrl = "") {
  const stored = await chrome.storage.local.get(["machineTranslation", "siteProfiles", "targetLanguage"]);
  try {
    const config = normalizeMachineTranslation(stored.machineTranslation), site = rawTranslationSite(stored, pageUrl);
    return { config, selected: machineTranslationSettings(stored, site), siteOverride: site?.machineTranslation !== undefined,
      targetLanguage: site?.targetLanguage || stored.targetLanguage || "Simplified Chinese", providers: MACHINE_PROVIDERS, errorCode: "" };
  } catch (error) {
    return { config: { ...DEFAULT_MACHINE_TRANSLATION }, selected: null, siteOverride: false,
      targetLanguage: stored.targetLanguage || "Simplified Chinese", providers: MACHINE_PROVIDERS, errorCode: error?.code || "MT_CONFIG" };
  }
}

export async function saveMachineTranslationSettings(input) {
  if (!["global", "site"].includes(input?.scope)) throw machineError("MT_CONFIG");
  const resetSite = input.scope === "site" && input.inherit === true;
  const config = resetSite ? null : normalizeMachineTranslation(input.config);
  if (config?.mode === "free-online" && input.consent !== true) throw machineError("MT_CONSENT");
  if (config?.mode === "free-online") {
    const provider = MACHINE_PROVIDERS.find(item => item.id === config.providerId);
    if (!await chrome.permissions.contains({ origins: [`${provider.origin}/*`] })) throw machineError("MT_PERMISSION");
  }
  if (input.scope === "global") await chrome.storage.local.set({ machineTranslation: config });
  else {
    const origin = normalizeOrigin(input.pageUrl);
    const stored = await chrome.storage.local.get(["siteProfiles"]);
    const profiles = { ...(stored.siteProfiles || {}) }, profile = { ...(profiles[origin] || {}) };
    if (resetSite) delete profile.machineTranslation; else profile.machineTranslation = config;
    if (Object.keys(profile).length) profiles[origin] = profile; else delete profiles[origin];
    await chrome.storage.local.set({ siteProfiles: profiles });
  }
  cancelTextTranslations(input.scope === "site" ? input.pageUrl : "");
  invalidateMachineSnapshots();
  return readMachineTranslationSettings(input.scope === "site" ? input.pageUrl : "");
}

export async function testMachineTranslationSettings(input) {
  const target = browserLanguage(input?.targetLanguage || "zh");
  if (!target) throw machineError("MT_LANGUAGE");
  const source = target === "en" ? "zh" : "en";
  const text = source === "en" ? "This is a translation connection test." : "这是一条翻译连接测试。";
  const config = createMachineConfig({ version: 1, mode: "free-online", providerId: input.providerId, sourceLanguage: source }, target);
  const requestId = String(input.requestId || "");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/u.test(requestId)) throw machineError("MT_INPUT");
  const start = performance.now();
  const translated = await runTranslationRequest({ requestId, segments: [{ id: "connection-test", text }], config });
  return { providerId: config.provider, sourceLanguage: source, targetLanguage: target, sampleText: text,
    translatedText: translated[0].text, checkedAt: Date.now(), elapsedMs: Math.round(performance.now() - start) };
}

export const MACHINE_SETTING_MESSAGES = Object.freeze([BACKGROUND_MESSAGES.MACHINE_TRANSLATION_GET, BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE, BACKGROUND_MESSAGES.MACHINE_TRANSLATION_TEST]);
export function handleMachineSettingsMessage(message, sender) {
  assertTranslationUiSender(sender);
  if (message.type === BACKGROUND_MESSAGES.MACHINE_TRANSLATION_GET) return readMachineTranslationSettings(message.pageUrl);
  if (message.type === BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE) return saveMachineTranslationSettings(message);
  return testMachineTranslationSettings(message);
}

function assertTranslationUiSender(sender) {
  const actual = String(sender?.url || "");
  if (sender?.id !== chrome.runtime.id || ![EXTENSION_PAGES.options, "popup.html"].some(path => { const url = chrome.runtime.getURL(path); return actual === url || actual.startsWith(url + "#"); })) {
    throw Object.assign(new Error("Translation settings require a trusted extension page."), { code: "MT_PERMISSION" });
  }
}

