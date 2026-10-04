import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getManifestMessages, validateCatalogs } from "../src/i18n/index.js";
import { MANIFEST_LOCALE_FILES } from "../src/shared/runtime-assets.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_SOURCE_FILES = Object.freeze([
  "src/i18n/catalog-base.js",
  "src/i18n/catalog-content.js",
  "src/i18n/catalog-content-page.js",
  "src/i18n/catalog-options.js",
  "src/i18n/catalog-dictionary.js",
  "src/i18n/catalog-learning.js"
]);
const manifestReferences = Object.freeze({
  extensionName: (value) => value.name,
  extensionDescription: (value) => value.description,
  actionTitle: (value) => value.action.default_title,
  translatePage: (value) => value.commands["translate-page"].description,
  toggleTranslations: (value) => value.commands["toggle-translations"].description,
  toggleQuickControl: (value) => value.commands["toggle-quick-control"].description
});

export async function checkManifestLocales({ root = ROOT, generate = false } = {}) {
  await assertCatalogSourceKeys(root);
  const keyCount = validateCatalogs();
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  assert.equal(manifest.default_locale, "en", "Manifest default locale");
  for (const [key, value] of Object.entries(manifestReferences)) {
    assert.equal(value(manifest), `__MSG_${key}__`, `Manifest reference: ${key}`);
  }
  for (const path of MANIFEST_LOCALE_FILES) {
    const locale = path.split("/")[1];
    const expected = JSON.stringify(getManifestMessages(locale), null, 2) + "\n";
    const target = resolve(root, path);
    if (generate) { await mkdir(dirname(target), { recursive: true }); await writeFile(target, expected); }
    assert.equal(await readFile(target, "utf8"), expected, `Generated locale is stale: ${path}`);
  }
  return { keyCount, files: [...MANIFEST_LOCALE_FILES] };
}

export async function assertCatalogSourceKeys(root = ROOT) {
  const owners = { en: new Map(), zh_CN: new Map() };
  for (const path of CATALOG_SOURCE_FILES) {
    const source = await readFile(resolve(root, path), "utf8");
    for (const locale of ["en", "zh_CN"]) {
      const marker = `export const ${locale} = Object.freeze({`;
      const start = source.indexOf(marker);
      assert.notEqual(start, -1, `Missing catalog object: ${path}/${locale}`);
      const bodyStart = start + marker.length;
      const bodyEnd = source.indexOf("\n});", bodyStart);
      assert.notEqual(bodyEnd, -1, `Unterminated catalog object: ${path}/${locale}`);
      const keys = [...source.slice(bodyStart, bodyEnd).matchAll(/^\s*"([^"]+)"\s*:/gm)].map((match) => match[1]);
      assert.equal(new Set(keys).size, keys.length, `Duplicate catalog key in ${path}/${locale}`);
      for (const key of keys) {
        const previous = owners[locale].get(key);
        assert.equal(previous, undefined, `Duplicate catalog key ${key} in ${previous} and ${path} (${locale})`);
        owners[locale].set(key, path);
      }
    }
  }
  assert.equal(owners.en.size, owners.zh_CN.size, "Catalog source key counts differ");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => !["--generate", "--check"].includes(arg))) throw new Error("Unknown locale command");
  console.log(JSON.stringify(await checkManifestLocales({ generate: process.argv.includes("--generate") })));
}
