import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { assertAssetPath, isInsideSourceRoot, runtimeAssetRoots, sourceClosure } from "../scripts/wxt-assets.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { BRAND_ICONS, LEGAL_ASSETS, EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";
import { GLOBAL_CONTENT_SCRIPT, projectProductionManifest } from "../scripts/production-manifest.mjs";
import { isChatGPTPlanDeveloperBuild, requireChatGPTPlanDeveloperBuild } from "../src/shared/chatgpt-native-host.js";
import { AUTHOR_SUPPORT_QR } from "../src/shared/author-support.js";
import { YOUTUBE_MAIN_BRIDGE_FILES as runtimeMain } from "../src/background/youtube-bridge.js";
import { assertProductionManifest } from "../scripts/audit-wxt-extension.mjs";

test("raw asset map retains only MAIN and Worker contexts while Content uses stable compiled paths", async () => {
  const roots = runtimeAssetRoots();
  assert.deepEqual(roots, [...Object.values(BRAND_ICONS), ...Object.values(LEGAL_ASSETS), AUTHOR_SUPPORT_QR, ...YOUTUBE_MAIN_BRIDGE_FILES, ...Object.values(WORKER_PATHS)]);
  assert.deepEqual(CONTENT_SCRIPT_FILES, ["content-scripts/content.js"]);
  assert.deepEqual(CONTENT_STYLE_FILES, ["content-scripts/content.css"]);
  assert.strictEqual(runtimeMain, YOUTUBE_MAIN_BRIDGE_FILES);
  assert.deepEqual(EXTENSION_PAGES, { inputTranslation: "input-translation.html", popup: "popup.html", options: "options.html", learningCenter: "learning-center.html", readingPreview: "reading-preview.html" });
  const files = await sourceClosure(roots);
  for (const path of Object.values(WORKER_PATHS)) assert(files.includes(path));
  assert(files.includes("src/background/packs/importers/mdict-rich.js"));
  assert(!files.includes("src/content/runtime.js"));
  assert(!files.includes("content.css"));
  assert(!files.includes("popup.html"));
  assert(!files.includes("options.js"));
  assert(!files.includes("src/background/index.js"));
});

test("asset paths reject traversal, remote paths and empty segments", () => {
  for (const path of ["", "../private", "/absolute", "a//b", "a/./b", "a\\b", "http://example.test/x"]) assert.throws(() => assertAssetPath(path));
  assert.equal(assertAssetPath("src/shared/text.js"), "src/shared/text.js");
});

test("canonical source guard rejects Windows cross-drive and UNC escapes", () => {
  assert.equal(isInsideSourceRoot("C:\\repo", "C:\\repo\\src\\asset.js", win32), true);
  for (const candidate of ["C:\\repo", "C:\\private\\asset.js", "C:\\repo-other\\asset.js", "D:\\private\\asset.js", "\\\\server\\private\\asset.js"]) {
    assert.equal(isInsideSourceRoot("C:\\repo", candidate, win32), false);
  }
  assert.equal(isInsideSourceRoot("\\\\server\\repo", "\\\\server\\repo\\src\\asset.js", win32), true);
  assert.equal(isInsideSourceRoot("\\\\server\\repo", "\\\\server\\private\\asset.js", win32), false);
  assert.equal(isInsideSourceRoot("/repo", "/repo/src/asset.js", posix), true);
  assert.equal(isInsideSourceRoot("/repo", "/repo-other/private.js", posix), false);
});

test("bridge follows only relative imports and rejects symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tf-wxt-assets-"));
  const outside = await mkdtemp(join(tmpdir(), "tf-wxt-outside-"));
  try {
    await writeFile(join(root, "entry.js"), 'import "./child.js";\n');
    await writeFile(join(root, "child.js"), 'export const ok = true;\n');
    assert.deepEqual(await sourceClosure(["entry.js"], root), ["child.js", "entry.js"]);
    await writeFile(join(outside, "private.js"), "secret");
    await symlink(join(outside, "private.js"), join(root, "escape.js"));
    await assert.rejects(sourceClosure(["escape.js"], root), /escapes source root/u);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("ChatGPT developer edition is explicitly marked without changing standard site permissions", async () => {
  const baseline = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const publicManifest = projectProductionManifest(baseline);
  const developerManifest = projectProductionManifest(baseline, { developer: true });
  assert.equal(publicManifest.version_name, undefined);
  assert.equal(publicManifest.optional_permissions, undefined);
  assert.deepEqual(developerManifest.optional_permissions, ["nativeMessaging"]);
  assert(!publicManifest.permissions.includes("nativeMessaging"));
  assert.equal(developerManifest.version_name, `${baseline.version}-dev`);
  assert.equal(isChatGPTPlanDeveloperBuild(publicManifest), false);
  assert.equal(isChatGPTPlanDeveloperBuild(developerManifest), true);
  assert.equal(isChatGPTPlanDeveloperBuild({ ...developerManifest,
    permissions: [...developerManifest.permissions, "nativeMessaging"], optional_permissions: undefined }), true);
  assert.deepEqual(developerManifest.host_permissions, publicManifest.host_permissions);
  assert.deepEqual(developerManifest.permissions, publicManifest.permissions);
  assert.throws(() => requireChatGPTPlanDeveloperBuild(publicManifest), { code: "CHATGPT_PLAN_DEV_ONLY" });
  assert.doesNotThrow(() => requireChatGPTPlanDeveloperBuild(developerManifest));
  const contentScripts = [{ matches: [...GLOBAL_CONTENT_SCRIPT.matches], js: [...CONTENT_SCRIPT_FILES],
    css: [...CONTENT_STYLE_FILES], run_at: "document_idle" }];
  assertProductionManifest({ ...developerManifest, content_scripts: contentScripts }, baseline, { developer: true });
  assert.throws(() => assertProductionManifest({ ...developerManifest, content_scripts: contentScripts }, baseline));
});

test("production Manifest fails closed for permissions, static injection and development changes", async () => {
  const baseline = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const production = { ...projectProductionManifest(baseline), content_scripts: [{
    matches: [...GLOBAL_CONTENT_SCRIPT.matches], js: [...CONTENT_SCRIPT_FILES], css: [...CONTENT_STYLE_FILES], run_at: "document_idle"
  }] };
  assertProductionManifest(production, baseline);
  assert.deepEqual(production.content_scripts, [{
    matches: [...GLOBAL_CONTENT_SCRIPT.matches],
    js: [...CONTENT_SCRIPT_FILES],
    css: [...CONTENT_STYLE_FILES],
    run_at: "document_idle"
  }]);
  for (const change of [
    { permissions: [...baseline.permissions, "tabs"] },
    { optional_permissions: ["nativeMessaging"] },
    { host_permissions: [...baseline.host_permissions, "http://localhost/*"] },
    { content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }] },
    { web_accessible_resources: [{ resources: ["src/*"], matches: ["<all_urls>"] }] },
    { minimum_chrome_version: "140" },
    { options_ui: { page: "options.html" } },
    { background: { service_worker: "background.js" } }
  ]) assert.throws(() => assertProductionManifest({ ...production, ...change }, baseline));
});
