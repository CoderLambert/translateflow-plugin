import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const check = fileURLToPath(new URL("../scripts/check.mjs", import.meta.url));
function run(files) {
  const root = mkdtempSync(join(tmpdir(), "translateflow-i18n-boundary-"));
  try {
    const project = { "package.json": '{"type":"module"}', "manifest.json": JSON.stringify({ manifest_version: 3, background: { service_worker: "background.js", type: "module" } }), "background.js": "", "content.js": "", ...files };
    for (const [path, text] of Object.entries(project)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = spawnSync(process.execPath, [check, "--root", root], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.error, undefined);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("i18n accepts pure Intl and rejects direct or transitive privileged effects", () => {
  const good = run({ "src/i18n/format.js": 'export const format=(value)=>new Intl.NumberFormat("en").format(value);' });
  assert.equal(good.status, 0, good.output);
  for (const files of [
    { "src/i18n/bad.js": 'const name="chrome";globalThis[name].storage.local.get();' },
    { "src/i18n/bad.js": 'import "../background/adapter.js";', "src/background/adapter.js": 'chrome.runtime.getURL("asset");' },
    { "src/i18n/bad.js": 'import "../background/cache-db.js";', "src/background/cache-db.js": 'indexedDB.open("cache");' },
    { "src/i18n/bad.js": 'import "../background/providers/adapter.js";', "src/background/providers/adapter.js": 'fetch("https://invalid.test");' }
  ]) {
    const bad = run(files);
    assert.equal(bad.status, 1, bad.output);
    assert.match(bad.output, /i18n 层不允许浏览器\/网络\/存储 API/);
  }
});
