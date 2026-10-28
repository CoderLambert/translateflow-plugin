import { en as inputEn, zh_CN as inputZhCN } from "./catalog-input-translation.js";
import { en as basicEn, zh_CN as basicZhCN } from "./catalog-browser-translation.js";
import { en as baseEn, zh_CN as baseZhCN } from "./catalog-base.js";
import { en as contentEn, zh_CN as contentZhCN } from "./catalog-content.js";
import { en as contentPageEn, zh_CN as contentPageZhCN } from "./catalog-content-page.js";
import { en as optionsEn, zh_CN as optionsZhCN } from "./catalog-options.js";
import { en as optionsChatGPTEn, zh_CN as optionsChatGPTZhCN } from "./catalog-options-chatgpt.js";
import { en as dictionaryEn, zh_CN as dictionaryZhCN } from "./catalog-dictionary.js";
import { en as learningEn, zh_CN as learningZhCN } from "./catalog-learning.js";
import { en as nativeEn, zh_CN as nativeZhCN } from "./catalog-native-completion.js";

import { en as mtEn, zh_CN as mtZhCN } from "./catalog-machine-translation.js";

// One logical catalog, split only to keep source files reviewable and within
// repository size limits. Consumers import this aggregate, never the shards.
export const en = Object.freeze({
  ...inputEn,
  ...basicEn,
  ...baseEn,
  ...contentEn,
  ...contentPageEn,
  ...optionsEn,
  ...optionsChatGPTEn,
  ...dictionaryEn,
  ...learningEn,
  ...nativeEn,
  ...mtEn
});

export const zh_CN = Object.freeze({
  ...inputZhCN,
  ...basicZhCN,
  ...baseZhCN,
  ...contentZhCN,
  ...contentPageZhCN,
  ...optionsZhCN,
  ...optionsChatGPTZhCN,
  ...dictionaryZhCN,
  ...learningZhCN,
  ...nativeZhCN,
  ...mtZhCN
});

export const catalogs = Object.freeze({ en, zh_CN });
