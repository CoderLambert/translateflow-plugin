import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "../../shared/constants.js";
import { isCachePersistenceError } from "../../shared/cache/persistence-errors.js";
import { readingTranslationResult } from "../selection/reading-result.js";
import { clearAllCache, clearPageCache, getCacheStats, getPageCacheStatus, lookupTranslations, pruneCache, storeTranslations } from "../cache-db.js";
import { getConfig, getEffectiveConfig } from "../config.js";
import { createEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot } from "../effective-config-snapshots.js";

// Business message adapter; the generic service and storage remain independent.
export async function handleCacheMessage(message) {
  switch (message.type) {
    case BACKGROUND_MESSAGES.CACHE_LOOKUP: {
      const snapshot = message.configSnapshotId
        ? { id: message.configSnapshotId, config: await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl) }
        : await createEffectiveConfigSnapshot(message.pageUrl, message.browserTranslation);
      const config = snapshot.config;
      let result;
      try {
        result = await lookupTranslations({
          pageUrl: message.pageUrl,
          segments: message.segments,
          config
        });
      } catch (error) {
        if (!isCachePersistenceError(error)) throw error;
        // Keep the pinned Provider config available for an explicit translation.
        // cacheOnly remains read-only; missing tokens disallow persistent writes.
        result = { hits: [], writeTokens: [], cacheWarning: error.code };
      }
      return { ...result, engine: config.engine || "ai", sourceLanguage: config.sourceLanguage || "", targetLanguage: config.targetLanguage, configSnapshotId: snapshot.id, readingResult: await readingTranslationResult(config) };
    }
    case BACKGROUND_MESSAGES.CACHE_STORE: {
      const config = await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl);
      if (config.engine === "browser-translator" && (await getConfig()).browserTranslationEnabled === false) throw Object.assign(new Error("Browser translation is disabled."), { code: "BROWSER_DISABLED" });
      try {
        const result = await storeTranslations({
          pageUrl: message.pageUrl,
          pageTitle: message.pageTitle,
          items: message.items,
          config
        });
        // A failed/invalidated persistence fence does not invalidate an already
        // verified translation. However, invalid input and stale config errors
        // must continue to fail closed.
        return { ...result, ...(result.skipped ? { cacheWarning: "CACHE_INVALIDATED" } : {}) };
      } catch (error) {
        if (!isCachePersistenceError(error)) throw error;
        return { stored: 0, cacheWarning: error.code };
      }
    }
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
    default:
      throw new Error("Unknown cache message");
  }
}
