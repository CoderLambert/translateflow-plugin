import { mkdtemp, readFile, writeFile, realpath, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathRelation } from "./path-boundaries.mjs";
import { prepareExtensionTestCopy } from "../e2e/support/production-artifact.mjs";

// Keep the unpacked extension path stable across campaign runs, so the private
// profile retains its extension ID, dictionaries and already-downloaded models.
export async function prepareAutomationArtifact(config, campaign, baseUrl) {
  const pointer = join(campaign,"extension-location.json");
  let root;
  if(existsSync(pointer)) {
    ({root}=JSON.parse(await readFile(pointer,"utf8")));
    if(pathRelation(tmpdir(),root)!=="descendant" || await realpath(root)!==root ||
      JSON.parse(await readFile(join(root,"owner.json"),"utf8")).campaignId!==config.campaignId) throw new Error("Unsafe private test-copy location");
  } else {
    root=await mkdtemp(join(tmpdir(),"translateflow-e2e-automation-"));
    await writeFile(join(root,"owner.json"),JSON.stringify({campaignId:config.campaignId}));
    await writeFile(pointer,JSON.stringify({root}),{mode:0o600});
  }
  const extensionDir=join(root,"extension"), staged=join(root,`candidate-${Date.now()}`);
  const artifact=await prepareExtensionTestCopy({artifact:config.artifact,extensionDir:staged,baseUrl});
  const backup=join(root,`previous-${Date.now()}`);
  const previous=existsSync(extensionDir);
  if(previous) await rename(extensionDir,backup);
  try {await rename(staged,extensionDir);}
  catch(error){if(previous)await rename(backup,extensionDir);throw error;}
  if(previous)await rm(backup,{recursive:true});
  return {extensionDir,artifact};
}
