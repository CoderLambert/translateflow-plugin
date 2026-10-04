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

export function initializeBackground() {
  registerMessageRouter();
  registerCommandRouter();
  chrome.runtime.onConnect.addListener(port => { if (!handleReadingPort(port)) handleSelectionAssistantStreamPort(port); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { onReadingTabUpdated(tabId, changeInfo); if (changeInfo?.status === "loading" || Object.hasOwn(changeInfo || {}, "url")) abortSelectionAssistantStreams(tabId); });
  chrome.tabs.onRemoved.addListener(tabId => { onReadingTabRemoved(tabId); abortSelectionAssistantStreams(tabId); });
  chrome.permissions.onRemoved.addListener(() => { onReadingPermissionsRemoved(); abortSelectionAssistantStreams(); });

  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await ensureConfigDefaults();
    if (reason === "update" || reason === "install") await removeLegacyV1Cache();
    await syncSiteRegistrations();
  });

  chrome.runtime.onStartup.addListener(() => {
    syncSiteRegistrations().catch(() => {});
  });
}
