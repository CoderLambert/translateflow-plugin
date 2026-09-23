import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern,
  normalizeOpenAIBaseUrl,
  resolveTranslationConfig
} from "../src/shared/provider-config.js";

test("OpenAI-compatible base URL is normalized and chat endpoint is appended", () => {
  assert.equal(normalizeOpenAIBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(
    buildChatCompletionsUrl("https://api.example.com/v1"),
    "https://api.example.com/v1/chat/completions"
  );
  assert.equal(
    buildChatCompletionsUrl("https://api.example.com/v1/chat/completions/"),
    "https://api.example.com/v1/chat/completions"
  );
});

test("provider host permission uses scheme and hostname", () => {
  assert.equal(
    getProviderHostPermissionPattern("http://localhost:11434/v1"),
    "http://localhost/*"
  );
});

test("legacy DeepSeek fields still resolve as the DeepSeek runtime config", () => {
  const config = resolveTranslationConfig({
    provider: "deepseek",
    apiKey: "sk-deepseek",
    model: "deepseek-flash",
    prompt: "global prompt",
    targetLanguage: "Simplified Chinese"
  });

  assert.equal(config.provider, "deepseek");
  assert.equal(config.apiKey, "sk-deepseek");
  assert.equal(config.model, "deepseek-flash");
  assert.equal(config.prompt, "global prompt");
});

test("OpenAI-compatible global provider resolves separate credentials", () => {
  const config = resolveTranslationConfig({
    provider: "openai-compatible",
    prompt: "global prompt",
    openAICompatible: {
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-openai",
      model: "demo-model"
    }
  });

  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.apiBaseUrl, "https://api.example.com/v1");
  assert.equal(config.apiKey, "sk-openai");
  assert.equal(config.model, "demo-model");
});

test("site profile overrides provider, model and prompt without duplicating credentials", () => {
  const config = resolveTranslationConfig({
    provider: "deepseek",
    apiKey: "sk-deepseek",
    model: "deepseek-flash",
    prompt: "global prompt",
    openAICompatible: {
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-openai",
      model: "global-openai-model"
    },
    siteProfiles: {
      "https://github.com": {
        provider: "openai-compatible",
        model: "github-model",
        prompt: "technical prompt"
      }
    }
  }, "https://github.com/org/repo?tab=readme");

  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.apiKey, "sk-openai");
  assert.equal(config.model, "github-model");
  assert.equal(config.prompt, "technical prompt");
  assert.equal(config.siteOrigin, "https://github.com");
});
