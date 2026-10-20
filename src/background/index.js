import { cancelMachineTranslations, cancelTextTranslations } from "./translation-requests.js";
import { invalidateTranslationSnapshots, invalidateMachineSnapshots } from "./effective-config-snapshots.js";
import { abortMachineHttp } from "./providers/machine-translation-transport.js";
import { ensureConfigDefaults, removeLegacyV1Cache } from "./config.js";
import { createBrowserNativeBroker } from "./browser-native-broker.js";
import { registerMessageRouter } from "./router.js";
import { registerCommandRouter } from "./commands.js";
import { syncSiteRegistrations } from "./auto-sites.js";
import {
  handleReadingPort,
  onReadingPermissionsRemoved,
  onReadingTabRemoved,
  onReadingTabUpdated
} from "./reading-record/runtime.js";
import { abortSelectionAssistantStreams, handleSelectionAssistantStreamPort, onSelectionAssistantTabUpdated } from "./selection/assistant-stream.js";
import { ensureProviderConnections } from "./provider-connections.js";
import { BACKGROUND_MESSAGES } from "../shared/constants.js";

const PUBLIC_SETTING_KEYS = new Set(["translationPreferences", "browserTranslationEnabled", "browserSourceLanguage", "dictionaryEnabled", "cacheRestoreSites", "autoSites", "quickControlSites", "quickControlHiddenSites", "youtubeSubtitleMode", "youtubeSubtitleSize", "uiLocale", "appearance", "siteProfiles"]);
const PUBLIC_SETTING_SIGNALS = new Set(["machineTranslation", "aiServiceConfigured", "provider", "model", "prompt", "targetLanguage", "openAICompatible", "apiKey", "providerConnections", "providerCredentials", "defaultService", "glossary", "siteGlossaries"]);

export function initializeBackground() {
  Promise.resolve(chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {});
  registerMessageRouter();
  registerCommandRouter();
  const nativeBroker = createBrowserNativeBroker(chrome);
  chrome.runtime.onConnect.addListener(port => { if (!nativeBroker.connect(port) && !handleReadingPort(port)) handleSelectionAssistantStreamPort(port); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    onReadingTabUpdated(tabId, changeInfo);
    onSelectionAssistantTabUpdated(tabId, changeInfo);
    if (changeInfo?.status === "loading" || Object.hasOwn(changeInfo || {}, "url")) {
      invalidateMachineSnapshots(tabId);
      cancelMachineTranslations(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    onReadingTabRemoved(tabId); abortSelectionAssistantStreams(tabId);
    invalidateMachineSnapshots(tabId); cancelMachineTranslations(tabId);
  });
  chrome.permissions.onRemoved.addListener(() => {
    onReadingPermissionsRemoved(); abortSelectionAssistantStreams();
    cancelMachineTranslations(); invalidateMachineSnapshots(); abortMachineHttp();
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (["translationPreferences", "machineTranslation", "machineTranslationConsent", "siteProfiles", "targetLanguage", "browserSourceLanguage", "provider", "model", "chatgptPlanModel", "apiKey", "openAICompatible", "providerConnections", "providerCredentials", "defaultService", "prompt", "glossary", "siteGlossaries"].some(key => changes[key])) { cancelTextTranslations(); invalidateTranslationSnapshots(); }
    if (changes.siteProfiles || changes.targetLanguage) { cancelMachineTranslations(); invalidateMachineSnapshots(); }
    const publicChanges = Object.fromEntries(Object.entries(changes).filter(([key]) => PUBLIC_SETTING_KEYS.has(key) || PUBLIC_SETTING_SIGNALS.has(key))
      .map(([key, change]) => [key, PUBLIC_SETTING_KEYS.has(key) ? change : { changed: true }]));
    if (!Object.keys(publicChanges).length) return;
    chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.sendMessage(tab.id, {
      type: BACKGROUND_MESSAGES.PUBLIC_SETTINGS_CHANGED,
      changes: publicChanges
    })))).catch(() => {});
  });

  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await ensureConfigDefaults();
    if (reason === "update" || reason === "install") await removeLegacyV1Cache();
    await syncSiteRegistrations();
  });

  chrome.runtime.onStartup.addListener(() => {
    Promise.allSettled([ensureProviderConnections(), syncSiteRegistrations()]).catch(() => {});
  });
}
