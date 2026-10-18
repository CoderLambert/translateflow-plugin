import test from "node:test";
import assert from "node:assert/strict";
import { browserLanguage, languageHintMatchesText } from "../src/shared/browser-translation.js";
import { chooseDetectedLanguage, explicitSource, refineChinese, scriptLanguage, detectionSample, translationParts } from "../src/shared/browser-language.js";

test("language policy uses FluentRead's 0.4 floor without a length-dependent short-word penalty", () => {
  assert.equal(chooseDetectedLanguage([{ detectedLanguage: "en", confidence: .7 }], "Actually").language, "en");
  assert.equal(chooseDetectedLanguage([{ detectedLanguage: "fr", confidence: .4 }], "bonjour").language, "fr");
  assert.equal(chooseDetectedLanguage([{ detectedLanguage: "en", confidence: .39 }], "a long sample of words").language, "");
});
test("near ties, invalid confidence and unknown top language do not become a guessed language", () => {
  for (const confidence of [NaN, Infinity, 1.1, "0.99", undefined]) assert.equal(chooseDetectedLanguage([{ detectedLanguage: "en", confidence }], "hi").language, "");
  assert.equal(chooseDetectedLanguage([{ detectedLanguage: "en", confidence: .51 }, { detectedLanguage: "fr", confidence: .49 }], "chat").language, "");
  assert.equal(chooseDetectedLanguage([{ detectedLanguage: "und", confidence: .9 }, { detectedLanguage: "en", confidence: .5 }], "...?").language, "");
});
test("manual correction and configured source outrank subtitle metadata; page hints are not explicit sources", () => {
  assert.equal(explicitSource({ corrected: "de", configured: "en", trackLanguage: "fr", surface: "subtitle" }).language, "de");
  assert.equal(explicitSource({ configured: "ja", trackLanguage: "en", surface: "subtitle" }).language, "ja");
  assert.equal(explicitSource({ configured: "auto", trackLanguage: "fr", surface: "subtitle" }).language, "fr");
  assert.equal(explicitSource({ configured: "auto", trackLanguage: "en", surface: "selection" }), null);
});
test("Latin, shared Han and Cyrillic script hints never manufacture a language", () => {
  for (const [text, lang] of [["bonjour", "en"], ["hello", "de"], ["中文", "ja"], ["中国", "ko"], ["привет", "uk"]]) assert.equal(languageHintMatchesText(text, lang), false);
  assert.equal(scriptLanguage("これは日本語です"), "ja");
  assert.equal(scriptLanguage("안녕하세요"), "ko");
  assert.equal(scriptLanguage("한글とかな"), "");
  assert.equal(scriptLanguage("This is English with カナ"), "");
});
test("Chinese script refinement does not default ambiguous or mixed Chinese to Simplified", () => {
  assert.deepEqual(refineChinese("这是简体中文的浏览器设置", "zh"), { language: "zh", scriptKnown: true });
  assert.deepEqual(refineChinese("這是繁體中文的瀏覽器設定", "zh"), { language: "zh-Hant", scriptKnown: true });
  assert.equal(refineChinese("中国與中文", "zh").scriptKnown, false);
  assert.equal(refineChinese("你好", "zh").scriptKnown, false);
  assert.equal(refineChinese("日本語です", "zh").language, "");
  assert.equal(browserLanguage("zh_TW"), "zh-Hant");
  assert.equal(browserLanguage("zh-Hans-TW"), "zh");
});
test("detection samples remove sentinels and protected code without rewriting original text", () => {
  const text = "Read ⟦TF:0:S⟧const x = 1⟦TF:0:E⟧ with ⟦TF:1:S⟧care⟦TF:1:E⟧.";
  assert.equal(detectionSample(text, [0]), "Read with care .");
  assert.equal(translationParts(text, [0]).map(part => part.text).join(""), text);
});
test("invalid structured input is rejected before it enters a model", () => {
  for (const text of ["⟦TF:0:E⟧", "⟦TF:0:S⟧open", "⟦TF:0:S⟧x⟦TF:1:E⟧", "⟦TF:abc:S⟧bad", "⟦TF:0:S⟧a⟦TF:0:E⟧⟦TF:0:S⟧b⟦TF:0:E⟧"]) assert.throws(() => translationParts(text), { code: "BROWSER_STRUCTURE" });
});
