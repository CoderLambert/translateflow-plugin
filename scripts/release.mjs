#!/usr/bin/env node
// One command local release: validate -> stage -> bump+build -> commit -> push ->
// tag + GitHub Release with the zip -> verify the uploaded asset.
//
// Usage:
//   node scripts/release.mjs "fix: describe the change" [options]
//   npm run release -- "fix: describe the change"
//
// Options:
//   --skip-validate     skip `npm run validate` (check, node tests, typecheck, vitest, build)
//   --notes-file <path> use this markdown as the release notes
//   --no-commit         release the current HEAD without creating a version commit
//   --mirror            also push to the self-hosted mirror now (webhook does it otherwise)
//   --dry-run           do every read-only check and build the zip, change nothing
//   --yes               do not stop for confirmation
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((item) => item.startsWith("--")));
const value = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : null;
};
const message = argv.find((item) => !item.startsWith("--") && item !== value("notes-file")) ?? "";
const dryRun = flags.has("--dry-run");
const noCommit = flags.has("--no-commit");
const mirror = flags.has("--mirror");
const skipValidate = flags.has("--skip-validate");
const notesFile = value("notes-file");

const step = (text) => console.log(`\n=== ${text}`);
const run = async (command, args, options = {}) => {
  const result = await exec(command, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...options });
  if (options.echo !== false) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (output) console.log(output.split("\n").slice(-12).join("\n"));
  }
  return result.stdout?.trim() ?? "";
};
const git = (args, options) => run("git", args, options);
const fail = (text) => {
  console.error(`\nrelease aborted: ${text}`);
  process.exit(1);
};

// ---------------------------------------------------------------- preflight
step("preflight");
const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], { echo: false });
if (branch !== "main") fail(`current branch is ${branch}; releases must be built from main`);
await git(["fetch", "--quiet", "origin"], { echo: false });
const head = await git(["rev-parse", "HEAD"], { echo: false });
const behind = await git(["rev-list", "--count", `HEAD..origin/main`], { echo: false });
if (Number(behind) > 0) fail(`main is ${behind} commit(s) behind origin/main; pull first`);
const dirty = await git(["status", "--porcelain"], { echo: false });
if (noCommit && dirty) fail("--no-commit needs a clean working tree");
if (!noCommit && !message) fail('missing commit message, e.g. node scripts/release.mjs "fix: ..."');
if (!dryRun && !noCommit && !dirty) fail("nothing to release: stage or create changes first");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const current = pkg.version;
const [major, minor, patch] = current.split(".").map(Number);
const predicted = noCommit ? current : `${major}.${minor}.${patch + 1}`;
for (const ref of [`refs/tags/v${predicted}`]) {
  const exists = await git(["rev-parse", "--verify", "--quiet", ref], { echo: false }).catch(() => "");
  if (exists) fail(`tag ${ref.replace("refs/tags/", "")} already exists`);
}
if (!noCommit && await git(["ls-remote", "--tags", "origin", `v${predicted}`], { echo: false })) fail(`tag v${predicted} already exists on origin`);
console.log(`branch ${branch} · HEAD ${head.slice(0, 8)} · current version ${current} · next version ${predicted}`);

// ---------------------------------------------------------------- validate
if (skipValidate) {
  step("validate (skipped)");
} else {
  step("validate: npm run validate");
  if (dryRun) console.log("(dry-run) would run npm run validate");
  else await run("npm", ["run", "validate"]);
}

// ------------------------------------------------- stage + version + build
if (!noCommit) {
  step("stage changes");
  if (dryRun) console.log((await git(["status", "--porcelain"], { echo: false })) || "(clean)");
  else {
    await git(["add", "-A"]);
    const staged = await git(["diff", "--cached", "--stat"], { echo: false });
    if (!staged) fail("nothing staged after git add -A");
    console.log(staged);
  }

  step(`version ${predicted} + build (scripts/prepare-versioned-commit.mjs)`);
  if (dryRun) console.log("(dry-run) would bump version files and rebuild dist/extension from the index snapshot");
  else await run("node", ["scripts/prepare-versioned-commit.mjs"]);
} else {
  step("commit (skipped: --no-commit)");
  if (skipValidate) {
    if (dryRun) console.log("(dry-run) would rebuild dist/extension so the zip matches HEAD");
    else await run("npm", ["run", "build:extension:release"]);
  }
}

// After the real prepare step the staged version is authoritative (it may carry a
// manual minor/major bump); a dry run can only predict the patch increment.
const version = noCommit ? current : dryRun ? predicted : JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const builtManifest = JSON.parse(readFileSync(join(ROOT, "dist/extension/manifest.json"), "utf8"));
if (!dryRun && builtManifest.version !== version) fail(`dist/extension/manifest.json is ${builtManifest.version}, expected ${version}`);
console.log(dryRun
  ? `dry-run: current package ${current}, current dist/extension ${builtManifest.version}; would release ${version}`
  : `package ${version} · dist/extension ${builtManifest.version}`);

// ---------------------------------------------------------------- commit + push
if (!noCommit) {
  step("commit");
  if (dryRun) console.log(`(dry-run) would commit with: ${message}`);
  else {
    await git(["commit", "-q", "-m", message]);
    console.log(`committed ${(await git(["rev-parse", "HEAD"], { echo: false })).slice(0, 8)}`);
  }
}

step("push main");
const shaAfterCommit = dryRun ? head : await git(["rev-parse", "HEAD"], { echo: false });
if (dryRun) console.log(`(dry-run) would push ${shaAfterCommit.slice(0, 8)} to origin/main`);
else await run("git", ["push", "origin", "main"]);

// ---------------------------------------------------------------- package zip
step(`package zip for v${version}`);
const zipPath = join(ROOT, "dist", `translateflow-${version}-chrome.zip`);
if (dryRun) {
  console.log(`(dry-run) would zip dist/extension into ${zipPath}`);
} else {
  rmSync(zipPath, { force: true });
  await exec("zip", ["-qrX", zipPath, ".", "-x", ".*", "-x", "*/.*"], { cwd: join(ROOT, "dist/extension") });
  const bytes = readFileSync(zipPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  console.log(`${zipPath.split("/").pop()} · ${(bytes.length / 1024).toFixed(1)} KiB · sha256 ${sha256}`);
}

// ---------------------------------------------------------------- release
step(`GitHub Release v${version}`);
const previousTag = await git(["describe", "--tags", "--abbrev=0", "--match", "v*"], { echo: false }).catch(() => "");
const generatedNotes = [
  "## 安装",
  "",
  "下载下方 `translateflow-" + version + "-chrome.zip`，解压后在 `chrome://extensions/` 开启开发者模式并「加载已解压的扩展程序」。",
  "",
  previousTag ? `## 变更（${previousTag} → v${version}）` : "## 变更",
  "",
  (await git(["log", "--no-merges", "--format=- %s", previousTag ? `${previousTag}..HEAD` : "-20"], { echo: false })) || "- 初始发布",
].join("\n");
const notesPath = notesFile ? resolve(ROOT, notesFile) : join(mkdtempSync(join(tmpdir(), "tf-notes-")), "notes.md");
if (!notesFile) writeFileSync(notesPath, generatedNotes + "\n");
if (dryRun) {
  console.log(`(dry-run) would create tag v${version} on ${shaAfterCommit.slice(0, 8)} with notes from ${notesFile ? notesFile : "generated log"}`);
} else {
  await run("gh", ["release", "create", `v${version}`, "--target", shaAfterCommit, "--title", `TranslateFlow v${version}`, "--notes-file", notesPath, zipPath]);
}

// ---------------------------------------------------------------- verify
if (!dryRun) {
  step("verify uploaded asset");
  const info = JSON.parse(await run("gh", ["release", "view", `v${version}`, "--json", "assets,url,tagName"], { echo: false }));
  const asset = info.assets?.find((item) => item.name.endsWith(".zip"));
  if (!asset) fail("release has no zip asset");
  const local = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
  const remote = String(asset.digest || "").replace("sha256:", "");
  if (remote && remote !== local) fail(`asset digest ${remote} != local ${local}`);
  console.log(`${info.url}\n${asset.name} · ${(asset.size / 1024).toFixed(1)} KiB · digest ${remote || "not reported"}`);

  if (mirror) {
    step("publish to the self-hosted mirror now");
    await run("node", ["scripts/publish-mirror.mjs", "--zip", zipPath, "--version", version, "--public-base", "https://git.lambert.host/translateflow"]);
  } else {
    console.log("mirror: the GitHub webhook triggers the server sync; watch it with");
    console.log("  ssh tencent 'sudo journalctl -u translateflow-mirror-sync.service -n 20 --no-pager'");
  }
  console.log("\nmirror URLs: https://git.lambert.host/translateflow/");
}

console.log(`\nrelease v${version} ${dryRun ? "(dry-run, nothing changed)" : "done"}`);
