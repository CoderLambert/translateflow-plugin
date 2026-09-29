import { createDictionaryPackManager } from "./manager.js";

let defaultManager;

export function getDictionaryPackManager() {
  if (!defaultManager) defaultManager = createDictionaryPackManager();
  return defaultManager;
}

export function installDictionaryPack(input) {
  return getDictionaryPackManager().install(input);
}

export function importLocalDictionaryTflex(input) {
  return getDictionaryPackManager().importLocalTflex(input);
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
