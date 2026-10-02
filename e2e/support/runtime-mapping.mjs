import assert from "node:assert/strict";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../../src/shared/runtime-assets.js";
import frozen from "./19e89b6-runtime-mapping.json" with { type: "json" };

export const preSwitchRuntimeMapping = frozen;
export const currentRuntimeMapping = {
  contentScripts: [...CONTENT_SCRIPT_FILES], contentStyles: [...CONTENT_STYLE_FILES],
  extensionPages: EXTENSION_PAGES, workers: WORKER_PATHS, mainFiles: [...YOUTUBE_MAIN_BRIDGE_FILES]
};

export function mappingForGeneration(generation) {
  assert(["current", "pre-switch-19e"].includes(generation), "Unknown artifact generation");
  return generation === "pre-switch-19e" ? preSwitchRuntimeMapping : currentRuntimeMapping;
}

export function assertRuntimeMapping(paths, manifest, mapping) {
  for (const path of ["manifest.json", manifest.background.service_worker, ...Object.values(mapping.extensionPages),
    ...mapping.contentScripts, ...mapping.contentStyles, ...Object.values(mapping.workers), ...mapping.mainFiles]) {
    assert(paths.has(path), "Production artifact lacks runtime mapping: " + path);
  }
}
