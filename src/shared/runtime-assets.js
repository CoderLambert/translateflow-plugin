// Stable installed paths shared by runtime callers and build/test adapters.
export const BRAND_ICONS = Object.freeze({ 16: "assets/icons/icon-16.png", 32: "assets/icons/icon-32.png", 48: "assets/icons/icon-48.png", 64: "assets/icons/icon-64.png", 128: "assets/icons/icon-128.png" });
export const LEGAL_ASSETS = Object.freeze({ privacyEn: "assets/legal/privacy-en.html", privacyZh: "assets/legal/privacy-zh-CN.html", support: "assets/legal/support.html", notices: "assets/licenses/third-party.txt" });
export const EXTENSION_PAGES = Object.freeze({ inputTranslation: "input-translation.html", popup: "popup.html", options: "options.html", learningCenter: "learning-center.html", readingPreview: "reading-preview.html" });
export const MANIFEST_LOCALE_FILES = Object.freeze(["_locales/en/messages.json", "_locales/zh_CN/messages.json"]);
export const WORKER_PATHS = Object.freeze({
  curatedDictionary: "src/options/workers/curated-dictionary-worker.js",
  curatedEcdictMdx: "src/options/workers/curated-ecdict-mdx-worker.js",
  mdictImport: "src/options/workers/mdict-import-worker.js",
  stardictImport: "src/options/workers/stardict-import-worker.js",
  richMdictImport: "src/options/workers/rich-mdict-import-worker.js",
  mddResourceImport: "src/options/workers/mdd-resource-import-worker.js"
});
export const YOUTUBE_MAIN_BRIDGE_FILES = Object.freeze([
  "src/content/subtitles/youtube-bridge-protocol.js",
  "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/youtube-main-bridge.js"
]);
