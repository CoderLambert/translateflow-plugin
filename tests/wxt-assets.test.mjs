import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { assertAssetPath, isInsideSourceRoot, legacyAssetRoots, sourceClosure, lexicalAssetFiles } from "../scripts/wxt-assets.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";
import { YOUTUBE_MAIN_BRIDGE_FILES as runtimeMain } from "../src/background/youtube-bridge.js";
import { assertProductionManifest } from "../scripts/audit-wxt-extension.mjs";

test("raw bridge follows runtime registration order and existing stable paths", async () => {
  const roots = legacyAssetRoots();
  assert.deepEqual(roots.slice(0, CONTENT_SCRIPT_FILES.length), [...CONTENT_SCRIPT_FILES]);
  assert.deepEqual(roots.slice(CONTENT_SCRIPT_FILES.length, CONTENT_SCRIPT_FILES.length + CONTENT_STYLE_FILES.length), [...CONTENT_STYLE_FILES]);
  assert.strictEqual(runtimeMain, YOUTUBE_MAIN_BRIDGE_FILES);
  assert.deepEqual(EXTENSION_PAGES, { popup: "popup.html", options: "options.html", learningCenter: "learning-center.html" });
  const files = await sourceClosure(roots);
  for (const path of Object.values(WORKER_PATHS)) assert(files.includes(path));
  assert(files.includes("src/background/packs/importers/mdict-rich.js"));
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

test("development missing dictionaries are explicit; release is fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "tf-wxt-lexical-"));
  try {
    const result = await lexicalAssetFiles({ root });
    assert.equal(result.missing.length, 2);
    assert.deepEqual(result.files, []);
    await assert.rejects(lexicalAssetFiles({ root, requireLexicon: true }), /requires generated packs/u);
    await mkdir(join(root, "assets/lexicon/core"), { recursive: true });
    await writeFile(join(root, "assets/lexicon/core/manifest.json"), JSON.stringify({ format: "tflex", files: [{ path: "../../../private" }] }));
    await assert.rejects(lexicalAssetFiles({ root }), /Unsafe runtime asset path/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generated dictionaries copy only authenticated runtime descriptors, excluding stray source locks", async () => {
  const root = await mkdtemp(join(tmpdir(), "tf-wxt-valid-pack-"));
  const outside = await mkdtemp(join(tmpdir(), "tf-wxt-lexical-outside-"));
  try {
    const pack = join(root, "assets/lexicon/core");
    await cp(new URL("./fixtures/tflex-runtime-pack", import.meta.url), pack, { recursive: true });
    await writeFile(join(pack, "source-lock.json"), "private input never copied");
    const files = await lexicalAssetFiles({ root });
    assert.equal(files.files.length, 4);
    assert(!files.files.some((path) => path.includes("source-lock")));
    const shard = join(pack, "shards/0000.jsonl");
    await cp(shard, join(outside, "private.jsonl"));
    await rm(shard);
    await symlink(join(outside, "private.jsonl"), shard);
    await assert.rejects(lexicalAssetFiles({ root }), /escapes source root/u);
    await rm(shard);
    await writeFile(join(pack, "shards/0000.jsonl"), "corrupt");
    await assert.rejects(lexicalAssetFiles({ root }), /size mismatch|hash mismatch/u);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("production Manifest fails closed for permissions, static injection and development changes", async () => {
  const baseline = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assertProductionManifest(structuredClone(baseline), baseline);
  for (const change of [
    { permissions: [...baseline.permissions, "tabs"] },
    { host_permissions: [...baseline.host_permissions, "http://localhost/*"] },
    { content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }] },
    { web_accessible_resources: [{ resources: ["src/*"], matches: ["<all_urls>"] }] },
    { minimum_chrome_version: "140" },
    { options_ui: { page: "options.html" } },
    { background: { service_worker: "background.js" } }
  ]) assert.throws(() => assertProductionManifest({ ...baseline, ...change }, baseline));
});
