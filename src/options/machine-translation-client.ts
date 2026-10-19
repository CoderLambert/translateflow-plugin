import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { DEFAULT_MACHINE_TRANSLATION, machineProvider, normalizeMachineTranslation } from "../shared/machine-translation.js";
import type { I18n, MessageKey } from "../i18n/index.js";

export type MachineSettings = { version: 1; mode: "legacy" | "free-online"; providerId: string; sourceLanguage: string };
export type MachineState = { config: MachineSettings; selected: MachineSettings | null; siteOverride: boolean; targetLanguage: string; errorCode: string };
export type MachineTestResult = { providerId: string; sourceLanguage: string; targetLanguage: string; sampleText: string; translatedText: string; checkedAt: number; elapsedMs: number };
export const initialMachineSettings = (): MachineSettings => ({ ...DEFAULT_MACHINE_TRANSLATION } as MachineSettings);

export function machineErrorText(error: unknown, i18n: I18n) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return i18n.t(code === "CANCELLED" ? "mt.cancelled" : /^MT_(CONFIG|LANGUAGE|STRUCTURE|PERMISSION|INPUT|BUSY|RATE_LIMIT|BLOCKED|HTTP|TIMEOUT|NETWORK|RESPONSE|CONSENT)$/u.test(code) ? `mt.error.${code}` as MessageKey : "mt.error.unknown");
}

// Trusted Options/Popup client only. No network, storage ownership or AI fallback here.
export function machineTranslationClient(api: typeof chrome = chrome) {
  async function send<T>(message: object): Promise<T> {
    const result = await api.runtime.sendMessage(message) as { ok?: boolean; errorCode?: string };
    if (!result?.ok) throw Object.assign(new Error("Machine translation request failed"), { code: result?.errorCode || "MT_CONFIG" });
    return result as T;
  }
  function grant(config: MachineSettings) {
    if (config.mode !== "free-online") return Promise.resolve(true);
    const provider = machineProvider(config.providerId);
    // Called synchronously from a user event so optional permission keeps its gesture.
    return api.permissions.request({ origins: [`${provider.origin}/*`] });
  }
  return {
    read: (pageUrl = "") => send<MachineState>({ type: BACKGROUND_MESSAGES.MACHINE_TRANSLATION_GET, pageUrl }),
    async save(config: MachineSettings, consent: boolean, scope: "global" | "site", pageUrl = "") {
      normalizeMachineTranslation(config);
      if (config.mode === "free-online" && !consent) throw Object.assign(new Error("Consent required"), { code: "MT_CONSENT" });
      if (!await grant(config)) throw Object.assign(new Error("Permission required"), { code: "MT_PERMISSION" });
      return send<MachineState>({ type: BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE, scope, pageUrl, config, consent });
    },
    inherit: (pageUrl: string) => send<MachineState>({ type: BACKGROUND_MESSAGES.MACHINE_TRANSLATION_SAVE, scope: "site", pageUrl, inherit: true }),
    async test(config: MachineSettings, consent: boolean, requestId: string, targetLanguage: string) {
      if (!consent) throw Object.assign(new Error("Consent required"), { code: "MT_CONSENT" });
      if (!await grant({ ...config, mode: "free-online" })) throw Object.assign(new Error("Permission required"), { code: "MT_PERMISSION" });
      return send<MachineTestResult>({ type: BACKGROUND_MESSAGES.MACHINE_TRANSLATION_TEST, providerId: config.providerId, requestId, targetLanguage, consent });
    },
    cancel: (requestId: string) => send<{ cancelled: boolean }>({ type: BACKGROUND_MESSAGES.CANCEL_TRANSLATION, requestId }),
    async activePage() {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:/u.test(tab.url)) throw Object.assign(new Error("Unsupported page"), { code: "MT_INPUT" });
      return tab.url;
    }
  };
}
