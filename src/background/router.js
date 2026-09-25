import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "../shared/constants.js";
import {
  clearAllCache,
  clearPageCache,
  getCacheStats,
  getPageCacheStatus,
  lookupTranslations,
  pruneCache,
  storeTranslations
} from "./cache-db.js";
import {
  getConfig,
  getEffectiveConfig,
  getEffectiveContext,
  saveSiteAppearance,
  saveSitePreset
} from "./config.js";
import {
  hideQuickControlSite,
  registerAutoSite,
  registerCacheRestoreSite,
  registerQuickControlSite,
  showQuickControlSite,
  unregisterAutoSite,
  unregisterCacheRestoreSite,
  unregisterQuickControlSite
} from "./auto-sites.js";
import { setTemporaryPresetOverride } from "./preset-session.js";
import { testProvider } from "./providers/index.js";
import {
  cancelTranslationRequest,
  runTranslationRequest
} from "./translation-requests.js";
import { runSubtitleTranslationBatch } from "./subtitle-requests.js";
import { installYouTubeMainBridge } from "./youtube-bridge.js";

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleBackgroundMessage(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error),
        errorCode: error?.code || ""
      }));
    return true;
  });
}

export async function handleBackgroundMessage(message, sender) {
  switch (message?.type) {
    case BACKGROUND_MESSAGES.TRANSLATE_BATCH: {
      const config = await getEffectiveConfig(message.pageUrl);
      return {
        translations: await runTranslationRequest({
          requestId: message.requestId,
          segments: message.segments,
          config
        })
      };
    }
    case BACKGROUND_MESSAGES.SUBTITLE_TRANSLATE_BATCH:
      return runSubtitleTranslationBatch({
        requestId: message.requestId,
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        units: message.units
      });
    case BACKGROUND_MESSAGES.CANCEL_TRANSLATION:
      return cancelTranslationRequest(message.requestId);
    case BACKGROUND_MESSAGES.TEST_API: {
      const config = await getEffectiveConfig(message.pageUrl || "");
      return { result: await testProvider(config) };
    }
    case BACKGROUND_MESSAGES.CACHE_LOOKUP:
      return lookupTranslations({
        pageUrl: message.pageUrl,
        segments: message.segments,
        config: await getEffectiveConfig(message.pageUrl)
      });
    case BACKGROUND_MESSAGES.CACHE_STORE:
      return storeTranslations({
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        items: message.items,
        config: await getEffectiveConfig(message.pageUrl)
      });
    case BACKGROUND_MESSAGES.CACHE_PAGE_STATUS:
      return getPageCacheStatus({
        pageUrl: message.pageUrl,
        config: await getEffectiveConfig(message.pageUrl)
      });
    case BACKGROUND_MESSAGES.CACHE_CLEAR_PAGE:
      return clearPageCache({ pageUrl: message.pageUrl });
    case BACKGROUND_MESSAGES.CACHE_CLEAR_ALL:
      return clearAllCache();
    case BACKGROUND_MESSAGES.CACHE_STATS:
      return getCacheStats();
    case BACKGROUND_MESSAGES.CACHE_PRUNE: {
      const { cacheMaxMB } = await getConfig();
      return pruneCache(Number(cacheMaxMB || DEFAULT_CONFIG.cacheMaxMB) * 1024 * 1024);
    }
    case BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_REGISTER:
      return registerCacheRestoreSite(message.origin);
    case BACKGROUND_MESSAGES.CACHE_RESTORE_SITE_UNREGISTER:
      return unregisterCacheRestoreSite(message.origin);
    case BACKGROUND_MESSAGES.AUTO_SITE_REGISTER:
      return registerAutoSite(message.origin);
    case BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER:
      return unregisterAutoSite(message.origin);
    case BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_REGISTER:
      return registerQuickControlSite(message.origin);
    case BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_UNREGISTER:
      return unregisterQuickControlSite(message.origin);
    case BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_HIDE:
      return hideQuickControlSite(message.origin);
    case BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_SHOW:
      return showQuickControlSite(message.origin);
    case BACKGROUND_MESSAGES.SITE_APPEARANCE_SAVE:
      return { context: await saveSiteAppearance(message.pageUrl, message.appearance) };
    case BACKGROUND_MESSAGES.OPEN_OPTIONS:
      await chrome.runtime.openOptionsPage();
      return { opened: true };
    case BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT:
      return { context: await getEffectiveContext(message.pageUrl) };
    case BACKGROUND_MESSAGES.TEMP_PRESET_SET:
      await setTemporaryPresetOverride(message.pageUrl, message.preset);
      return { context: await getEffectiveContext(message.pageUrl) };
    case BACKGROUND_MESSAGES.SITE_PRESET_SAVE:
      return { context: await saveSitePreset(message.pageUrl, message.preset) };
    case BACKGROUND_MESSAGES.YOUTUBE_BRIDGE_INSTALL:
      return installYouTubeMainBridge(sender);
    default:
      throw new Error("未知扩展消息。");
  }
}
