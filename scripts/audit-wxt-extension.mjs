#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, legacyAssetRoots, sourceClosure, lexicalAssetFiles, byteSummary } from "./wxt-assets.mjs";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";
import { checkManifestLocales } from "./i18n-locales.mjs";

export function assertProductionManifest(manifest, baseline) {
  assert.deepEqual(manifest, baseline, "Production WXT Manifest must equal the baseline exactly");
}

export async function auditWxtExtension({ output = resolve(ROOT, ".output/chrome-mv3"), reportDir = resolve(ROOT, ".wxt/reports") } = {}) {
  const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
  const baseline = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
  // No permission, registration, options semantics or identity differences are approved here.
  assertProductionManifest(manifest, baseline);
  const legacy = await sourceClosure(legacyAssetRoots());
  const lexical = await lexicalAssetFiles();
  const locales = await sourceClosure((await checkManifestLocales()).files);
  const assetMap = JSON.parse(await readFile(resolve(reportDir, "asset-map.json"), "utf8"));
  assert.deepEqual(assetMap, { legacy, lexical, locales }, "Build bridge must match current runtime sources");
  const compiled = JSON.parse(await readFile(resolve(reportDir, "compiled-closures.json"), "utf8"));
  const summary = await byteSummary(output);
  const present = new Set(summary.files.map((entry) => entry.path));
  const expected = new Set(["manifest.json", ...Object.values(EXTENSION_PAGES), ...legacy, ...lexical.files, ...locales, ...compiled.map((item) => item.fileName)]);
  assert.deepEqual([...present].sort(), [...expected].sort(), "Unregistered or missing production assets");
  for (const path of [...legacy, ...lexical.files, ...locales]) {
    assert.deepEqual(await readFile(resolve(output, path)), await readFile(resolve(ROOT, path)), `Bridge changed source bytes: ${path}`);
  }
  for (const path of [...Object.values(WORKER_PATHS), ...YOUTUBE_MAIN_BRIDGE_FILES]) assert(present.has(path), `Missing runtime mapping: ${path}`);
  const chunkMap = new Map(compiled.map(item => [item.fileName, item]));
  function closure(roots) {
    const files = new Set();
    function visit(path) {
      if (files.has(path)) return;
      files.add(path);
      const chunk = chunkMap.get(path);
      for (const dependency of [...(chunk?.imports || []), ...(chunk?.dynamicImports || [])]) visit(dependency);
    }
    roots.forEach(visit);
    return files;
  }
  async function pageRoots(path) {
    const html = await readFile(resolve(output, path), "utf8");
    return [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gu)].map(match => match[1].replace(/^\//u, ""));
  }
  const learningFiles = closure(await pageRoots(EXTENSION_PAGES.learningCenter));
  learningFiles.add(EXTENSION_PAGES.learningCenter);
  const legacyCompiled = closure(["background.js", ...await pageRoots(EXTENSION_PAGES.popup), ...await pageRoots(EXTENSION_PAGES.options)]);
  for (const chunk of compiled) {
    for (const path of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) assert(present.has(path), `Missing compiled import: ${path}`);
    for (const module of chunk.modules || []) {
      assert(!/(?:^|\/)(?:vitest|@vitest|@testing-library|jsdom|happy-dom|@webext-core\/fake-browser)(?:\/|$)/u.test(module), `Test dependency entered production: ${module}`);
      if (/(?:^|\/)(?:react|react-dom)\//u.test(module)) {
        assert(learningFiles.has(chunk.fileName) && !legacyCompiled.has(chunk.fileName), `React entered non-learning runtime: ${module}`);
      }
      assert(!/(?:^|\/)(?:tests|e2e|scripts|docs|lexicon|\.release-sources|\.github)\//u.test(module), `Build/private source entered compiled output: ${module}`);
      assert(!/\/wxt\/dist\/client\/(?:websocket|dev-server|reload)/u.test(module), `Development helper entered production: ${module}`);
    }
  }
  for (const { path } of summary.files) {
    assert(!/^(?:tests|e2e|scripts|docs|lexicon|node_modules|\.github|\.release-sources)\//u.test(path), `Private/build source path: ${path}`);
    assert(!/\.(?:map|pem|crx|zip)$/u.test(path), `Unregistered archive or source map: ${path}`);
    if (/\.(?:js|html|css)$/u.test(path)) {
      const text = await readFile(resolve(output, path), "utf8");
      assert(!/@vite\/client|\bimport\.meta\.hot\b|ws:\/\/localhost|http:\/\/localhost:\d+/u.test(text), `Development resource: ${path}`);
      if (path.endsWith(".html")) {
        assert(!/<script\b[^>]*\bsrc=["']https?:/iu.test(text), `Remote script: ${path}`);
        for (const match of text.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gu)) {
          assert(!match[1].includes(":"), `Remote HTML asset: ${path}`);
          assert(present.has(match[1].replace(/^\//u, "")), `Missing HTML dependency: ${path} → ${match[1]}`);
        }
      }
    }
  }
  const codeBudgetBytes = 1576595; // #245: old code + max(10%, 100 KiB), excluding dictionary data.
  const learningExclusive = summary.files.filter(entry => learningFiles.has(entry.path) && !legacyCompiled.has(entry.path));
  const learningBytes = learningExclusive.reduce((sum, entry) => sum + entry.size, 0);
  const platformCodeBytes = summary.codeBytes - learningBytes;
  assert(platformCodeBytes <= codeBudgetBytes, `Platform code exceeds #245 budget: ${platformCodeBytes}`);
  const sizes = new Map(summary.files.map((entry) => [entry.path, entry.size]));
  const chunks = new Map(compiled.map((item) => [item.fileName, item]));
  function compiledClosure(roots) {
    const seen = new Set();
    function visit(path) {
      if (seen.has(path)) return;
      seen.add(path);
      for (const dependency of chunks.get(path)?.imports || []) visit(dependency);
    }
    for (const path of roots) visit(path);
    return { files: [...seen].sort(), bytes: [...seen].reduce((sum, path) => sum + sizes.get(path), 0) };
  }
  const backgroundClosure = compiledClosure(["background.js"]);
  const uiClosure = compiledClosure((await Promise.all(Object.values(EXTENSION_PAGES).map(pageRoots))).flat());
  uiClosure.htmlBytes = Object.values(EXTENSION_PAGES).reduce((sum, path) => sum + sizes.get(path), 0);
  uiClosure.bytes += uiClosure.htmlBytes;
  const report = { status: "PASS", source: "WXT production .output/chrome-mv3", manifestDifferences: [],
    legacyFiles: legacy.length, lexicalMissing: lexical.missing, ...summary,
    codeBudgetBytes, platformCodeBytes, learningClosure: { files: learningExclusive.map(entry => entry.path), bytes: learningBytes }, backgroundClosure, uiClosure,
    compiledOutputs: compiled.map((item) => ({ fileName: item.fileName, type: item.type })) };
  await writeFile(resolve(reportDir, "production-audit.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditWxtExtension();
  console.log(JSON.stringify({ ...report, files: undefined }, null, 2));
}
