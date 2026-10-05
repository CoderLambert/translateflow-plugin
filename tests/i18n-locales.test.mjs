import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkManifestLocales } from "../scripts/i18n-locales.mjs";
import { getManifestMessages } from "../src/i18n/index.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const catalogFiles = [
  "catalog-base.js", "catalog-content.js", "catalog-content-page.js",
  "catalog-options.js", "catalog-dictionary.js", "catalog-learning.js"
];

async function copyCatalogSources(root) {
  const target = join(root, "src", "i18n");
  await mkdir(target, { recursive: true });
  for (const file of catalogFiles) {
    await copyFile(new URL(`../src/i18n/${file}`, import.meta.url), join(target, file));
  }
}

test("locale generation is deterministic and rejects stale or missing production messages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-i18n-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyCatalogSources(root);
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  const generated = await checkManifestLocales({ root, generate: true });
  assert.deepEqual(generated.files, ["_locales/en/messages.json", "_locales/zh_CN/messages.json"]);
  for (const locale of ["en", "zh_CN"]) {
    const path = join(root, "_locales", locale, "messages.json");
    assert.equal(await readFile(path, "utf8"), JSON.stringify(getManifestMessages(locale), null, 2) + "\n");
  }
  assert.deepEqual(await checkManifestLocales({ root }), generated);
  const path = join(root, "_locales/zh_CN/messages.json");
  const drifted = getManifestMessages("zh_CN");
  delete drifted.extensionDescription;
  await writeFile(path, JSON.stringify(drifted, null, 2) + "\n");
  await assert.rejects(checkManifestLocales({ root }), /Generated locale is stale/);
  await checkManifestLocales({ root, generate: true });
  await rm(path);
  await assert.rejects(checkManifestLocales({ root }), { code: "ENOENT" });
});

test("Manifest must use every controlled locale reference and the English default", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-i18n-manifest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyCatalogSources(root);
  const invalid = structuredClone(manifest);
  invalid.default_locale = "zh_CN";
  await writeFile(join(root, "manifest.json"), JSON.stringify(invalid));
  await assert.rejects(checkManifestLocales({ root, generate: true }), /Manifest default locale/);
  invalid.default_locale = "en";
  invalid.action.default_title = "TranslateFlow";
  await writeFile(join(root, "manifest.json"), JSON.stringify(invalid));
  await assert.rejects(checkManifestLocales({ root, generate: true }), /Manifest reference: actionTitle/);
});

test("locale command checks the real source and rejects unknown flags", () => {
  const script = new URL("../scripts/i18n-locales.mjs", import.meta.url);
  const good = spawnSync(process.execPath, [script.pathname, "--check"], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).files.length, 2);
  const bad = spawnSync(process.execPath, [script.pathname, "--unknown"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown locale command/);
});
