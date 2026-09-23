import { ensureConfigDefaults, removeLegacyV1Cache } from "./config.js";
import { registerMessageRouter } from "./router.js";
import { syncAutoSiteRegistrations } from "./auto-sites.js";

export function initializeBackground() {
  registerMessageRouter();

  chrome.runtime.onInstalled.addListener(async ({ reason }) => {
    await ensureConfigDefaults();
    if (reason === "update" || reason === "install") await removeLegacyV1Cache();
    await syncAutoSiteRegistrations();
  });

  chrome.runtime.onStartup.addListener(() => {
    syncAutoSiteRegistrations().catch(() => {});
  });
}
