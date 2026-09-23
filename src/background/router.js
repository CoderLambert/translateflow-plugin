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
  saveSitePreset
} from "./config.js";
import { registerAutoSite, unregisterAutoSite } from "./auto-sites.js";
import { setTemporaryPresetOverride } from "./preset-session.js";
import { testProvider } from "./providers/index.js";
import {
  cancelTranslationRequest,
  runTranslationRequest
} from "./translation-requests.js";

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleBackgroundMessage(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error),
        errorCode: error?.code || ""
      }));
    return true;
  });
}

export async function handleBackgroundMessage(message) {
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
    case BACKGROUND_MESSAGES.AUTO_SITE_REGISTER:
      return registerAutoSite(message.origin);
    case BACKGROUND_MESSAGES.AUTO_SITE_UNREGISTER:
      return unregisterAutoSite(message.origin);
    case BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT:
      return { context: await getEffectiveContext(message.pageUrl) };
    case BACKGROUND_MESSAGES.TEMP_PRESET_SET:
      await setTemporaryPresetOverride(message.pageUrl, message.preset);
      return { context: await getEffectiveContext(message.pageUrl) };
    case BACKGROUND_MESSAGES.SITE_PRESET_SAVE:
      return { context: await saveSitePreset(message.pageUrl, message.preset) };
    default:
      throw new Error("未知扩展消息。");
  }
}
