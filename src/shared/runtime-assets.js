// Stable installed paths shared by runtime callers and build/test adapters.
export const EXTENSION_PAGES = Object.freeze({ popup: "popup.html", options: "options.html", learningCenter: "learning-center.html", readingPreview: "reading-preview.html" });
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
export const BUNDLED_LEXICON_PATHS = Object.freeze({
  core: "assets/lexicon/core", technical: "assets/lexicon/technical"
});
