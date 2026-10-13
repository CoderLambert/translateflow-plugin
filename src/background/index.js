import { ensureConfigDefaults, removeLegacyV1Cache } from "./config.js";
import { registerMessageRouter } from "./router.js";
import { registerCommandRouter } from "./commands.js";
import { syncSiteRegistrations } from "./auto-sites.js";
import {
  handleReadingPort,
  onReadingPermissionsRemoved,
  onReadingTabRemoved,
  onReadingTabUpdated
} from "./reading-record/runtime.js";
import { abortSelectionAssistantStreams, handleSelectionAssistantStreamPort } from "./selection/assistant-stream.js";
import { ensureProviderConnections } from "./provider-connections.js";
import { BACKGROUND_MESSAGES } from "../shared/constants.js";

const PUBLIC_SETTING_KEYS = new Set(["cacheRestoreSites", "autoSites", "quickControlSites", "quickControlHiddenSites", "youtubeSubtitleMode", "youtubeSubtitleSize", "uiLocale", "appearance", "siteProfiles"]);
const PUBLIC_SETTING_SIGNALS = new Set(["provider", "model", "prompt", "targetLanguage", "openAICompatible", "apiKey", "providerConnections", "providerCredentials", "defaultService", "glossary", "siteGlossaries"]);

export function initializeBackground() {
  Promise.resolve(chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {});
  registerMessageRouter();
  registerCommandRouter();
  chrome.runtime.onConnect.addListener(port => { if (!handleReadingPort(port)) handleSelectionAssistantStreamPort(port); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { onReadingTabUpdated(tabId, changeInfo); if (changeInfo?.status === "loading" || Object.hasOwn(changeInfo || {}, "url")) abortSelectionAssistantStreams(tabId); });
  chrome.tabs.onRemoved.addListener(tabId => { onReadingTabRemoved(tabId); abortSelectionAssistantStreams(tabId); });
  chrome.permissions.onRemoved.addListener(() => { onReadingPermissionsRemoved(); abortSelectionAssistantStreams(); });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
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
