import test from "node:test";
import assert from "node:assert/strict";
import { readingTranslationResult } from "../src/background/selection/reading-result.js";

test("translation snapshot provenance distinguishes effective config without leaking settings", async () => {
  const config = { provider: "openai-compatible", model: "fixture-model", targetLanguage: "zh-CN", prompt: "private prompt", apiBaseUrl: "https://private.example/v1", apiKey: "fixture-secret" };
  const result = await readingTranslationResult(config);
  assert.match(result.provenance.providerConfigFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(result.targetLanguage, config.targetLanguage);
  const serialized = JSON.stringify(result);
  for (const privateValue of [config.prompt, config.apiBaseUrl, config.apiKey]) assert.equal(serialized.includes(privateValue), false);
  const changed = await readingTranslationResult({ ...config, prompt: "changed" });
  assert.notEqual(result.provenance.providerConfigFingerprint, changed.provenance.providerConfigFingerprint);
});
