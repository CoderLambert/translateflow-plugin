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

export function initializeBackground() {
  registerMessageRouter();
  registerCommandRouter();
  chrome.runtime.onConnect.addListener(handleReadingPort);
  chrome.tabs.onUpdated.addListener(onReadingTabUpdated);
  chrome.tabs.onRemoved.addListener(onReadingTabRemoved);
  chrome.permissions.onRemoved.addListener(onReadingPermissionsRemoved);

  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await ensureConfigDefaults();
    if (reason === "update" || reason === "install") await removeLegacyV1Cache();
    await syncSiteRegistrations();
  });

  chrome.runtime.onStartup.addListener(() => {
    syncSiteRegistrations().catch(() => {});
  });
}
