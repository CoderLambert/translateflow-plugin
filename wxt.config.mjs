import { defineConfig } from "wxt";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, runtimeAssetRoots, sourceClosure, lexicalAssetFiles } from "./scripts/wxt-assets.mjs";
import { EXTENSION_PAGES } from "./src/shared/runtime-assets.js";
import { projectProductionManifest } from "./scripts/production-manifest.mjs";
import { checkManifestLocales } from "./scripts/i18n-locales.mjs";

const { manifest_version: _version, ...baselineManifest } = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
const manifest = projectProductionManifest(baselineManifest);
const staging = process.env.TF_WXT_BUILD_ROOT;
const reportDir = staging ? resolve(staging, "reports") : resolve(ROOT, ".wxt/reports");
const compiledChunks = [];

export default defineConfig({
  imports: false,
  ...(staging ? { outDir: resolve(staging, "output") } : {}),
  modules: ["@wxt-dev/module-react"],
  manifest,
  vite: () => ({
    build: { target: "chrome102", cssTarget: "chrome102", sourcemap: false },
    plugins: [{
      name: "translateflow-output-audit",
      writeBundle(_options, bundle) {
        for (const item of Object.values(bundle)) compiledChunks.push({ fileName: item.fileName === "entrypoints/learning-center/index.html" ? EXTENSION_PAGES.learningCenter : item.fileName, type: item.type,
          ...(item.type === "chunk" ? { imports: item.imports, dynamicImports: item.dynamicImports,
            modules: Object.keys(item.modules).map((id) => id.replace(ROOT, "")) } : {}) });
      }
    }]
  }),
  hooks: {
    "entrypoints:found": (_wxt, entries) => {
      // Register the existing HTML source directly; no second UI template.
      entries.push({ name: "popup", type: "popup", inputPath: resolve(ROOT, EXTENSION_PAGES.popup) });
      // Keep Chrome's existing full-tab options_page semantics, without options_ui.
      entries.push({ name: "options", type: "unlisted-page", inputPath: resolve(ROOT, EXTENSION_PAGES.options) });
    },
    "entrypoints:resolved": (_wxt, entries) => {
      const popup = entries.find((entry) => entry.type === "popup");
      if (!popup) throw new Error("Missing popup entrypoint");
      // The HTML title is separate from Chrome's localized action title.
      popup.options.defaultTitle = manifest.action.default_title;
    },
    "build:before": () => { compiledChunks.length = 0; },
    "build:publicAssets": async (_wxt, assets) => {
      if (assets.length) throw new Error("Unregistered public assets are forbidden; use the exact runtime asset map.");
      const runtime = await sourceClosure(runtimeAssetRoots());
      const locales = await sourceClosure((await checkManifestLocales()).files);
      const lexical = await lexicalAssetFiles({ requireLexicon: process.env.TRANSLATEFLOW_WXT_REQUIRE_LEXICON === "1" });
      if (lexical.missing.length) console.warn(`WXT development package missing generated dictionaries: ${lexical.missing.join(", ")}`);
      for (const path of [...runtime, ...lexical.files, ...locales]) assets.push({ absoluteSrc: resolve(ROOT, path), relativeDest: path });
      await mkdir(reportDir, { recursive: true });
      await writeFile(resolve(reportDir, "asset-map.json"), JSON.stringify({ runtime, lexical, locales }, null, 2) + "\n");
    },
    "build:done": async () => {
      await mkdir(reportDir, { recursive: true });
      await writeFile(resolve(reportDir, "compiled-closures.json"), JSON.stringify(compiledChunks, null, 2) + "\n");
    }
  }
});
