import assert from "node:assert/strict";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import MarkdownIt from "markdown-it";
import { LEGAL_ASSETS } from "../src/shared/runtime-assets.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const markdown = new MarkdownIt({ html: false, linkify: false });
const documents = [
  ["docs/PRIVACY.md", LEGAL_ASSETS.privacyEn, "en", "Privacy policy"],
  ["docs/PRIVACY.zh-CN.md", LEGAL_ASSETS.privacyZh, "zh-CN", "隐私政策"],
  ["docs/SUPPORT.md", LEGAL_ASSETS.support, "zh-CN", "支持 / Support"]
];
const style = `:root{color-scheme:light dark;font:16px/1.8 system-ui,sans-serif;color:#29372d;background:#f7f4ed}body{max-width:900px;margin:40px auto;padding:0 24px 48px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}a{color:#416e4c}nav{display:flex;flex-wrap:wrap;gap:18px;font-size:14px}table{border-collapse:collapse;display:block;overflow:auto;font-size:14px}td,th{border:1px solid #d4d9cf;padding:10px;min-width:130px;text-align:left}code{overflow-wrap:anywhere}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}@media(prefers-color-scheme:dark){:root{color:#e0e7df;background:#202820}a{color:#accbaa}td,th{border-color:#465345}}@media(max-width:600px){body{margin-top:20px;padding:0 16px 32px}h1{font-size:24px}}`;
function documentHtml(source, lang, title) {
  return `<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>TranslateFlow · ${title}</title><style>${style}</style></head><body><nav aria-label="Documents"><a href="privacy-en.html">English privacy policy</a><a href="privacy-zh-CN.html">中文隐私政策</a><a href="support.html">支持 / Support</a><a href="../licenses/third-party.txt">Third-party licenses</a></nav><main>${markdown.render(source)}</main></body></html>\n`;
}

async function notices(root) {
  const seen = new Map();
  async function visit(name, parent = resolve(root, "package.json"), dependencies = true) {
    // Resolve from the parent package so nested dependency versions retain their own notices.
    const require = createRequire(parent);
    let path;
    for (const base of require.resolve.paths(name) || []) {
      try { await readFile(resolve(base, name, "package.json")); path = resolve(base, name); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    assert(path, `Cannot resolve license package: ${name}`);
    const pkg = JSON.parse(await readFile(resolve(path, "package.json"), "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    const files = (await readdir(path)).filter(file => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/iu.test(file)).sort();
    let license;
    if (files.length) license = (await Promise.all(files.map(file => readFile(resolve(path, file), "utf8")))).join("\n\n");
    else if (["wxt", "@wxt-dev/browser"].includes(name) && pkg.license === "MIT") {
      // npm packages omit LICENSE; upstream repository declares this MIT notice.
      license = "Source: https://github.com/wxt-dev/wxt/blob/main/LICENSE\n\n" + await readFile(resolve(root, "scripts/licenses/wxt-MIT.txt"), "utf8");
    } else throw new Error(`Missing license text: ${key}`);
    seen.set(key, license.trim());
    if (dependencies) for (const dependency of Object.keys(pkg.dependencies || {}).sort()) await visit(dependency, resolve(path, "package.json"));
  }
  for (const name of ["react", "react-dom", "markdown-it", "css-tree", "p-limit", "p-retry"]) await visit(name);
  // WXT runtime helpers are bundled; its CLI/build dependency tree is not distributed.
  for (const name of ["wxt", "@wxt-dev/browser"]) await visit(name, resolve(root, "package.json"), false);
  return "TranslateFlow third-party notices\nGenerated from installed runtime dependency families. Some submodules may be removed by bundling.\n\n" +
    [...seen].sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, license]) => `===== ${key} =====\n\n${license}\n`).join("\n");
}

export async function legalAssets({ root = ROOT, generate = false } = {}) {
  const assets = new Map();
  for (const [source, target, lang, title] of documents) assets.set(target, documentHtml(await readFile(resolve(root, source), "utf8"), lang, title));
  assets.set(LEGAL_ASSETS.notices, await notices(root));
  for (const [path, content] of assets) {
    if (generate) { await mkdir(dirname(resolve(root, path)), { recursive: true }); await writeFile(resolve(root, path), content); }
    assert.equal(await readFile(resolve(root, path), "utf8"), content, `Stale legal asset: run node scripts/legal-assets.mjs --generate (${path})`);
  }
  return [...assets.keys()];
}

export function assertNoticeCoverage(compiled, noticeText) {
  for (const item of compiled) for (const module of item.modules || []) {
    const matches = [...module.replaceAll("\\", "/").matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/gu)];
    const name = matches.at(-1)?.[1];
    if (name) assert(noticeText.includes(`===== ${name}@`), `Bundled package lacks a license notice: ${name}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.slice(2).every(arg => ["--generate", "--check"].includes(arg)), "Unknown legal-assets argument");
  console.log(JSON.stringify(await legalAssets({ generate: process.argv.includes("--generate") })));
}
