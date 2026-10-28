import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { legalAssets } from "./legal-assets.mjs";
import { BRAND_ICONS, LEGAL_ASSETS } from "../src/shared/runtime-assets.js";

export const PAGES_URL = "https://coderlambert.github.io/translateflow-plugin/";
export const PAGES_FILES = Object.freeze(["index.html", "demo.html", "privacy.html", "privacy-zh-CN.html", "support.html", "third-party.txt", "icon.png", "site-manifest.json", ".nojekyll"]);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function buildPages(root = ROOT) {
  await legalAssets({ root });
  const out = resolve(root, "dist/pages");
  await mkdir(out, { recursive: true });
  const style = `:root{color-scheme:light dark;font:16px/1.7 system-ui,sans-serif;background:#f6f3ec;color:#29372d}body{max-width:940px;margin:0 auto;padding:56px 24px}header{display:flex;align-items:center;gap:14px}header img{border-radius:14px}h1{font-size:30px;margin:0}p{color:#637065}h2{font-size:19px;margin:0 0 7px}main{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:32px 0}article{border:1px solid #dcded4;border-radius:14px;padding:24px;background:#fcfaf5}article p{margin:0 0 18px;font-size:14px}a{color:#416e4c;text-underline-offset:4px}a:focus-visible{outline:2px solid;outline-offset:4px}footer{font-size:13px;border-top:1px solid #dcded4;padding-top:20px}@media(max-width:640px){body{padding:28px 18px}main{grid-template-columns:1fr}h1{font-size:25px}}@media(prefers-color-scheme:dark){:root{color:#e0e7df;background:#202820}article{background:#273128;border-color:#465345}p{color:#aebcaf}a{color:#accbaa}footer{border-color:#465345}}`;
  const home = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="description" content="TranslateFlow 隐私政策、帮助与反馈 / Privacy, support and third-party licenses"><link rel="icon" href="icon.png"><title>TranslateFlow · 隐私与支持</title><style>${style}</style></head><body><header><img src="icon.png" alt="" width="56" height="56"><h1>TranslateFlow</h1></header><p>翻译与理解外语内容，让服务和数据由你选择。<br>Translate and understand foreign-language content, with control over your services and data.</p><main><article><h2>隐私政策 · Privacy</h2><p>了解哪些内容会发送给翻译服务、哪些数据保留在本机，以及如何管理和删除。<br>What is sent, what stays on your device, and how to manage your data.</p><a href="privacy-zh-CN.html" lang="zh-CN">阅读中文政策</a> · <a href="privacy.html" lang="en">Read in English</a></article><article><h2>帮助与反馈 · Support</h2><p>从常见恢复步骤开始；反馈前请移除密钥和个人内容。<br>Recovery steps and safe ways to report a problem.</p><a href="support.html">查看支持说明 / Get help</a></article><article><h2>第三方许可 · Licenses</h2><p>扩展所用开源组件的许可与版权声明。<br>License and copyright notices for open-source components.</p><a href="third-party.txt">查看许可 / View notices</a></article><article><h2>项目 · Project</h2><p>完整操作指引在扩展设置 → 使用文档。公开版不包含实验性的 ChatGPT 订阅本地连接。<br>Find the user guide in extension settings. The public edition excludes the experimental ChatGPT subscription connection.</p><a href="https://github.com/CoderLambert/translateflow-plugin" rel="noopener noreferrer">GitHub</a></article></main><footer><p>本站不使用分析脚本、表单或追踪工具。托管服务 GitHub Pages 可能处理 IP 地址及请求日志，见 <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener noreferrer">GitHub 隐私声明</a>。<br>This site has no analytics, forms or trackers. GitHub Pages may process IP addresses and request logs under its privacy statement.</p></footer></body></html>\n`;
  await writeFile(resolve(out, "index.html"), home);
  const demo = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>A calmer way to read · TranslateFlow demo</title><style>body{font:18px/1.8 system-ui,sans-serif;color:#29372d;background:#f7f4ed;max-width:760px;margin:55px auto;padding:0 28px}h1{font-size:36px;line-height:1.25;letter-spacing:-.025em}p{margin:24px 0}small,a{font-size:13px;color:#557b52}article{background:#fcfaf5;border:1px solid #e1e3d9;border-radius:18px;padding:28px 34px}.abt-translation{font-size:16px}footer{margin-top:24px}</style></head><body><small>TranslateFlow · Public reading example</small><article><h1>A calmer way to read on the web</h1><p>Learning a language does not mean stopping at every unfamiliar word. Read a short passage first, notice the main idea, and return to the details that matter.</p><p>A bilingual view can make this easier. Keep the original nearby, compare the meaning, and use a dictionary when a single word deserves a closer look.</p><p>Choose your translation service thoughtfully. Save useful results, take breaks, and keep control of the text you share.</p></article><footer><a href="index.html">Privacy and support</a><br><small>Original demonstration text written for TranslateFlow. This page has no analytics or scripts.</small></footer></body></html>\n`;
  await writeFile(resolve(out, "demo.html"), demo);
  for (const [source, target] of [[LEGAL_ASSETS.privacyEn, "privacy.html"], [LEGAL_ASSETS.privacyZh, "privacy-zh-CN.html"], [LEGAL_ASSETS.support, "support.html"]]) {
    const original = await readFile(resolve(root, source), "utf8");
    const html = original.replaceAll("privacy-en.html", "privacy.html").replaceAll("../licenses/third-party.txt", "third-party.txt")
      .replace("<body>", '<body><p><a href="index.html">← TranslateFlow</a></p>');
    assert(!/<script\b|<iframe\b/iu.test(html));
    await writeFile(resolve(out, target), html);
  }
  await copyFile(resolve(root, LEGAL_ASSETS.notices), resolve(out, "third-party.txt"));
  await copyFile(resolve(root, BRAND_ICONS[128]), resolve(out, "icon.png"));
  await writeFile(resolve(out, ".nojekyll"), "");
  const entries = [];
  for (const path of PAGES_FILES.filter(path => path !== "site-manifest.json")) {
    const bytes = await readFile(resolve(out, path));
    entries.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(resolve(out, "site-manifest.json"), JSON.stringify({ project: "TranslateFlow", url: PAGES_URL, files: entries }, null, 2) + "\n");
  return { output: out, url: PAGES_URL, files: PAGES_FILES };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildPages()));
