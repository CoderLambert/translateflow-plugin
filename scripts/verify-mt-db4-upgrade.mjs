import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// A skipped test or missing actual artifact cannot satisfy the upgrade gate.
const old = process.env.TF_DB4_OLD_ARTIFACT, current = process.env.TF_DB4_NEW_ARTIFACT;
if (!old || !current) {
  console.error("BLOCKED: TF_DB4_OLD_ARTIFACT and TF_DB4_NEW_ARTIFACT must point to real WXT packages.");
  process.exit(2);
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 21) {
  console.error("BLOCKED: Node >=24.21 and <25 is required; have " + process.version);
  process.exit(2);
}
async function manifest(path) {
  const data = JSON.parse(await readFile(join(resolve(path), "manifest.json"), "utf8"));
  if (data.manifest_version !== 3 || !data.background?.service_worker) throw Error("Not a WXT MV3 package: " + path);
  return data;
}
try {
  const [before, after] = await Promise.all([manifest(old),manifest(current)]);
  if (before.version.localeCompare(after.version,"en",{numeric:true}) > 0)
    throw Error("New version must not be lower than old version");
  if (before.version === after.version)
    console.log("NOTE: equal version => verified management reload only, not automatic store update.");
} catch (error) {
  console.error("BLOCKED: invalid artifact pair: " + error.message);
  process.exit(2);
}
const child = spawn(process.execPath,[
  "scripts/run-e2e.mjs","e2e/machine-translation-db4-upgrade.spec.mjs","--workers=1","--retries=0"
], {env:{...process.env, TF_DB4_OLD_ARTIFACT:resolve(old),TF_DB4_NEW_ARTIFACT:resolve(current),
  TF_E2E_ARTIFACT:resolve(current),TF_I18N_ARTIFACT:resolve(current),TF_TEST_WORKERS:"1"},
  stdio:["inherit","pipe","inherit"]});
let log = "";
child.stdout.on("data",part => {
  const data=part.toString();process.stdout.write(data);log=(log+data).slice(-100000);
});
const exitCode=await new Promise(resolveExit=>{
  child.once("error",err=>{console.error(err.message);resolveExit(2)});
  child.once("close",code=>resolveExit(code??2));
});
if (exitCode!==0 || !/\[MT_DB4_SAME_ID_UPGRADE\].*"status":"PASS"/u.test(log)) {
  console.error("FAIL/NOT VERIFIED: missing successful Chromium same-ID DB4 upgrade evidence.");
  process.exit(exitCode||3);
}
console.log("PASS: same-ID real-package DB4 replacement. Store auto-update remains NOT VERIFIED.");
