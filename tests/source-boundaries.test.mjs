import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const check = fileURLToPath(new URL("../scripts/check.mjs", import.meta.url));
const manifest = { manifest_version: 3, background: { service_worker: "background.js", type: "module" } };
function runFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "translateflow-architecture-"));
  try {
    const all = { "package.json": '{"type":"module"}', "manifest.json": JSON.stringify(manifest), "background.js": "", "content.js": "", ...files };
    for (const [path, code] of Object.entries(all)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), code);
    }
    const result = spawnSync(process.execPath, [check, "--root", root], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.error, undefined);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("CLI accepts approved TS UI and a pure JS/TS adapter, and excludes generated roots only", () => {
  const result = runFixture({
    "src/learning-center/View.tsx": 'import {useState} from "react"; export const View=()=>{const [x]=useState(false);return <button>{String(x)}</button>};',
    "src/shared/text.js": 'export const normalize = (value) => String(value);',
    "src/platform/adapter.ts": 'import {normalize} from "../shared/text.js"; export const normalizeUnknown = (value: unknown): string => normalize(value);',
    ".output/chrome-mv3/bad.ts": 'import "unapproved-package"; syntax !!!',
    ".wxt/bad.ts": "syntax !!!", "dist/bad.js": "syntax !!!"
  });
  assert.equal(result.status, 0, result.output);
});

const negatives = [
  ["Content fetch TS", { "src/content/bad.ts": 'globalThis["fetch"]("https://invalid.test");' }, /直接使用 fetch/u],
  ["Content fetch alias", { "src/content/bad.js": 'const request = globalThis.fetch; request("https://invalid.test");' }, /直接使用 fetch/u],
  ["Content IDB TS", { "src/content/bad.ts": 'globalThis["indexedDB"].open("illegal");' }, /IndexedDB/u],
  ["Content ESM", { "src/content/bad.ts": 'export const value = 1;' }, /classic Content/u],
  ["Content dynamic import", { "src/content/bad.js": 'import("../shared/ok.js");', "src/shared/ok.js": "export const value=1;" }, /classic Content/u],
  ["shared browser global", { "src/shared/bad.ts": 'globalThis["browser"].storage.local.get();' }, /shared 层/u],
  ["shared chrome alias", { "src/shared/bad.js": 'const {chrome: api} = globalThis; api.storage.local.get();' }, /shared 层/u],
  ["unauthorized registration", { "src/platform/bad.ts": 'chrome.scripting["registerContentScripts"]([]);' }, /注册动态/u],
  ["background React", { "src/background/bad.ts": 'import React from "react"; export const value=React;' }, /React\/JSX/u],
  ["Worker React", { "src/options/workers/bad.ts": 'import "react-dom/client";' }, /React\/JSX/u],
  ["shared React", { "src/shared/bad.ts": 'import "react";' }, /React\/JSX/u],
  ["indirect background React", { "src/background/bad.ts": 'import "../learning-center/View";', "src/learning-center/View.tsx": 'import "react"; export const View=()=> <div/>;' }, /bad\.ts → src\/learning-center/u],
  ["indirect Worker React", { "src/options/workers/bad.ts": 'import "../../learning-center/View";', "src/learning-center/View.tsx": 'import "react"; export const View=()=> <div/>;' }, /bad\.ts → src\/learning-center/u],
  ["indirect shared React", { "src/shared/bad.ts": 'import "../learning-center/View";', "src/learning-center/View.tsx": 'import "react"; export const View=()=> <div/>;' }, /bad\.ts → src\/learning-center/u],
  ["dynamic Worker React", { "src/options/workers/bad.ts": 'import("react");' }, /React\/JSX/u],
  ["computed runtime import", { "src/platform/bad.ts": 'const path="./x"; import(path);' }, /无法审计/u],
  ["unknown runtime dependency", { "src/learning-center/bad.ts": 'import "unapproved-package";' }, /未批准/u],
  ["unknown implicit JSX dependency", { "src/learning-center/bad.tsx": '/** @jsxImportSource unapproved-package */\nexport const view=<div/>;' }, /未批准.*unapproved-package\/jsx-runtime/u],
  ["runtime test import", { "src/platform/bad.ts": 'import "../../tests/helper.js";', "tests/helper.js": "export const value=1;" }, /非 runtime/u],
  ["TS outside compiler include", { "src/new-area/bad.ts": 'indexedDB.open("illegal");' }, /IndexedDB/u],
  ["nested generated-name source", { "src/dist/bad.ts": 'fetch("https://invalid.test");' }, /直接使用 fetch/u],
  ["MAIN observer initiates fetch", { "src/content/subtitles/youtube-main-bridge.js": 'page.fetch("https://invalid.test");' }, /MAIN observer/u],
  ["indirect shared API", { "src/shared/bad.ts": 'import "../background/api.js";', "src/background/api.js": 'chrome.runtime.getURL("x");' }, /shared 层/u],
  ["non-UI JSX implicit React", { "src/background/bad.tsx": 'export const view = <div/>;' }, /React\/JSX/u],
  ["source TS syntax", { "src/platform/bad.ts": 'const value: = 1;' }, /syntax/u]
];
for (const [name, files, expected] of negatives) test(`CLI rejects ${name} with exit 1`, () => {
  const result = runFixture(files);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, expected);
});

test("strict typecheck command rejects an actual type error", () => {
  const root = mkdtempSync(join(tmpdir(), "translateflow-type-error-"));
  try {
    writeFileSync(join(root, "bad.ts"), 'const value: string = 42;\nexport {value};\n');
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: fileURLToPath(new URL("../tsconfig.json", import.meta.url)), compilerOptions: { types: [] }, include: ["bad.ts"] }));
    const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
    const result = spawnSync(process.execPath, [tsc, "--project", join(root, "tsconfig.json"), "--noEmit"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Type 'number' is not assignable to type 'string'/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("strict typecheck also checks local declaration files", () => {
  const root = mkdtempSync(join(tmpdir(), "translateflow-declaration-error-"));
  try {
    writeFileSync(join(root, "bad.d.ts"), "declare const value: UnknownContractType;\n");
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ extends: fileURLToPath(new URL("../tsconfig.json", import.meta.url)), compilerOptions: { types: [] }, include: ["bad.d.ts"] }));
    const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
    const result = spawnSync(process.execPath, [tsc, "--project", join(root, "tsconfig.json"), "--noEmit"], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Cannot find name 'UnknownContractType'/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("unknown Reading DTO with caller-declared scope is rejected by the existing validator CLI", () => {
  const dto = new URL("../src/shared/reading/dto.js", import.meta.url).href;
  const code = `import {validateReadingRequest} from ${JSON.stringify(dto)}; validateReadingRequest({schemaVersion:1,method:"reading.get-recording-state",scope:"extension"});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ReadingContractError/u);
  assert.match(result.stderr, /READING_BAD_DTO/u);
});
