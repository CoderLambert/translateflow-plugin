import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { tmpdir } from "node:os";
import { assertIsolatedArtifactPaths, copyProductionArtifact, inventoryArtifact, prepareExtensionTestCopy } from "../e2e/support/production-artifact.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";

test("artifact isolation handles Windows separators without accepting same or nested paths", () => {
  for (const [api, source, sibling, child, parent] of [
    [win32, "C:\\repo\\.output\\chrome-mv3", "C:\\Temp\\tf-upgrade\\extension", "C:\\repo\\.output\\chrome-mv3\\copy", "C:\\repo\\.output"],
    [posix, "/repo/.output/chrome-mv3", "/tmp/tf-upgrade/extension", "/repo/.output/chrome-mv3/copy", "/repo/.output"]
  ]) {
    assert.doesNotThrow(() => assertIsolatedArtifactPaths(source, sibling, api));
    for (const unsafe of [source, child, parent]) assert.throws(() => assertIsolatedArtifactPaths(source, unsafe, api), /must be isolated/);
  }
  assert.doesNotThrow(() => assertIsolatedArtifactPaths("C:\\repo\\artifact", "D:\\fixture\\copy", win32));
  assert.doesNotThrow(() => assertIsolatedArtifactPaths("\\\\server\\share\\artifact", "\\\\server\\share\\temp\\copy", win32));
  assert.throws(() => assertIsolatedArtifactPaths("C:\\repo\\artifact", "c:\\REPO\\ARTIFACT", win32), /must be isolated/);
});

test("artifact adapter fails before augmenting missing production runtime; it never invokes a builder", async () => {
  const root=await mkdtemp(join(tmpdir(),"tf-artifact-contract-"));
  try {
    const artifact=join(root,"artifact"); await mkdir(artifact);
    await writeFile(join(artifact,"manifest.json"),JSON.stringify({manifest_version:3,background:{service_worker:"background.js"}}));
    await assert.rejects(copyProductionArtifact(artifact,join(root,"copy")),/lacks runtime mapping: background.js/);
    await assert.rejects(copyProductionArtifact(join(root,"missing"),join(root,"copy")),/ENOENT/);
    const source=await readFile(new URL("../e2e/support/production-artifact.mjs",import.meta.url),"utf8");
    assert.doesNotMatch(source,/buildExtension|build-extension\.mjs/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("adapter copies exact supplied bytes and records deterministic production provenance", async () => {
  const root=await mkdtemp(join(tmpdir(),"tf-artifact-provenance-"));
  try {
    const artifact=join(root,"artifact");
    const paths=new Set(["manifest.json","background.js",...Object.values(EXTENSION_PAGES),...CONTENT_SCRIPT_FILES,
      ...CONTENT_STYLE_FILES,...Object.values(WORKER_PATHS),...YOUTUBE_MAIN_BRIDGE_FILES]);
    for (const path of paths) { await mkdir(join(artifact,path,".."),{recursive:true});
      await writeFile(join(artifact,path), path==="manifest.json"
        ? JSON.stringify({manifest_version:3,background:{service_worker:"background.js"}}) : `supplied:${path}\n`); }
    const before=await inventoryArtifact(artifact);
    const copied=await copyProductionArtifact(artifact,join(root,"copy"));
    assert.equal(copied.treeSha256,before.treeSha256);
    assert.deepEqual(copied.files,before.files);
    assert.equal(copied.totalBytes,before.totalBytes);
    const foreign = join(root,"foreign-worktree");
    const keep = join(foreign,"fixture/assets/lexicon/keep");
    await mkdir(join(keep,".."),{recursive:true});
    await writeFile(join(foreign,".git"),"synthetic foreign worktree marker");
    await writeFile(keep,"foreign lexicon retained");
    const alias = join(root,"alias");
    await symlink(foreign,alias,process.platform==="win32"?"junction":"dir");
    for (const destination of [join(alias,"fixture"),join(foreign,"fixture")]) {
      await assert.rejects(prepareExtensionTestCopy({artifact,extensionDir:destination,baseUrl:"http://127.0.0.1:1"}),/symbolic link|another Git workspace/);
      assert.equal(await readFile(keep,"utf8"),"foreign lexicon retained");
    }
    await assert.rejects(copyProductionArtifact(artifact,artifact),/must be isolated/);
    await assert.rejects(copyProductionArtifact(artifact,join(artifact,"copy")),/must be isolated/);
    await assert.rejects(copyProductionArtifact(artifact,join(root,"copy")),/already exists|EEXIST/);
    await mkdir(join(artifact,"tests"));await writeFile(join(artifact,"tests","fixture.js"),"private build input");
    await assert.rejects(copyProductionArtifact(artifact,join(root,"bad-copy")),/Non-production artifact path/);
  } finally {await rm(root,{recursive:true,force:true});}
});
