import test from "node:test";
import assert from "node:assert/strict";
import { getCacheContext } from "../src/background/cache-db.js";
import { resolveTranslationConfig } from "../src/shared/provider-config.js";

const legacyCompatibleConfig = {
  provider: "deepseek",
  model: "deepseek-flash",
  targetLanguage: "Simplified Chinese",
  prompt: "same prompt"
};

test("adding the default provider field does not invalidate v0.3 cache identity", async () => {
  const before = await getCacheContext("https://example.com/docs?utm_source=x&id=1", {
    model: "deepseek-flash",
    targetLanguage: "Simplified Chinese",
    prompt: "same prompt"
  });
  const after = await getCacheContext("https://example.com/docs?id=1", legacyCompatibleConfig);
  assert.equal(before.pageConfigKey, after.pageConfigKey);
});

test("OpenAI-compatible endpoints have separate cache versions", async () => {
  const base = {
    provider: "openai-compatible",
    model: "demo-model",
    targetLanguage: "Simplified Chinese",
    prompt: "same prompt"
  };

  const a = await getCacheContext("https://example.com/docs", {
    ...base,
    apiBaseUrl: "https://api-a.example/v1"
  });
  const b = await getCacheContext("https://example.com/docs", {
    ...base,
    apiBaseUrl: "https://api-b.example/v1"
  });

  assert.notEqual(a.pageConfigKey, b.pageConfigKey);
});

test("effective target language has a separate cache identity", async () => {
  const pageUrl = "https://example.com/docs";
  const base = {
    provider: "deepseek",
    model: "deepseek-flash",
    prompt: "same prompt",
    targetLanguage: "Simplified Chinese"
  };

  const chinese = await getCacheContext(pageUrl, resolveTranslationConfig(base, pageUrl));
  const english = await getCacheContext(pageUrl, resolveTranslationConfig({
    ...base,
    siteProfiles: {
      "https://example.com": { targetLanguage: "English" }
    }
  }, pageUrl));

  assert.notEqual(chinese.pageConfigKey, english.pageConfigKey);
});

test("unchanged effective config keeps cache identity despite site metadata", async () => {
  const pageUrl = "https://example.com/docs";
  const base = {
    provider: "deepseek",
    model: "deepseek-flash",
    targetLanguage: "Simplified Chinese",
    prompt: "same prompt"
  };

  const global = await getCacheContext(pageUrl, resolveTranslationConfig(base, pageUrl));
  const profileResolved = await getCacheContext(pageUrl, resolveTranslationConfig({
    ...base,
    siteProfiles: {
      "https://example.com": { targetLanguage: "Simplified Chinese" }
    }
  }, pageUrl));

  assert.equal(global.pageConfigKey, profileResolved.pageConfigKey);
});
