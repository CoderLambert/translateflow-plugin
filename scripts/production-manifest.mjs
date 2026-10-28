import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

export const GLOBAL_CONTENT_SCRIPT = Object.freeze({
  matches: Object.freeze(["http://*/*", "https://*/*"]),
  js: CONTENT_SCRIPT_FILES,
  css: CONTENT_STYLE_FILES,
  run_at: "document_idle"
});

export function projectProductionManifest(baseline, { developer = false } = {}) {
  const { content_scripts: _legacyContentScripts, ...manifest } = baseline;
  // Native Host is a developer-only feature; public builds do not request its permission.
  // Keep the same version, storage and website access in both editions.
  return developer ? { ...manifest, version_name: `${manifest.version}-dev`,
    optional_permissions: [...new Set([...(manifest.optional_permissions || []), "nativeMessaging"])] } : manifest;
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
