import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const ignored = new Set([".git", "node_modules"]);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const jsFiles = walk(root).filter((file) => /\.(?:js|mjs)$/.test(file));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push(`语法检查失败: ${relative(root, file)}\n${error.stderr?.toString() || error.message}`);
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
} catch (error) {
  failures.push(`manifest.json 无法解析: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) failures.push("manifest_version 必须保持为 3");
  if (manifest.background?.service_worker !== "background.js") failures.push("后台入口必须保持为 background.js");
  if (manifest.background?.type !== "module") failures.push("background service worker 必须使用 ES module");
}

const sourceFiles = jsFiles.filter((file) => relative(root, file).split(sep)[0] === "src");
const allowedLocalFetchFiles = new Set(["src/background/lexical/package-assets.js"]);
for (const file of sourceFiles) {
  const rel = relative(root, file).replaceAll(sep, "/");
  const code = readFileSync(file, "utf8");
  const lineCount = code.split(/\r?\n/).length;
  if (lineCount > 420) failures.push(`${rel} 超过 420 行；请继续拆分职责`);

  if (rel.startsWith("src/shared/") && /\bchrome\./.test(code)) {
    failures.push(`${rel} 位于 shared 层，不允许依赖 chrome.* API`);
  }
  if (rel.startsWith("src/content/") && /^\s*(?:import|export)\s/m.test(code)) {
    failures.push(`${rel} 作为 build-free Content Script 模块，不允许使用 ESM import/export`);
  }
  if (/\bfetch\s*\(/.test(code) && !rel.startsWith("src/background/providers/") && !allowedLocalFetchFiles.has(rel)) {
    failures.push(`${rel} 直接使用 fetch；外部网络请求必须封装在 src/background/providers/，扩展包本地资源读取仅允许 lexical/package-assets.js`);
  }
  if (/\bindexedDB\b/.test(code) && rel !== "src/background/cache-db.js") {
    failures.push(`${rel} 直接访问 IndexedDB；缓存访问必须收口到 src/background/cache-db.js`);
  }
  if (/registerContentScripts\s*\(/.test(code) && rel !== "src/background/auto-sites.js") {
    failures.push(`${rel} 注册动态 Content Script；该职责必须收口到 src/background/auto-sites.js`);
  }
}

for (const [entry, maxLines] of [["background.js", 20], ["content.js", 180]]) {
  const path = join(root, entry);
  if (!existsSync(path)) {
    failures.push(`缺少入口文件 ${entry}`);
    continue;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/).length;
  if (lines > maxLines) failures.push(`${entry} 为入口文件，限制 ${maxLines} 行，当前 ${lines} 行`);
}

if (existsSync(join(root, "cache-db.js"))) {
  failures.push("根目录 cache-db.js 已废弃；请使用 src/background/cache-db.js");
}

if (failures.length) {
  console.error(`\nTranslateFlow project checks failed (${failures.length}):\n`);
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}\n`));
  process.exit(1);
}

console.log(`OK: ${jsFiles.length} JavaScript files passed syntax and architecture checks.`);
