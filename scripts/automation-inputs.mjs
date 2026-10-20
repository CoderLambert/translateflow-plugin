import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { walkFiles, sourceClosure, runtimeAssetRoots } from "./wxt-assets.mjs";

// Actual runtime trees, root UI assets, locale and transitive build modules.
// Tests, reports, private config and automation tools do not enter this stamp.
export async function productionInputStamp(root = process.cwd()) {
  const files = new Set(["manifest.json","package.json","package-lock.json"]);
  for(const path of ["background.js","content.js","popup.js","popup.html","popup.css","options.js","options.html","options.css","content.css"])
    if(existsSync(resolve(root,path)))files.add(path);
  for(const dir of ["src","entrypoints","_locales"])for(const file of await walkFiles(resolve(root,dir)))files.add(relative(root,file).replaceAll("\\","/"));
  for(const file of await sourceClosure(["wxt.config.mjs","scripts/build-extension.mjs",...runtimeAssetRoots()],root))files.add(file);
  const inputs=[];
  for(const file of [...files].sort())inputs.push(`${file}\0${createHash("sha256").update(await readFile(resolve(root,file))).digest("hex")}`);
  return createHash("sha256").update(process.versions.node+"\n"+inputs.join("\n")).digest("hex");
}
