import { en as baseEn, zh_CN as baseZhCN } from "./catalog-base.js";
import { en as contentEn, zh_CN as contentZhCN } from "./catalog-content.js";
import { en as contentPageEn, zh_CN as contentPageZhCN } from "./catalog-content-page.js";
import { en as optionsEn, zh_CN as optionsZhCN } from "./catalog-options.js";
import { en as dictionaryEn, zh_CN as dictionaryZhCN } from "./catalog-dictionary.js";
import { en as dictionaryRuntimeEn, zh_CN as dictionaryRuntimeZhCN } from "./catalog-dictionary-runtime.js";
import { en as localImportEn, zh_CN as localImportZhCN } from "./catalog-local-import.js";
import { en as localImportCapabilitiesEn, zh_CN as localImportCapabilitiesZhCN } from "./catalog-local-import-capabilities.js";
import { en as learningEn, zh_CN as learningZhCN } from "./catalog-learning.js";

// One logical catalog, split only to keep source files reviewable and within
// repository size limits. Consumers import this aggregate, never the shards.
export const en = Object.freeze({
  ...baseEn,
  ...contentEn,
  ...contentPageEn,
  ...optionsEn,
  ...dictionaryEn,
  ...dictionaryRuntimeEn,
  ...localImportEn,
  ...localImportCapabilitiesEn,
  ...learningEn
});

export const zh_CN = Object.freeze({
  ...baseZhCN,
  ...contentZhCN,
  ...contentPageZhCN,
  ...optionsZhCN,
  ...dictionaryZhCN,
  ...dictionaryRuntimeZhCN,
  ...localImportZhCN,
  ...localImportCapabilitiesZhCN,
  ...learningZhCN
});

export const catalogs = Object.freeze({ en, zh_CN });
