#!/usr/bin/env node
// PF-00 probe only. This creates an isolated project, never a production package.
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error("usage: node prepare-experiment.mjs <repo> <new-experiment-dir>");
const source = await realpath(sourceArg);
const output = resolve(outputArg);
if (output === source || !relative(source, output).startsWith("..")) {
  throw new Error("experiment directory must be outside the repository");
}
await mkdir(output, { recursive: true });
const constants = await import(pathToFileURL(resolve(source, "src/shared/constants.js")));
const youtube = await import(pathToFileURL(resolve(source, "src/background/youtube-bridge.js")));
const workers = ["curated-dictionary", "curated-ecdict-mdx", "mdict-import", "stardict-import", "rich-mdict-import", "mdd-resource-import"]
  .map((name) => `src/options/workers/${name}-worker.js`);
const roots = [...constants.CONTENT_SCRIPT_FILES, ...constants.CONTENT_STYLE_FILES,
  ...youtube.YOUTUBE_MAIN_BRIDGE_FILES, ...workers,
  "popup.html", "popup.js", "popup-appearance.js", "popup.css",
  "options.html", "options.js", "options.css"];

async function closure(seed) {
  const paths = new Set();
  async function visit(path) {
    if (paths.has(path)) return;
    if (path.startsWith("../") || path.startsWith("/")) throw new Error(`unsafe source path: ${path}`);
    paths.add(path);
    const text = await readFile(resolve(source, path), "utf8");
    const imports = path.endsWith(".js")
      ? [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/gu)].map((m) => m[1])
      : path.endsWith(".html")
        ? [...text.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gu)].map((m) => m[1]).filter((v) => !v.startsWith("#") && !v.includes(":"))
        : [];
    for (const dependency of imports) {
      const next = relative(source, resolve(source, dirname(path), dependency)).replaceAll("\\", "/");
      await visit(next);
    }
  }
  for (const path of seed) await visit(path);
  return [...paths].sort();
}

const bridge = await closure(roots);
const bundled = await closure(["src/background/index.js"]);
for (const path of new Set([...bridge, ...bundled])) {
  const destination = resolve(output, "legacy", path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(source, path), destination);
}
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
await writeFile(resolve(output, "bridge.json"), JSON.stringify(bridge, null, 2) + "\n");
await writeFile(resolve(output, "baseline-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(resolve(output, "package.json"), JSON.stringify({
  name: "translateflow-pf00-probe", private: true, type: "module",
  scripts: { prepare: "wxt prepare", build: "wxt build -b chrome --mv3", typecheck: "tsc --noEmit", test: "vitest run" },
  devDependencies: {
    wxt: "0.21.4", vite: "7.3.1", "@wxt-dev/module-react": "1.2.2", "@vitejs/plugin-react": "5.1.4",
    react: "19.3.0", "react-dom": "19.3.0", "@types/react": "19.3.0", "@types/react-dom": "19.3.0",
    typescript: "5.9.3", vitest: "5.0.3", "@types/node": "24.10.1", "@playwright/test": "1.63.0"
  }
}, null, 2) + "\n");
await mkdir(resolve(output, "entrypoints/platform-smoke"), { recursive: true });
await mkdir(resolve(output, "unit"), { recursive: true });
await writeFile(resolve(output, "wxt.config.ts"), `import { defineConfig } from 'wxt';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import bridge from './bridge.json';
import manifest from './baseline-manifest.json';
const { manifest_version: _oldManifestVersion, ...baselineManifest } = manifest;
export default defineConfig({
  imports: false,
  modules: ['@wxt-dev/module-react'],
  manifest: { ...baselineManifest, background: { service_worker: 'background.js', type: 'module' } },
  vite: () => ({
    build: { target: 'chrome102', cssTarget: 'chrome102' },
    plugins: [{ name: 'pf00-dependency-audit', generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
        .map((item) => ({ fileName: item.fileName, isEntry: item.isEntry, imports: item.imports,
          modules: Object.keys(item.modules).map((id) => id.replace(process.cwd() + '/', '')) }));
      writeFileSync('logs/dependency-closures.json', JSON.stringify(chunks, null, 2) + '\\n');
    } }]
  }),
  hooks: { 'build:publicAssets': (_wxt, assets) => {
    for (const path of bridge) assets.push({ absoluteSrc: resolve('legacy', path), relativeDest: path });
  } }
});
`);
await writeFile(resolve(output, "entrypoints/background.ts"), `import { defineBackground } from 'wxt/utils/define-background';
import { initializeBackground } from '../legacy/src/background/index.js';
export default defineBackground({ type: 'module', main() { initializeBackground(); } });
`);
await writeFile(resolve(output, "entrypoints/platform-smoke/index.html"), '<!doctype html><html><head><meta charset="UTF-8"><title>PF-00 smoke</title></head><body><main id="root"></main><script type="module" src="./main.tsx"></script></body></html>\n');
await writeFile(resolve(output, "entrypoints/platform-smoke/main.tsx"), `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<p>TranslateFlow platform smoke</p>);
`);
await writeFile(resolve(output, "tsconfig.json"), JSON.stringify({ extends: "./.wxt/tsconfig.json", compilerOptions: { strict: true, allowJs: true, checkJs: false, jsx: "react-jsx", resolveJsonModule: true, types: ["node", "react", "react-dom"] }, include: ["entrypoints/**/*.ts", "entrypoints/**/*.tsx", "unit/**/*.ts"], exclude: ["legacy", "node_modules", ".output"] }, null, 2) + "\n");
await writeFile(resolve(output, "vitest.config.ts"), `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['unit/**/*.test.ts'], environment: 'node' } });
`);
await writeFile(resolve(output, "unit/contracts.test.ts"), `import { describe, it, expect } from 'vitest';
import { CONTENT_SCRIPT_FILES, CACHE_SCHEMA_VERSION } from '../legacy/src/shared/constants.js';
import { normalizeSourceText } from '../legacy/src/shared/text.js';
describe('legacy pure contracts under the new toolchain', () => {
  it('retains ordered classic injection and cache schema', () => {
    expect(CONTENT_SCRIPT_FILES[0]).toBe('src/content/runtime.js');
    expect(CONTENT_SCRIPT_FILES.at(-1)).toBe('content.js');
    expect(CACHE_SCHEMA_VERSION).toBe(2);
  });
  it('normalizes text using the existing implementation', () => {
    expect(normalizeSourceText('  a   b  ')).toBe('a b');
  });
});
`);
console.log(JSON.stringify({ source, output, bridgeFiles: bridge.length, bundledSourceFiles: bundled.length, workers }, null, 2));
