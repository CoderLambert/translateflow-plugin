import { createDictionaryPackManager } from "./manager.js";
import { createRichMdictManager } from "./rich-mdict.js";

let defaultManager;
let defaultRichMdictManager;

export function getDictionaryPackManager() {
  if (!defaultManager) defaultManager = createDictionaryPackManager();
  return defaultManager;
}

export function getRichMdictManager() {
  if (!defaultRichMdictManager) defaultRichMdictManager = createRichMdictManager();
  return defaultRichMdictManager;
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

export function uninstallRichMdictDictionary(packId) {
  return getRichMdictManager().uninstall(packId);
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
