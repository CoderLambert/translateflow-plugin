import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

export const GLOBAL_CONTENT_SCRIPT = Object.freeze({
  matches: Object.freeze(["http://*/*", "https://*/*"]),
  js: CONTENT_SCRIPT_FILES,
  css: CONTENT_STYLE_FILES,
  run_at: "document_idle"
});

export function projectProductionManifest(baseline, { developer = false } = {}) {
  const { content_scripts: _legacyContentScripts, ...manifest } = baseline;
  // Chrome's version_name distinguishes the experimental unpacked build without changing
  // version, storage layout, Content scripts or existing host permissions.
  return developer ? { ...manifest, version_name: `${manifest.version}-dev` } : manifest;
}

export function expectedProductionManifest(baseline, { developer = false } = {}) {
  return {
    ...projectProductionManifest(baseline, { developer }),
    content_scripts: [{
      matches: [...GLOBAL_CONTENT_SCRIPT.matches],
      js: [...GLOBAL_CONTENT_SCRIPT.js],
      css: [...GLOBAL_CONTENT_SCRIPT.css],
      run_at: GLOBAL_CONTENT_SCRIPT.run_at
    }]
  };
}
