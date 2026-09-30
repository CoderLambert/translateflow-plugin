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
import { getBundledLexiconStatus, runLexicalLookup } from "./lexical/index.js";
import { resolveSelectionRequest } from "./selection/resolve.js";
import {
  cancelSelectionExplanationRequest,
  runSelectionExplanationRequest
} from "./selection/explain.js";
import {
  cancelDictionaryPackOperation,
  cancelRichMdictImport,
  abortRichMdictImport,
  commitRichMdictImport,
  getDictionaryPackStatus,
  listRichMdictDictionaries,
  listRichMdictViewerDictionaries,
  updateRichMdictPreferences,
  reorderRichMdictDictionaries,
  preflightRichMddResourceImport,
  commitRichMddResourceImport,
  cancelRichMddResourceImport,
  abortRichMddResourceImport,
  lookupRichMddResource,
  lookupRichMdictDictionaries,
  preflightRichMdictImport,
  importLocalDictionaryTflexFromQuarantine,
  installDictionaryPack,
  rollbackDictionaryPack,
  uninstallRichMdictDictionary,
  uninstallDictionaryPack
} from "./packs/api.js";

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
    case BACKGROUND_MESSAGES.CANCEL_TRANSLATION: {
      const translation = cancelTranslationRequest(message.requestId);
      const explanation = cancelSelectionExplanationRequest(message.requestId);
      return { cancelled: Boolean(translation.cancelled || explanation.cancelled) };
    }
    case BACKGROUND_MESSAGES.TEST_API: {
      const config = await getEffectiveConfig(message.pageUrl || "");
      return { result: await testProvider(config) };
    }
    case BACKGROUND_MESSAGES.SELECTION_RESOLVE:
      return resolveSelectionRequest({
        text: message.text,
        pageUrl: message.pageUrl || "",
        context: message.context || null,
        depth: message.depth
      });
    case BACKGROUND_MESSAGES.SELECTION_EXPLAIN:
      return runSelectionExplanationRequest({
        requestId: message.requestId,
        text: message.text,
        pageUrl: message.pageUrl || "",
        context: message.context || null,
        depth: message.depth
      });
    case BACKGROUND_MESSAGES.LEXICAL_LOOKUP:
      return runLexicalLookup({
        text: message.text,
        pageUrl: message.pageUrl || "",
        sourceLanguage: message.sourceLanguage || "en",
        targetLanguage: message.targetLanguage || "zh-CN"
      });
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
    case BACKGROUND_MESSAGES.BUNDLED_LEXICON_STATUS:
      return getBundledLexiconStatus();
    case BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS:
      assertOptionsSender(sender);
      return getDictionaryPackStatus({ recover: true });
    case BACKGROUND_MESSAGES.DICTIONARY_PACK_INSTALL:
      assertOptionsSender(sender);
      return installDictionaryPack({
        sourceId: message.sourceId,
        packId: message.packId,
        requestId: message.requestId
      });
    case BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT:
      assertOptionsSender(sender);
      return importLocalDictionaryTflexFromQuarantine({
        token: message.token,
        requestId: message.requestId,
        displayMetadata: message.displayMetadata
      });
    case BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL:
      assertOptionsSender(sender);
      return cancelDictionaryPackOperation(message.requestId);
    case BACKGROUND_MESSAGES.DICTIONARY_PACK_UNINSTALL:
      assertOptionsSender(sender);
      return uninstallDictionaryPack(message.packId);
    case BACKGROUND_MESSAGES.DICTIONARY_PACK_ROLLBACK:
      assertOptionsSender(sender);
      return rollbackDictionaryPack(message.packId);
    case BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_PREFLIGHT:
      assertOptionsSender(sender);
      await preflightRichMdictImport(Number(message.sourceBytes), {
        requestId: message.requestId,
        packId: message.packId,
        packVersion: message.packVersion,
        catalogReplacement: message.catalogReplacement
      });
      return { ready: true };
    case BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_COMMIT:
      assertOptionsSender(sender);
      return commitRichMdictImport({
        requestId: message.requestId,
        packId: message.packId,
        packVersion: message.packVersion,
        metadata: message.metadata,
        catalogReplacement: message.catalogReplacement
      });
    case BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_CANCEL:
      assertOptionsSender(sender);
      return cancelRichMdictImport(message.requestId);
    case BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_ABORT:
      assertOptionsSender(sender);
      return abortRichMdictImport({
        packId: message.packId,
        packVersion: message.packVersion
      });
    case BACKGROUND_MESSAGES.RICH_MDICT_LIST:
      assertOptionsSender(sender);
      return listRichMdictDictionaries();
    case BACKGROUND_MESSAGES.RICH_MDICT_VIEWER_LIST:
      assertSelectionContentSender(sender);
      return listRichMdictViewerDictionaries();
    case BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_UPDATE:
      assertOptionsSender(sender);
      return updateRichMdictPreferences(message.dictionaryId, message.preferences);
    case BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_REORDER:
      assertOptionsSender(sender);
      return reorderRichMdictDictionaries(message.dictionaryIds);
    case BACKGROUND_MESSAGES.RICH_MDICT_LOOKUP:
      if (message.dictionaryId !== undefined) {
        assertSelectionContentSender(sender);
        return lookupRichMdictDictionaries({
          text: message.text,
          dictionaryId: message.dictionaryId
        });
      }
      return lookupRichMdictDictionaries(message.text);
    case BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL:
      assertOptionsSender(sender);
      {
        const result = await uninstallRichMdictDictionary(message.packId);
        if (result.uninstalled) {
          await notifyRichMddResourcesChanged(message.packId);
        }
        return result;
      }
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_PREFLIGHT:
      assertOptionsSender(sender);
      return preflightRichMddResourceImport({
        dictionaryId: message.dictionaryId,
        requestId: message.requestId,
        resourceVersion: message.resourceVersion,
        mdxFileName: message.mdxFileName,
        files: message.files
      });
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_COMMIT:
      assertOptionsSender(sender);
      {
        const result = await commitRichMddResourceImport({
          dictionaryId: message.dictionaryId,
          requestId: message.requestId,
          resourceVersion: message.resourceVersion,
          metadata: message.metadata
        });
        await notifyRichMddResourcesChanged(message.dictionaryId);
        return result;
      }
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_CANCEL:
      assertOptionsSender(sender);
      return cancelRichMddResourceImport(message.requestId);
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_ABORT:
      assertOptionsSender(sender);
      return abortRichMddResourceImport({
        dictionaryId: message.dictionaryId,
        requestId: message.requestId,
        resourceVersion: message.resourceVersion
      });
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE:
      return lookupRichMddResource({ dictionaryId: message.dictionaryId, path: message.path });
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCES_CHANGED:
      return { notified: true };
    default:
      throw new Error("未知扩展消息。");
  }
}

async function notifyRichMddResourcesChanged(dictionaryId) {
  const tabsApi = globalThis.chrome?.tabs;
  if (typeof tabsApi?.query !== "function" || typeof tabsApi?.sendMessage !== "function") return;
  let tabs;
  try { tabs = await tabsApi.query({}); } catch { return; }
  await Promise.all((Array.isArray(tabs) ? tabs : []).map(async (tab) => {
    if (!Number.isInteger(tab?.id)) return;
    try {
      await tabsApi.sendMessage(tab.id, {
        type: BACKGROUND_MESSAGES.RICH_MDD_RESOURCES_CHANGED,
        dictionaryId: String(dictionaryId || "")
      });
    } catch {
      // Tabs without a TranslateFlow content script do not have a viewer session.
    }
  }));
}

function assertOptionsSender(sender) {
  const expected = chrome.runtime.getURL("options.html");
  const actual = String(sender?.url || "");
  if (actual !== expected && !actual.startsWith(expected + "#")) {
    const error = new Error("Dictionary pack lifecycle actions are only available from Settings.");
    error.code = "PACK_SETTINGS_ONLY";
    throw error;
  }
}

function assertSelectionContentSender(sender) {
  let pageUrl;
  try {
    pageUrl = new URL(String(sender?.url || ""));
  } catch {
    pageUrl = null;
  }
  const extensionId = globalThis.chrome?.runtime?.id;
  if (
    !extensionId ||
    sender?.id !== extensionId ||
    !Number.isInteger(sender?.tab?.id) ||
    !pageUrl ||
    !["http:", "https:"].includes(pageUrl.protocol)
  ) {
    const error = new Error("Rich dictionary viewer messages are only available to TranslateFlow page content.");
    error.code = "RICH_MDICT_CONTENT_ONLY";
    throw error;
  }
}
