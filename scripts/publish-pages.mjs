// Explicitly invoked publication only; no automatic pushes from install/build hooks.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPages } from "./build-pages.mjs";

assert(process.argv.includes("--publish") && process.argv.slice(2).every(arg => arg === "--publish"), "Publish only with: node scripts/publish-pages.mjs --publish");
const REPO = "repos/CoderLambert/translateflow-plugin", branch = "gh-pages";
function api(path, body, method = body ? "POST" : "GET", missing = false) {
  const result = spawnSync("gh", ["api", "--method", method, `${REPO}/${path}`, ...(body ? ["--input", "-"] : [])], {
    input: body ? JSON.stringify(body) : undefined, encoding: "utf8", maxBuffer: 2 * 1024 * 1024
  });
  if (result.status !== 0) {
    if (missing && result.stderr.includes("HTTP 404")) return null;
    throw new Error(`GitHub ${method} ${path}: ${result.stderr}`);
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}
const site = await buildPages();
const prior = api(`git/ref/heads/${branch}`, undefined, "GET", true);
const tree = [];
for (const path of site.files) {
  const content = await readFile(resolve(site.output, path));
  const blob = api("git/blobs", { content: content.toString("base64"), encoding: "base64" });
  tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
}
const createdTree = api("git/trees", { tree });
const commit = api("git/commits", { message: "Publish TranslateFlow privacy and support site", tree: createdTree.sha, parents: prior ? [prior.object.sha] : [] });
if (prior) api(`git/refs/heads/${branch}`, { sha: commit.sha, force: false }, "PATCH");
else api("git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha });
let pages = api("pages", undefined, "GET", true);
if (!pages) pages = api("pages", { source: { branch, path: "/" }, build_type: "legacy" });
else {
  assert(pages.source?.branch === branch && pages.source?.path === "/", "Existing Pages source differs; do not replace it automatically");
}
// github.io starts with HTTPS enforcement; a new certificate can still be provisioning.
// Only change this setting if the API reports enforcement disabled.
if (!pages.https_enforced) {
  const fresh = api("pages");
  if (!fresh.https_enforced) api("pages", { https_enforced: true }, "PUT");
}
const result = { url: pages.html_url || site.url, branch, commit: commit.sha, files: site.files };
await writeFile(resolve(site.output, "deployment.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
