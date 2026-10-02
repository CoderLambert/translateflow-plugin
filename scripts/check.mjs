import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSources, SOURCE_EXTENSION } from "./source-boundaries.mjs";

// --root runs the identical checks on isolated positive/negative fixture projects.
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--root")) throw new Error("Usage: check.mjs [--root directory]");
const root = args.length ? resolve(args[1]) : fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const ignored = new Set([".git", "node_modules"]);
const generatedRootDirs = new Set([".wxt", ".output", "dist"]);
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (ignored.has(name) || (dir === root && generatedRootDirs.has(name))) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}
const sourceFiles = walk(root).filter((file) => SOURCE_EXTENSION.test(file));
for (const file of sourceFiles.filter((file) => /\.[cm]?js$/u.test(file))) {
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); }
  catch (error) { failures.push(`语法检查失败: ${relative(root, file)}\n${error.stderr?.toString() || error.message}`); }
}
failures.push(...inspectSources(root, sourceFiles));
try {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) failures.push("manifest_version 必须保持为 3");
  if (manifest.background?.service_worker !== "background.js") failures.push("后台入口必须保持为 background.js");
  if (manifest.background?.type !== "module") failures.push("background service worker 必须使用 ES module");
} catch (error) { failures.push(`manifest.json 无法解析: ${error.message}`); }
for (const [entry, maxLines] of [["background.js", 20], ["content.js", 180]]) {
  const path = join(root, entry);
  if (!existsSync(path)) { failures.push(`缺少入口文件 ${entry}`); continue; }
  const lines = readFileSync(path, "utf8").split(/\r?\n/u).length;
  if (lines > maxLines) failures.push(`${entry} 为入口文件，限制 ${maxLines} 行，当前 ${lines} 行`);
}
if (existsSync(join(root, "cache-db.js"))) failures.push("根目录 cache-db.js 已废弃；请使用 src/background/cache-db.js");
if (failures.length) {
  console.error(`TranslateFlow project checks failed (${failures.length}):\n${failures.map((failure, index) => `${index + 1}. ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`OK: ${sourceFiles.length} JS/TS/TSX source files passed syntax and architecture checks.`);
