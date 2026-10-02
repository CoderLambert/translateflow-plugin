import { createDictionaryPackManager } from "./manager.js";
import { createRichMdictManager, serializeRichMdictPack } from "./rich-mdict.js";
import { createRichMddResourceManager } from "./rich-mdd-resources.js";
import { createPackStateStore } from "./state.js";
import {
  normalizePackId,
  RICH_MDICT_SOURCE_ID,
  RICH_MDICT_STATE_KEY,
  validateCuratedRichMdictProvenance
} from "./rich-mdict-contract.js";
import { createRichMdictPreferencesStore } from "./rich-mdict-preferences.js";

let defaultManager;
let defaultRichMdictManager;
let defaultRichMddResourceManager;
let defaultRichStateStore;
let defaultRichMdictPreferencesStore;

function getRichMdictStateStore() {
  if (!defaultRichStateStore) defaultRichStateStore = createPackStateStore({ stateKey: RICH_MDICT_STATE_KEY });
  return defaultRichStateStore;
}

function getRichMdictPreferencesStore() {
  if (!defaultRichMdictPreferencesStore) defaultRichMdictPreferencesStore = createRichMdictPreferencesStore();
  return defaultRichMdictPreferencesStore;
}

export function getDictionaryPackManager() {
  if (!defaultManager) defaultManager = createDictionaryPackManager();
  return defaultManager;
}

export function getRichMdictManager() {
  if (!defaultRichMdictManager) defaultRichMdictManager = createRichMdictManager({ stateStore: getRichMdictStateStore() });
  return defaultRichMdictManager;
}

export function getRichMddResourceManager() {
  if (!defaultRichMddResourceManager) defaultRichMddResourceManager = createRichMddResourceManager({ stateStore: getRichMdictStateStore() });
  return defaultRichMddResourceManager;
}

export function commitRichMdictImport(input) {
  return getRichMdictManager().commit(input).then(async (result) => {
    const listed = await getRichMdictManager().listMetadata();
    await getRichMdictPreferencesStore().reconcile(listed.dictionaries);
    return result;
  });
}

export function cancelRichMdictImport(requestId) {
  return getRichMdictManager().cancel(requestId);
}

export async function listRichMdictDictionaries() {
  const result = await getRichMdictManager().list();
  const preferences = await getRichMdictPreferencesStore().reconcile(result.dictionaries);
  const dictionaries = result.dictionaries.map((dictionary) => ({
    ...dictionary,
    trustLabel: richDictionaryTrustLabel(dictionary),
    ...(preferences[dictionary.id] || defaultRichMdictPreference(dictionary))
  }));
  dictionaries.sort(compareRichDictionaryOrder);
  const preferredId = dictionaries.find((dictionary) => dictionary.enabled !== false)?.id;
  for (const dictionary of dictionaries) dictionary.preferred = dictionary.id === preferredId;
  return { ...result, dictionaries };
}

export async function listRichMdictViewerDictionaries() {
  return createRichMdictViewerDictionaryLister({
    manager: getRichMdictManager(),
    preferencesStore: getRichMdictPreferencesStore()
  })();
}

export function createRichMdictViewerDictionaryLister({ manager, preferencesStore } = {}) {
  return async function listViewerDictionaries() {
    const metadata = await manager.listMetadata();
    const dictionaries = (metadata?.dictionaries || []).filter((dictionary) => isValidRichPackId(dictionary?.id));
    const preferences = await preferencesStore.reconcile(dictionaries);
    const enabled = dictionaries
      .filter((dictionary) => preferences[dictionary.id]?.enabled !== false)
      .map((dictionary) => ({
        id: dictionary.id,
        title: dictionary.title,
        enabled: preferences[dictionary.id]?.enabled !== false,
        order: preferences[dictionary.id]?.order ?? 0,
        expandedByDefault: preferences[dictionary.id]?.expandedByDefault === true,
        trustLabel: richDictionaryTrustLabel(dictionary),
        format: dictionary.format,
        status: dictionary.status,
        errorCode: clampPublicErrorCode(dictionary.errorCode)
      }))
      .sort(compareRichDictionaryOrder);
    return {
      dictionaries: enabled.map((dictionary, index) => ({
        ...dictionary,
        preferred: index === 0,
        expandedByDefault: dictionary.expandedByDefault || index === 0
      }))
    };
  };
}

export async function updateRichMdictPreferences(dictionaryId, preferences) {
  const id = normalizePackId(dictionaryId);
  return serializeRichMdictPack(id, async () => {
    const state = await getRichMdictStateStore().read();
    if (state.packs?.[id]?.sourceId !== RICH_MDICT_SOURCE_ID) {
      const error = new Error("Rich MDict dictionary is not installed.");
      error.code = "RICH_MDICT_NOT_INSTALLED";
      throw error;
    }
    const updated = await getRichMdictPreferencesStore().update(id, preferences);
    return { dictionaryId: id, preferences: updated };
  });
}

export async function reorderRichMdictDictionaries(dictionaryIds) {
  const manager = getRichMdictManager();
  const initial = await manager.listMetadata();
  const lockIds = initial.dictionaries.map(({ id }) => id).sort();
  return serializeRichMdictPacks(lockIds, async () => {
    const current = await manager.listMetadata();
    return getRichMdictPreferencesStore().reorder(
      dictionaryIds,
      current.dictionaries.map(({ id }) => id)
    );
  });
}

export async function promoteRichMdictDictionary(dictionaryId) {
  const id = normalizePackId(dictionaryId);
  const manager = getRichMdictManager();
  const initial = await manager.listMetadata();
  const lockIds = initial.dictionaries
    .filter((dictionary) => isValidRichPackId(dictionary?.id))
    .map(({ id: packId }) => packId)
    .sort();
  return serializeRichMdictPacks(lockIds, async () => {
    const state = await getRichMdictStateStore().read();
    if (state.packs?.[id]?.sourceId !== RICH_MDICT_SOURCE_ID) {
      const error = new Error("Rich MDict dictionary is not installed.");
      error.code = "RICH_MDICT_NOT_INSTALLED";
      throw error;
    }
    const current = await manager.listMetadata();
    return getRichMdictPreferencesStore().promote(
      id,
      current.dictionaries.filter((dictionary) => isValidRichPackId(dictionary?.id)).map(({ id: packId }) => packId)
    );
  });
}

export async function lookupRichMdictDictionaries(request, selectionOwnerKey = "") {
  if (request && typeof request === "object" && !Array.isArray(request) && Object.hasOwn(request, "dictionaryId")) {
    const id = normalizePackId(request.dictionaryId);
    const preferences = await getRichMdictPreferencesStore().readAll();
    if (preferences.dictionaries[id]?.enabled === false) {
      return {
        found: false,
        dictionaries: [],
        errors: [{ id, title: "", code: "RICH_MDICT_DISABLED", message: "This rich dictionary is disabled in Settings." }]
      };
    }
    const lookupIdentity = selectionOwnerKey
      ? { requestId: request.requestId, ownerKey: selectionOwnerKey }
      : null;
    return getRichMdictManager().lookupDictionary(request.text, id, lookupIdentity);
  }
  return getRichMdictManager().lookup(typeof request === "string" ? request : request?.text);
}

export function cancelRichMdictLookup(requestId, selectionOwnerKey) {
  return getRichMdictManager().cancelLookup(requestId, selectionOwnerKey);
}

export function preflightRichMddResourceImport(input) {
  return getRichMddResourceManager().preflight(input);
}

export function commitRichMddResourceImport(input) {
  return getRichMddResourceManager().commit(input);
}

export function cancelRichMddResourceImport(requestId) {
  return getRichMddResourceManager().cancel(requestId);
}

export function abortRichMddResourceImport(input) {
  return getRichMddResourceManager().abortImport(input);
}

export function lookupRichMddResource(input, selectionOwnerKey = "") {
  const lookupIdentity = selectionOwnerKey
    ? { requestId: input?.requestId, ownerKey: selectionOwnerKey }
    : null;
  return getRichMddResourceManager().lookupResource(input, lookupIdentity);
}

export function cancelRichMddResourceLookup(requestId, selectionOwnerKey) {
  return getRichMddResourceManager().cancelLookup(requestId, selectionOwnerKey);
}

export function uninstallRichMdictDictionary(packId) {
  const id = String(packId || "");
  return getRichMdictManager().uninstall(id).then((result) => {
    if (result.uninstalled) {
      return Promise.all([
        getRichMddResourceManager().forgetDictionary(id),
        getRichMdictPreferencesStore().remove(id)
      ]).then(() => result);
    }
    return result;
  });
}

export function abortRichMdictImport(input) {
  return getRichMdictManager().abortImport(input);
}

export function preflightRichMdictImport(sourceBytes, identity) {
  return getRichMdictManager().preflightQuota(sourceBytes, identity);
}

export function installDictionaryPack(input) {
  return getDictionaryPackManager().install(input);
}

export function importLocalDictionaryTflex(input) {
  return getDictionaryPackManager().importLocalTflex(input);
}

export function importLocalDictionaryTflexFromQuarantine(input) {
  return getDictionaryPackManager().importLocalTflexFromQuarantine(input);
}

export function cancelDictionaryPackOperation(requestId) {
  return getDictionaryPackManager().cancel(requestId);
}

export function uninstallDictionaryPack(packId) {
  return getDictionaryPackManager().uninstall(packId);
}

export function rollbackDictionaryPack(packId) {
  return getDictionaryPackManager().rollback(packId);
}

export function recoverDictionaryPacks() {
  return getDictionaryPackManager().recoverAll();
}

export function getDictionaryPackStatus(options) {
  return getDictionaryPackManager().status(options);
}

function defaultRichMdictPreference(dictionary) {
  return { enabled: true, order: 0, expandedByDefault: false };
}

function compareRichDictionaryOrder(left, right) {
  return left.order - right.order ||
    String(left.title || "").localeCompare(String(right.title || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""));
}

function richDictionaryTrustLabel(dictionary) {
  try {
    if (dictionary.curated) {
      validateCuratedRichMdictProvenance(dictionary.curated, dictionary.id);
      return "精选 ECDICT";
    }
  } catch {
    // Invalid or missing persisted provenance remains unverified.
  }
  return "本地导入 · 用户提供 / 未验证";
}

function clampPublicErrorCode(value) {
  const code = String(value || "").replace(/[^A-Z0-9_]/gu, "").slice(0, 80);
  return code;
}

function isValidRichPackId(value) {
  try {
    normalizePackId(value);
    return true;
  } catch {
    return false;
  }
}

function serializeRichMdictPacks(packIds, action, index = 0) {
  if (index >= packIds.length) return action();
  return serializeRichMdictPack(packIds[index], () => serializeRichMdictPacks(packIds, action, index + 1));
}
