// Stable extension-facing facade. No identity rules or IndexedDB code belong here.
import { createApplicationCache } from './cache/application.js';

let application;
const current = () => application ||= createApplicationCache();
export const lookupTranslations = input => current().lookupTranslations(input);
export const storeTranslations = input => current().storeTranslations(input);
export const lookupSelectionExplanation = input => current().lookupSelectionExplanation(input);
export const storeSelectionExplanation = input => current().storeSelectionExplanation(input);
export const getPageCacheStatus = input => current().getPageCacheStatus(input);
export const clearPageCache = input => current().clearPageCache(input);
export const clearAllCache = () => current().clearAllCache();
export const getCacheStats = () => current().getCacheStats();
export const pruneCache = maxBytes => current().pruneCache(maxBytes);
export const closeCache = () => { application?.close(); application = null; };
export { getCacheContext, getConfigHash, translationSourceHash, createApplicationCache } from './cache/application.js';
