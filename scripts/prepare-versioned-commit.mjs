#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, rm, cp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBuildOutputPaths } from "./path-boundaries.mjs";

const exec = promisify(execFile);
const VERSION_FILES = ["package.json", "package-lock.json", "manifest.json", "README.md"];
const run = async (root, args, input = undefined) => {
  if (input === undefined) return (await exec("git", args, { cwd: root })).stdout.trim();
  return new Promise((accept, reject) => {
    const child = execFile("git", args, { cwd: root }, (error, stdout) => error ? reject(error) : accept(stdout.trim()));
    child.stdin.end(input);
  });
};
function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  if (!match) throw new Error(`Expected numeric extension version, got ${value}`);
  const parts = match.slice(1).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part > 65535)) throw new Error("Extension version exceeds Chrome limits.");
  return parts;
}
export function nextCommitVersion(headVersion, stagedVersion) {
  const head = semver(headVersion), staged = semver(stagedVersion);
  for (let i = 0; i < 3; i++) {
    if (staged[i] > head[i]) return staged.join(".");
    if (staged[i] < head[i]) throw new Error("Staged extension version is older than HEAD.");
  }
  if (head[2] === 65535) throw new Error("Patch version is exhausted; explicitly choose a new minor version.");
  return `${head[0]}.${head[1]}.${head[2] + 1}`;
}
export function versionedJson(path, text, version) {
  if (path === "README.md") {
    if (!/^# TranslateFlow v[0-9.]+$/m.test(text)) throw new Error("README has no version heading.");
    return text.replace(/^# TranslateFlow v[0-9.]+$/m, `# TranslateFlow v${version}`);
  }
  const parsed = JSON.parse(text);
  if (typeof parsed.version !== "string") throw new Error(`${path} has no root version.`);
  const count = path === "package-lock.json" ? 2 : 1;
  let replaced = 0;
  const result = text.replace(/("version"\s*:\s*")[^"]*(")/g, (match, before, after) => ++replaced <= count ? `${before}${version}${after}` : match);
  const updated = JSON.parse(result);
  if (updated.version !== version || (path === "package-lock.json" && updated.packages?.[""]?.version !== version)) throw new Error(`Unexpected version layout in ${path}.`);
  return result;
}
async function buildSnapshot(snapshot, root) {
  await symlink(resolve(root, "node_modules"), join(snapshot, "node_modules"), "dir");
  const result = await exec(process.execPath, [join(snapshot, "scripts/build-extension.mjs")], { cwd: snapshot, maxBuffer: 4 * 1024 * 1024 });
  if (result.stderr) process.stderr.write(result.stderr);
}
// Build a copy of the exact index, then change only version fields in the real
// index/worktree. Unstaged source/package edits never enter the commit or build.
export async function prepareVersionedCommit({ root, preview = false, build = buildSnapshot } = {}) {
  root = resolve(root || process.cwd());
  const initialTree = await run(root, ["write-tree"]);
  const snapshot = await mkdtemp(join(tmpdir(), "tf-versioned-commit-"));
  try {
    await run(root, ["checkout-index", "--all", `--prefix=${snapshot}/`]);
    const stagedPackage = JSON.parse(await readFile(join(snapshot, "package.json"), "utf8"));
    const headPackage = JSON.parse(await run(root, ["show", "HEAD:package.json"]));
    const version = nextCommitVersion(headPackage.version, stagedPackage.version);
    const indexFiles = new Map(), worktreeFiles = new Map(), originalWorktree = new Map();
    for (const path of VERSION_FILES) {
      const staged = await readFile(join(snapshot, path), "utf8");
      const original = await readFile(join(root, path), "utf8");
      if (path !== "README.md" && ![headPackage.version, stagedPackage.version, version].includes(JSON.parse(original).version)) throw new Error(`Stage the manual version change in ${path} before committing.`);
      indexFiles.set(path, versionedJson(path, staged, version));
      worktreeFiles.set(path, versionedJson(path, original, version)); originalWorktree.set(path, original);
      await writeFile(join(snapshot, path), indexFiles.get(path));
    }
    console.log(`TranslateFlow: build staged snapshot at version ${version}${preview ? " (preview)" : ""}`);
    await build(snapshot, root);
    if (await run(root, ["write-tree"]) !== initialTree) throw new Error("The index changed during compilation. Retry the commit.");
    for (const path of VERSION_FILES) if (await readFile(join(root, path), "utf8") !== originalWorktree.get(path)) throw new Error(`${path} changed during compilation. Retry the commit.`);
    if (preview) return { version, preview: true, tree: initialTree };
    // Validate the install destination before changing the index or any user file.
    const output = await assertBuildOutputPaths(root, resolve(root, "dist/extension"));
    const oldEntries = new Map();
    try {
      for (const path of VERSION_FILES) {
        const entry = await run(root, ["ls-files", "--stage", "--", path]);
        const match = /^(\d+) ([a-f0-9]+) 0\t/.exec(entry);
        if (!match) throw new Error(`Expected one staged file for ${path}.`);
        oldEntries.set(path, match);
        const hash = await run(root, ["hash-object", "-w", "--stdin"], indexFiles.get(path));
        await run(root, ["update-index", "--cacheinfo", match[1], hash, path]);
        await writeFile(join(root, path), worktreeFiles.get(path));
      }
      await assertBuildOutputPaths(root, output);
      await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
      await cp(join(snapshot, "dist/extension"), output, { recursive: true });
    } catch (error) {
      for (const [path, entry] of oldEntries) {
        await run(root, ["update-index", "--cacheinfo", entry[1], entry[2], path]);
        await writeFile(join(root, path), originalWorktree.get(path));
      }
      throw error;
    }
    return { version, tree: await run(root, ["write-tree"]), output };
  } finally { await rm(snapshot, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareVersionedCommit({ preview: process.argv.includes("--preview") }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(`TranslateFlow commit preparation failed: ${error.message}`); process.exitCode = 1; });
}
