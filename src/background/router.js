import { MACHINE_SETTING_MESSAGES, handleMachineSettingsMessage } from "./machine-translation-settings.js";
import { EXTENSION_PAGES } from "../shared/runtime-assets.js";
import { readingTranslationResult } from "./selection/reading-result.js";
import { handleReadingMessage, isReadingMessage } from "./reading-record/runtime.js";
import { BACKGROUND_MESSAGES, DEFAULT_CONFIG } from "../shared/constants.js";
import { clearAllCache, clearPageCache, getCacheStats, getPageCacheStatus, lookupTranslations, pruneCache, storeTranslations } from "./cache-db.js";
import { translationConfig, translationEngineSettings } from "./browser-translation.js";
import { getConfig, getEffectiveConfig, getEffectiveContext, saveSiteAppearance, saveSitePreset } from "./config.js";
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
import { deleteProviderConnection, listProviderConnections, setDefaultService, upsertProviderConnection } from "./provider-connections.js";
import { testSavedProviderConnection } from "./provider-connection-runtime.js";
import { readPublicSettings, writePublicSettings } from "./public-settings.js";
import { createEffectiveConfigSnapshot, resolveEffectiveConfigSnapshot } from "./effective-config-snapshots.js";
import { handleChatGPTPlanAction } from "./providers/chatgpt-plan-settings.js";
import { cancelTranslationRequest, runTranslationRequest } from "./translation-requests.js";
import { runSubtitleTranslationBatch } from "./subtitle-requests.js";
import { installYouTubeMainBridge } from "./youtube-bridge.js";
import { getBundledLexiconStatus, runLexicalLookup } from "./lexical/index.js";
import { resolveSelectionRequest } from "./selection/resolve.js";
import { handleVocabularyBookMessage } from "./vocabulary-book-router.js";
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
  promoteRichMdictDictionary,
  cancelRichMdictLookup,
  preflightRichMddResourceImport,
  commitRichMddResourceImport,
  cancelRichMddResourceImport,
  abortRichMddResourceImport,
  lookupRichMddResource,
  cancelRichMddResourceLookup,
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
    if (isReadingMessage(message)) {
      // Reading owns its protocol-v2 envelope and stable privacy-safe errors.
      // The legacy response wrapper must not reshape it or expose exceptions.
      void handleReadingMessage(message, sender).then(sendResponse);
      return true;
    }
    handleBackgroundMessage(message, sender)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error),
        errorCode: error?.code || "",
        ...(error?.modelSelectionCleared ? { modelSelectionCleared: true } : {})
      }));
    return true;
  });
}
export async function handleBackgroundMessage(message, sender) {
  if (MACHINE_SETTING_MESSAGES.includes(message?.type)) return handleMachineSettingsMessage(message, sender);
  switch (message?.type) {
    case BACKGROUND_MESSAGES.TRANSLATION_ENGINE_SETTINGS:
      return translationEngineSettings(message.pageUrl, { forceBrowser: message.forceBrowser === true, surface: message.surface });
    case BACKGROUND_MESSAGES.TRANSLATE_BATCH: {
      const config = await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl, sender);
      if (config.engine === "browser-translator") throw Object.assign(new Error("Browser translation runs in the page."), { code: "BROWSER_CONTEXT" });
      return {
        translations: await runTranslationRequest({
          requestId: message.requestId,
          pageUrl: message.pageUrl, ownerTabId: sender?.tab?.id,
          segments: message.segments,
          config
        }),
        readingResult: await readingTranslationResult(config),
        ...(config.engine === "machine-translation" ? { engine: config.engine, provider: config.provider } : {})
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
    case BACKGROUND_MESSAGES.PROVIDER_CONNECTIONS_LIST:
      assertOptionsSender(sender); return listProviderConnections();
    case BACKGROUND_MESSAGES.PROVIDER_CONNECTION_UPSERT:
      assertOptionsSender(sender); return upsertProviderConnection(message);
    case BACKGROUND_MESSAGES.PROVIDER_CONNECTION_DELETE:
      assertOptionsSender(sender); return deleteProviderConnection(message.connectionId, message.expectedRevision);
    case BACKGROUND_MESSAGES.DEFAULT_SERVICE_SET:
      assertOptionsSender(sender); return setDefaultService(message.service);
    case BACKGROUND_MESSAGES.PROVIDER_CONNECTION_TEST: {
      assertOptionsSender(sender);
      return testSavedProviderConnection(message.connectionId);
    }
    case BACKGROUND_MESSAGES.PUBLIC_SETTINGS_GET:
      return { settings: await readPublicSettings() };
    case BACKGROUND_MESSAGES.PUBLIC_SETTINGS_SET:
      return writePublicSettings(message.settings);
    case BACKGROUND_MESSAGES.CHATGPT_PLAN_ACTION:
      assertOptionsSender(sender); return handleChatGPTPlanAction(message.action, undefined, { accountId: message.accountId });
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
    case BACKGROUND_MESSAGES.CACHE_LOOKUP: {
      const snapshot = message.configSnapshotId
        ? { id: message.configSnapshotId, config: await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl, sender) }
        : await createEffectiveConfigSnapshot(message.pageUrl, message.browserTranslation, sender);
      const config = snapshot.config;
      const result = await lookupTranslations({
        pageUrl: message.pageUrl,
        segments: message.segments,
        config
      });
      return { ...result, ...(config.engine === "machine-translation" ? { provider: config.provider } : {}), engine: config.engine || "ai", sourceLanguage: config.sourceLanguage || "", targetLanguage: config.targetLanguage, configSnapshotId: snapshot.id, readingResult: await readingTranslationResult(config) };
    }
    case BACKGROUND_MESSAGES.CACHE_STORE: {
      const config = await resolveEffectiveConfigSnapshot(message.configSnapshotId, message.pageUrl, sender);
      if (config.engine === "browser-translator" && (await getConfig()).browserTranslationEnabled === false) throw Object.assign(new Error("Browser translation is disabled."), { code: "BROWSER_DISABLED" });
      const result = await storeTranslations({
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle,
        items: message.items,
        config
      });
      return result;
    }
    case BACKGROUND_MESSAGES.CACHE_PAGE_STATUS:
      return getPageCacheStatus({
        pageUrl: message.pageUrl,
        config: await translationConfig(message.pageUrl)
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
      if (["#general", "#provider", "#dictionary-packs"].includes(message.hash)) await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${message.hash}`) });
      else await chrome.runtime.openOptionsPage();
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
      return commitRichMdictImport(message);
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
    case BACKGROUND_MESSAGES.RICH_MDICT_PREFERENCES_PROMOTE:
      assertOptionsSender(sender);
      return promoteRichMdictDictionary(message.dictionaryId);
    case BACKGROUND_MESSAGES.RICH_MDICT_LOOKUP:
      if (message.dictionaryId !== undefined) {
        assertSelectionContentSender(sender);
        return lookupRichMdictDictionaries({
          text: message.text,
          dictionaryId: message.dictionaryId,
          requestId: message.requestId,
          ...(message.expectedPackVersion !== undefined || message.expectedPackageVersion !== undefined ? { expectedPackVersion: message.expectedPackVersion, expectedPackageVersion: message.expectedPackageVersion } : {})
        }, selectionContentOwnerKey(sender, message));
      }
      return lookupRichMdictDictionaries(message.text);
    case BACKGROUND_MESSAGES.RICH_MDICT_LOOKUP_CANCEL:
      assertSelectionContentSender(sender);
      return cancelRichMdictLookup(message.requestId, selectionContentOwnerKey(sender, message));
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
      return preflightRichMddResourceImport(message);
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_COMMIT:
      assertOptionsSender(sender);
      {
        const result = await commitRichMddResourceImport(message);
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
      assertSelectionContentSender(sender);
      return lookupRichMddResource({
        dictionaryId: message.dictionaryId,
        path: message.path,
        packageVersion: message.packageVersion,
        requestId: message.requestId
      }, selectionContentOwnerKey(sender, message));
    case BACKGROUND_MESSAGES.RICH_MDD_RESOURCE_READ_CANCEL:
      assertSelectionContentSender(sender);
      return cancelRichMddResourceLookup(message.requestId, selectionContentOwnerKey(sender, message));
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_ADD:
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_ADD_AI_NOTE:
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_OPEN:
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_LIST:
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_REVIEW:
    case BACKGROUND_MESSAGES.VOCABULARY_BOOK_REMOVE:
      return handleVocabularyBookMessage(message, sender);
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
  const expected = chrome.runtime.getURL(EXTENSION_PAGES.options);
  const actual = String(sender?.url || "");
  if (actual !== expected && !actual.startsWith(expected + "#")) {
    const error = new Error("This action is only available from Settings.");
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
export function selectionContentOwnerKey(sender, message = {}) {
  const tabId = Number(sender?.tab?.id);
  const frameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
  const documentId = String(sender?.documentId || "");
  const ownerToken = String(message?.ownerToken || "");
  const documentOwnerToken = /^[a-f0-9]{32}$/iu.test(ownerToken) ? ownerToken.toLowerCase() : "";
  const identity = documentId
    ? `document:${documentId.slice(0, 256)}`
    : documentOwnerToken ? `content:${documentOwnerToken}` : "";
  if (!Number.isInteger(tabId) || !identity) {
    const error = new Error("Rich dictionary lookup sender identity is unavailable.");
    error.code = "RICH_MDICT_CONTENT_ONLY";
    throw error;
  }
  return `selection:${tabId}:${frameId}:${identity}`;
}
