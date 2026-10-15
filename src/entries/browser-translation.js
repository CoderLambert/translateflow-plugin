import { BROWSER_ENGINE, LANGUAGE_NAMES, browserLanguage, BROWSER_TRANSLATION_ACTIONS, languageHintMatchesText } from "../shared/browser-translation.js";
import { buildSubtitleCacheSource } from "../shared/subtitle-cache.js";
import * as language from "../shared/browser-language.js";
globalThis.__TRANSLATE_FLOW_CONTENT__.modules.browserTranslationContract = { BROWSER_ENGINE, LANGUAGE_NAMES, browserLanguage, BROWSER_TRANSLATION_ACTIONS, languageHintMatchesText, buildSubtitleCacheSource, ...language };
