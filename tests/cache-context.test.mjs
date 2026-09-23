import test from "node:test";
import assert from "node:assert/strict";
import { getCacheContext } from "../src/background/cache-db.js";

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
