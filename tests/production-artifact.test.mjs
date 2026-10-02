import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { copyProductionArtifact, inventoryArtifact } from "../e2e/support/production-artifact.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../src/shared/runtime-assets.js";

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
    await assert.rejects(copyProductionArtifact(artifact,artifact),/must be isolated/);
    await assert.rejects(copyProductionArtifact(artifact,join(artifact,"copy")),/must be isolated/);
    await assert.rejects(copyProductionArtifact(artifact,join(root,"copy")),/already exists|EEXIST/);
  } finally {await rm(root,{recursive:true,force:true});}
});
