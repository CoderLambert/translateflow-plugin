import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "../../shared/constants.js";
import { cacheError } from "../../shared/cache/identity.js";
import { isCachePersistenceError } from "../../shared/cache/persistence-errors.js";
import { readingTranslationResult } from "../selection/reading-result.js";
import { clearAllCache, clearPageCache, getCacheStats, getPageCacheStatus, lookupTranslations, pruneCache, storeTranslations } from "../cache-db.js";
import { getConfig } from "../config.js";
import { translationConfig } from "../browser-translation.js";
import { lookupMachinePlan, storeMachinePlan } from "./machine-translation-plan.js";
import { createEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot, machineRouteSnapshot, fenceMachineRouteWrites } from "../effective-config-snapshots.js";

// Business message adapter; the generic service and storage remain independent.
export async function handleCacheMessage(message, sender = null) {
  switch (message.type) {
    case BACKGROUND_MESSAGES.CACHE_LOOKUP: {
      const snapshot = message.configSnapshotId
        ? { id: message.configSnapshotId, config: await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl, sender) }
        : await createEffectiveConfigSnapshot(message.pageUrl, message.browserTranslation, sender);
      const config = snapshot.config;
      let result;
      try {
        const plan = await machineRouteSnapshot(snapshot.id, message.pageUrl, sender);
        result = plan ? await lookupMachinePlan(plan, message.segments) : await lookupTranslations({
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
      return { ...result, ...(config.engine === "machine-translation" ? { provider: result.hits[0]?.providerId || (config.routing === "auto" ? "" : config.provider) } : {}),
        engine: config.engine || "ai", sourceLanguage: config.sourceLanguage || "", targetLanguage: config.targetLanguage,
        configSnapshotId: snapshot.id, configRevision: snapshot.revision, readingResult: config.routing === "auto" ? result.hits[0]?.readingResult : await readingTranslationResult(config) };
    }
    case BACKGROUND_MESSAGES.CACHE_STORE: {
      const config = await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl, sender);
      if (config.preferenceSurface === "subtitle" && config.engine === "browser-translator" && (await getConfig()).browserTranslationEnabled === false) throw Object.assign(new Error("Browser translation is disabled."), { code: "BROWSER_DISABLED" });
      try {
        const plan = await machineRouteSnapshot(message.configSnapshotId, message.pageUrl, sender);
        const result = plan ? await storeMachinePlan(plan, message) : await storeTranslations({
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
    case BACKGROUND_MESSAGES.CACHE_PAGE_STATUS: {
      const config = await translationConfig(message.pageUrl);
      if (config.routing !== "auto") return getPageCacheStatus({ pageUrl: message.pageUrl, config });
      const statuses = await Promise.all(config.routeCandidates.map(candidate => getPageCacheStatus({ pageUrl: message.pageUrl, config: candidate })));
      return { ...statuses[0], count: statuses.reduce((sum, status) => sum + status.count, 0) };
    }
    case BACKGROUND_MESSAGES.CACHE_CLEAR_PAGE:
      if (typeof message.pageUrl !== "string" || !message.pageUrl.trim()) throw cacheError("CACHE_INVALID_INPUT");
      fenceMachineRouteWrites(message.pageUrl);
      return clearAndNotify(message.pageUrl);
    case BACKGROUND_MESSAGES.CACHE_CLEAR_ALL:
      fenceMachineRouteWrites();
      return clearAndNotify(undefined, true);
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

async function clearAndNotify(pageUrl, all = false) {
  const result = all ? await clearAllCache() : await clearPageCache({ pageUrl });
  // Notification failures cannot turn a committed clear into a reported storage failure.
  try {
    const tabs = await globalThis.chrome?.tabs?.query({});
    await Promise.allSettled((tabs || []).filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.sendMessage(tab.id, {
      type: BACKGROUND_MESSAGES.CACHE_INVALIDATED, ...(all ? {} : { pageUrl })
    })));
  } catch { /* a tab may close while cache removal completes */ }
  return result;
}
