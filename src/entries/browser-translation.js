import { classifySelectionIntent } from "../shared/selection.js";
import { BROWSER_ENGINE, LANGUAGE_NAMES, browserLanguage, BROWSER_TRANSLATION_ACTIONS, languageHintMatchesText } from "../shared/browser-translation.js";
import { buildSubtitleCacheSource } from "../shared/subtitle-cache.js";
import * as language from "../shared/browser-language.js";
import { createBrowserNativeRuntime } from "../browser-native/runtime.js";
import { withSharedNativeHost } from "../browser-native/transport.js";
globalThis.__TRANSLATE_FLOW_CONTENT__.modules.browserTranslationContract = { classifySelectionIntent, BROWSER_ENGINE, LANGUAGE_NAMES, browserLanguage, BROWSER_TRANSLATION_ACTIONS, languageHintMatchesText, buildSubtitleCacheSource, createBrowserNativeRuntime, withSharedNativeHost, ...language };
