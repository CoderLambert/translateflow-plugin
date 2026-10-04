import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogs } from "../src/i18n/catalog.js";
import { createI18n, getManifestMessages, normalizeUiLocale, resolveLocale, validateCatalogs } from "../src/i18n/index.js";
import { resolveTranslationConfig } from "../src/shared/provider-config.js";
import { buildSelectionExplainCacheIdentity } from "../src/shared/selection-explanation.js";
import { buildLocalTranslationRequestBody } from "../src/background/providers/local-translation.js";
import { getCacheContext } from "../src/background/cache-db.js";

test("locale settings normalize without using browser/translation language as stored values", () => {
  for (const value of [undefined, null, {}, 12, "fr", "en-US", "zh-TW", ""]) {
    assert.equal(normalizeUiLocale(value), "auto");
  }
  assert.equal(normalizeUiLocale(" EN "), "en");
  assert.equal(normalizeUiLocale("zh-CN"), "zh_CN");
  assert.equal(normalizeUiLocale("zh_CN"), "zh_CN");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  assert.equal(resolveLocale("zh_CN", "en-US"), "zh_CN");
});

test("auto uses an explicit simplified-script policy and honest English fallback", () => {
  for (const value of ["zh-CN", "zh_CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh-Hans-HK"]) {
    assert.equal(resolveLocale("auto", value), "zh_CN", value);
  }
  for (const value of ["zh", "zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN", "en", "en-GB", "fr", "nonsense_!!!", undefined]) {
    assert.equal(resolveLocale(undefined, value), "en", String(value));
  }
});

test("both catalogs have exactly the same keys and placeholder contracts", () => {
  assert.equal(validateCatalogs(), Object.keys(catalogs.en).length);
  const missing = { en: { ...catalogs.en }, zh_CN: { ...catalogs.zh_CN } };
  delete missing.zh_CN["learning.title"];
  assert.throws(() => validateCatalogs(missing), /keys differ/);
  const bad = { en: { ...catalogs.en }, zh_CN: { ...catalogs.zh_CN, "learning.count": "数量：{wrong}" } };
  assert.throws(() => validateCatalogs(bad), /placeholders differ/);
  bad.zh_CN["learning.count"] = "数量：{count";
  assert.throws(() => validateCatalogs(bad), /Invalid i18n placeholder/);
});

test("catalog source shards contain no duplicate literal message keys", async () => {
  const files = [
    "catalog-base.js", "catalog-content.js", "catalog-content-page.js", "catalog-options.js",
    "catalog-dictionary.js", "catalog-dictionary-runtime.js", "catalog-local-import.js",
    "catalog-local-import-capabilities.js", "catalog-learning.js"
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../src/i18n/${file}`, import.meta.url), "utf8");
    const split = source.indexOf("export const zh_CN");
    assert.ok(split > 0, `${file}: missing zh_CN catalog`);
    for (const [locale, blockSource] of [["en", source.slice(0, split)], ["zh_CN", source.slice(split)]]) {
      const keys = [...blockSource.matchAll(/^\s*"([^"]+)"\s*:/gmu)].map((match) => match[1]);
      assert.equal(new Set(keys).size, keys.length, `${file}/${locale}: duplicate message key`);
    }
  }
});

test("text interpolation preserves hostile text without producing DOM or interpreting braces", () => {
  const diagnostics = [];
  const i18n = createI18n({ uiLocale: "zh_CN", onDiagnostic: (entry) => diagnostics.push(entry) });
  const title = '<img src=x onerror="window.pwned=1"> {count} & $1';
  assert.equal(i18n.t("learning.pageTitle", { title }), `页面：${title}`);
  assert.equal(i18n.t("learning.count", { count: 0 }), "记录数：0");
  assert.equal(i18n.t("learning.missing"), "[learning.missing]");
  assert.deepEqual(diagnostics, [{ code: "missing-key", key: "learning.missing" }]);
  for (const args of [undefined, {}, { count: NaN }, { count: Infinity }, { count: {} }, { count: 1, other: 2 }, [1], null]) {
    assert.throws(() => i18n.t("learning.count", args), /Invalid i18n arguments/);
  }
  assert.throws(() => i18n.t("learning.title", { count: 1 }), /Invalid i18n arguments/);
  assert.ok(diagnostics.every((entry) => Object.keys(entry).sort().join() === "code,key"));
});

test("Intl uses the UI locale and accepts caller-specified deterministic date options", () => {
  for (const uiLocale of ["en", "zh_CN"]) {
    const i18n = createI18n({ uiLocale });
    const tag = uiLocale === "zh_CN" ? "zh-CN" : "en";
    assert.equal(i18n.formatNumber(123456.78), new Intl.NumberFormat(tag).format(123456.78));
    const options = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" };
    assert.equal(i18n.formatDateTime(0, options), new Intl.DateTimeFormat(tag, options).format(0));
  }
});

test("Manifest is a controlled catalog projection, independent of UI override", () => {
  for (const locale of ["en", "zh_CN"]) {
    const messages = getManifestMessages(locale);
    assert.deepEqual(Object.keys(messages), ["extensionName", "extensionDescription", "actionTitle", "translatePage", "toggleTranslations", "toggleQuickControl"]);
    assert.equal(messages.extensionDescription.message, catalogs[locale]["manifest.description"]);
    assert.ok(Object.keys(messages).every((key) => /^[a-zA-Z0-9_]+$/.test(key)));
  }
  assert.throws(() => getManifestMessages("zh_TW"), /Unsupported manifest locale/);
  assert.equal(createI18n({ uiLocale: "zh_CN", browserLocale: "en" }).locale, "zh_CN");
  assert.equal(getManifestMessages("en").extensionName.message, "TranslateFlow");
});

test("UI locale cannot change effective translation config, cache identity or Provider request body", async () => {
  const base = {
    provider: "openai-compatible", targetLanguage: "Simplified Chinese", prompt: "Translate faithfully.",
    dictionaryLanguages: ["en"],
    openAICompatible: { baseUrl: "http://localhost:11434/v1", model: "hy-mt", apiKey: "", streaming: false }
  };
  const segment = [{ id: "p1", text: "A synthetic sentence." }];
  const configurations = ["auto", "en", "zh_CN"].map((uiLocale) => resolveTranslationConfig({ ...base, uiLocale }));
  for (const config of configurations) {
    assert.deepEqual(config, configurations[0]);
    assert.deepEqual(buildLocalTranslationRequestBody({ segments: segment, config, model: config.model }),
      buildLocalTranslationRequestBody({ segments: segment, config: configurations[0], model: configurations[0].model }));
  }
  const identities = await Promise.all(configurations.map((config) => buildSelectionExplainCacheIdentity({
    provider: config.provider, model: config.model, endpoint: config.apiBaseUrl, targetLanguage: config.targetLanguage,
    payload: { selectionText: "synthetic", contextText: "A synthetic sentence.", targetLanguage: config.targetLanguage }
  })));
  assert.deepEqual(identities[0], identities[1]);
  assert.deepEqual(identities[1], identities[2]);
  const pageIdentities = await Promise.all(["auto", "en", "zh_CN"].map((uiLocale) =>
    getCacheContext("https://example.test/synthetic", { ...configurations[0], uiLocale })));
  assert.deepEqual(pageIdentities[0], pageIdentities[1]);
  assert.deepEqual(pageIdentities[1], pageIdentities[2]);
  assert.equal(createI18n({ uiLocale: "en", browserLocale: "zh-CN" }).locale, "en");
  assert.equal(configurations[0].targetLanguage, "Simplified Chinese");
  assert.deepEqual(base.dictionaryLanguages, ["en"]);
});
