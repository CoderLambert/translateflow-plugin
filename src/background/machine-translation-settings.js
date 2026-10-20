import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { EXTENSION_PAGES } from "../shared/runtime-assets.js";
import { DEFAULT_MACHINE_TRANSLATION, MACHINE_PROVIDERS, MACHINE_AUTO_PROVIDERS, resolveMachineTranslation, createMachineConfig, machineError,
  normalizeMachineTranslation, rawTranslationSite, machineTranslationSettings } from "../shared/machine-translation.js";
import { browserLanguage } from "../shared/browser-translation.js";
import { normalizeOrigin } from "../shared/url.js";
import { cancelTextTranslations, runTranslationRequest } from "./translation-requests.js";
import { machineHealth } from "./providers/machine-translation-health.js";
import { invalidateMachineSnapshots } from "./effective-config-snapshots.js";

export async function readMachineTranslationSettings(pageUrl = "") {
  const stored = await chrome.storage.local.get(["machineTranslation", "siteProfiles", "targetLanguage"]);
  try {
    const config = normalizeMachineTranslation(stored.machineTranslation), site = rawTranslationSite(stored, pageUrl);
    return { config, selected: machineTranslationSettings(stored, site), siteOverride: site?.machineTranslation !== undefined,
      targetLanguage: site?.targetLanguage || stored.targetLanguage || "Simplified Chinese", providers: MACHINE_PROVIDERS, health: await Promise.all(MACHINE_PROVIDERS.map(async p => ({ providerId: p.id, ...await machineHealth(p.id) }))), errorCode: "" };
  } catch (error) {
    return { config: { ...DEFAULT_MACHINE_TRANSLATION }, selected: null, siteOverride: false,
      targetLanguage: stored.targetLanguage || "Simplified Chinese", providers: MACHINE_PROVIDERS, errorCode: error?.code || "MT_CONFIG" };
  }
}

export async function saveMachineTranslationSettings(input) {
  throw Object.assign(new Error("翻译偏好已升级，请重新打开设置后保存。"), { code: "PREFERENCES_REOPEN" });
}

export async function testMachineTranslationSettings(input) {
  // UI consent is necessary but not sufficient: the trusted background
  // request boundary must reject an omitted/false confirmation as well.
  if (input?.consent !== true) throw machineError("MT_CONSENT");
  const provider = MACHINE_PROVIDERS.find(item => item.id === input.providerId);
  if (!provider) throw machineError("MT_CONFIG");
  if (!await chrome.permissions.contains({ origins: [`${provider.origin}/*`] })) throw machineError("MT_PERMISSION");
  const target = browserLanguage(input?.targetLanguage || "zh");
  if (!target) throw machineError("MT_LANGUAGE");
  const source = target === "en" ? "zh" : "en";
  const text = source === "en" ? "This is a translation connection test." : "这是一条翻译连接测试。";
  const settings = { version: 2, mode: "free-online", routing: input.routing || "fixed", providerId: input.providerId, sourceLanguage: source };
  const config = resolveMachineTranslation({ machineTranslation: settings, targetLanguage: target });
  const requestId = String(input.requestId || "");
  if (!/^[a-zA-Z0-9._:-]{1,120}$/u.test(requestId)) throw machineError("MT_INPUT");
  const start = performance.now();
  const translated = await runTranslationRequest({ requestId, segments: [{ id: "connection-test", text }], config });
  return { providerId: translated[0].providerId || config.provider, sourceLanguage: source, targetLanguage: target, sampleText: text,
    translatedText: translated[0].text, checkedAt: Date.now(), elapsedMs: Math.round(performance.now() - start) };
}

export const MACHINE_SETTING_MESSAGES = Object.freeze([BACKGROUND_MESSAGES.MACHINE_TRANSLATION_GET, BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE, BACKGROUND_MESSAGES.MACHINE_TRANSLATION_TEST]);
export function handleMachineSettingsMessage(message, sender) {
  assertTranslationUiSender(sender);
  if (message.type === BACKGROUND_MESSAGES.MACHINE_TRANSLATION_GET) return readMachineTranslationSettings(message.pageUrl);
  if (message.type === BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE) return saveMachineTranslationSettings(message);
  return testMachineTranslationSettings(message);
}

export function assertTranslationUiSender(sender) {
  const actual = String(sender?.url || "");
  if (sender?.id !== chrome.runtime.id || ![EXTENSION_PAGES.options, "popup.html"].some(path => { const url = chrome.runtime.getURL(path); return actual === url || actual.startsWith(url + "#"); })) {
    throw Object.assign(new Error("Translation settings require a trusted extension page."), { code: "MT_PERMISSION" });
  }
}

