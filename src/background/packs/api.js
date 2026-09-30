import { createDictionaryPackManager } from "./manager.js";
import { createRichMdictManager } from "./rich-mdict.js";
import { createRichMddResourceManager } from "./rich-mdd-resources.js";
import { createPackStateStore } from "./state.js";
import { RICH_MDICT_STATE_KEY } from "./rich-mdict-contract.js";

let defaultManager;
let defaultRichMdictManager;
let defaultRichMddResourceManager;
let defaultRichStateStore;

function getRichMdictStateStore() {
  if (!defaultRichStateStore) defaultRichStateStore = createPackStateStore({ stateKey: RICH_MDICT_STATE_KEY });
  return defaultRichStateStore;
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
  return getRichMdictManager().commit(input);
}

export function cancelRichMdictImport(requestId) {
  return getRichMdictManager().cancel(requestId);
}

export function listRichMdictDictionaries() {
  return getRichMdictManager().list();
}

export function lookupRichMdictDictionaries(text) {
  return getRichMdictManager().lookup(text);
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

export function lookupRichMddResource(input) {
  return getRichMddResourceManager().lookupResource(input);
}

export function uninstallRichMdictDictionary(packId) {
  const id = String(packId || "");
  return getRichMdictManager().uninstall(id).then((result) => {
    if (result.uninstalled) getRichMddResourceManager().forgetDictionary(id);
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
