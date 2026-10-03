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

async function initializePersistentSites(attempt = 0) {
  try {
    await ensureConfigDefaults();
    await syncSiteRegistrations();
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    return initializePersistentSites(attempt + 1);
  }
}

export async function initializeBackground() {
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

  // Developer reloads and some service-worker restarts do not emit an
  // install/startup event. Returning this promise keeps module initialization
  // alive until defaults and persistent registrations are reconciled.
  await initializePersistentSites();
}
