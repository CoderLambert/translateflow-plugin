import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

export const GLOBAL_CONTENT_SCRIPT = Object.freeze({
  matches: Object.freeze(["http://*/*", "https://*/*"]),
  js: CONTENT_SCRIPT_FILES,
  css: CONTENT_STYLE_FILES,
  run_at: "document_idle"
});

export function projectProductionManifest(baseline) {
  const { content_scripts: _legacyContentScripts, ...manifest } = baseline;
  return manifest;
}

export function expectedProductionManifest(baseline) {
  return {
    ...projectProductionManifest(baseline),
    content_scripts: [{
      matches: [...GLOBAL_CONTENT_SCRIPT.matches],
      js: [...GLOBAL_CONTENT_SCRIPT.js],
      css: [...GLOBAL_CONTENT_SCRIPT.css],
      run_at: GLOBAL_CONTENT_SCRIPT.run_at
    }]
  };
}
