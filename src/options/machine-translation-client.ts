import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { DEFAULT_MACHINE_TRANSLATION, MACHINE_AUTO_PROVIDERS, machineProvider, normalizeMachineTranslation } from "../shared/machine-translation.js";
import type { I18n, MessageKey } from "../i18n/index.js";

export type TranslationPreferences = { version: 1; textMethod: "ai" | "browser-local" | "free-online"; wordMethod: "ai" | "browser-local" | "free-online" | "dictionary" };
export type MachineSettings = { method?: TranslationPreferences["textMethod"]; version: 2; routing: "auto" | "fixed"; mode: "legacy" | "free-online"; providerId: string; sourceLanguage: string };
export type MachineState = { preferences: TranslationPreferences; consent: boolean; globalConsent: boolean; availability: { ai: boolean; browser: boolean; dictionary?: boolean }; aiPermission?: string; config: MachineSettings; selected: MachineSettings | null; siteOverride: boolean; targetLanguage: string; errorCode: string; health?: { providerId: string; until: number; code?: string }[] };
export type MachineTestResult = { providerId: string; sourceLanguage: string; targetLanguage: string; sampleText: string; translatedText: string; checkedAt: number; elapsedMs: number };
export const initialMachineSettings = (): MachineSettings => ({ ...DEFAULT_MACHINE_TRANSLATION, method: "free-online" } as MachineSettings);

export function machineErrorText(error: unknown, i18n: I18n) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return i18n.t(["PREFERENCES_REOPEN", "PREFERENCES_CONFIG", "AI_REQUIRED"].includes(code) ? `mt.error.${code}` as MessageKey : code === "CANCELLED" ? "mt.cancelled" : /^MT_(CONFIG|LANGUAGE|STRUCTURE|PERMISSION|INPUT|BUSY|RATE_LIMIT|BLOCKED|HTTP|TIMEOUT|NETWORK|RESPONSE|CONSENT)$/u.test(code) ? `mt.error.${code}` as MessageKey : "mt.error.unknown");
}

// Trusted Options/Popup client only. No network, storage ownership or AI fallback here.
export function machineTranslationClient(api: typeof chrome = chrome) {
  let lastState: MachineState | null = null;
  async function send<T>(message: object): Promise<T> {
    const result = await api.runtime.sendMessage(message) as { ok?: boolean; errorCode?: string };
    if (!result?.ok) throw Object.assign(new Error("Machine translation request failed"), { code: result?.errorCode || "MT_CONFIG" });
    if ("preferences" in result) lastState = result as unknown as MachineState;
    return result as T;
  }
  function grant(config: MachineSettings, preferences?: TranslationPreferences) {
    const online = config.method === "free-online" || preferences?.wordMethod === "free-online";
    const providers = online ? (config.routing === "auto" ? MACHINE_AUTO_PROVIDERS : [config.providerId]).map(machineProvider) : [];
    const origins = providers.map(provider => `${provider.origin}/*`);
    if ((config.method === "ai" || preferences?.wordMethod === "ai") && lastState?.aiPermission) origins.push(lastState.aiPermission);
    if (!origins.length) return Promise.resolve(true);
    // Called synchronously from a user event so optional permission keeps its gesture.
    return api.permissions.request({ origins });
  }
  return {
    read: (pageUrl = "") => send<MachineState>({ type: BACKGROUND_MESSAGES.TRANSLATION_PREFERENCES_GET, pageUrl }),
    async save(draft: MachineSettings, consent: boolean, scope: "global" | "site", pageUrl = "", preferences?: TranslationPreferences) {
      const { method, ...config } = draft;
      normalizeMachineTranslation(config);
      const online = method === "free-online" || preferences?.wordMethod === "free-online";
      if (online && !consent) throw Object.assign(new Error("Consent required"), { code: "MT_CONSENT" });
      if (!await grant(draft, preferences)) throw Object.assign(new Error("Permission required"), { code: "MT_PERMISSION" });
      return send<MachineState>({ type: BACKGROUND_MESSAGES.TRANSLATION_PREFERENCES_SAVE, scope, pageUrl, config, consent, textMethod: method, preferences });
    },
    async inherit(pageUrl: string, consent = false) {
      if (lastState?.config && consent && !await grant(lastState.config)) throw Object.assign(new Error("Permission required"), { code: "MT_PERMISSION" });
      return send<MachineState>({ type: BACKGROUND_MESSAGES.TRANSLATION_PREFERENCES_SAVE, scope: "site", pageUrl, inherit: true, consent });
    },
    async test(config: MachineSettings, consent: boolean, requestId: string, targetLanguage: string) {
      if (!consent) throw Object.assign(new Error("Consent required"), { code: "MT_CONSENT" });
      if (!await grant({ ...config, method: "free-online" })) throw Object.assign(new Error("Permission required"), { code: "MT_PERMISSION" });
      return send<MachineTestResult>({ type: BACKGROUND_MESSAGES.MACHINE_TRANSLATION_TEST, providerId: config.providerId, routing: config.routing, requestId, targetLanguage, consent });
    },
    cancel: (requestId: string) => send<{ cancelled: boolean }>({ type: BACKGROUND_MESSAGES.CANCEL_TRANSLATION, requestId }),
    async activePage() {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:/u.test(tab.url)) throw Object.assign(new Error("Unsupported page"), { code: "MT_INPUT" });
      return tab.url;
    }
  };
}
