import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern,
  normalizeOpenAIBaseUrl,
  resolveTranslationConfig,
  updateSiteProfilePreset
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
        prompt: "technical prompt",
        targetLanguage: "English"
      }
    }
  }, "https://github.com/org/repo?tab=readme");

  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.apiKey, "sk-openai");
  assert.equal(config.model, "github-model");
  assert.equal(config.prompt, "technical prompt");
  assert.equal(config.targetLanguage, "English");
  assert.equal(config.siteOrigin, "https://github.com");
});

test("non-matching and deleted site profiles fall back to global settings", () => {
  const config = {
    provider: "deepseek",
    apiKey: "sk-deepseek",
    model: "global-model",
    prompt: "global prompt",
    targetLanguage: "Japanese",
    siteProfiles: {
      "https://github.com": {
        provider: "openai-compatible",
        model: "github-model",
        prompt: "github prompt",
        targetLanguage: "English"
      }
    }
  };

  const nonMatching = resolveTranslationConfig(config, "https://news.ycombinator.com/item?id=1");
  assert.equal(nonMatching.provider, "deepseek");
  assert.equal(nonMatching.model, "global-model");
  assert.equal(nonMatching.prompt, "global prompt");
  assert.equal(nonMatching.targetLanguage, "Japanese");
  assert.equal(nonMatching.siteOrigin, "");

  const deleted = resolveTranslationConfig({ ...config, siteProfiles: {} }, "https://github.com/org/repo");
  assert.equal(deleted.provider, "deepseek");
  assert.equal(deleted.model, "global-model");
  assert.equal(deleted.prompt, "global prompt");
  assert.equal(deleted.targetLanguage, "Japanese");
  assert.equal(deleted.siteOrigin, "");
});


test("saved and temporary presets follow deterministic precedence", () => {
  const base = {
    provider: "deepseek",
    prompt: "global prompt",
    siteProfiles: {
      "https://example.com": { preset: "technical" }
    }
  };

  const saved = resolveTranslationConfig(base, "https://example.com/docs");
  assert.equal(saved.presetId, "technical");
  assert.equal(saved.presetSource, "site");
  assert.match(saved.prompt, /Translation style preset: Technical/);

  const temporary = resolveTranslationConfig(base, "https://example.com/docs", {
    active: true,
    presetId: "news"
  });
  assert.equal(temporary.presetId, "news");
  assert.equal(temporary.presetSource, "temporary");
  assert.match(temporary.prompt, /Translation style preset: News/);
  assert.doesNotMatch(temporary.prompt, /Translation style preset: Technical/);

  const disabled = resolveTranslationConfig(base, "https://example.com/docs", {
    active: true,
    presetId: ""
  });
  assert.equal(disabled.presetId, "");
  assert.equal(disabled.prompt, "global prompt");
});

test("explicit site prompt wins over selected preset", () => {
  const resolved = resolveTranslationConfig({
    prompt: "global prompt",
    siteProfiles: {
      "https://example.com": {
        prompt: "site custom prompt",
        preset: "academic"
      }
    }
  }, "https://example.com/docs", {
    active: true,
    presetId: "natural"
  });

  assert.equal(resolved.prompt, "site custom prompt");
  assert.equal(resolved.presetId, "");
  assert.equal(resolved.selectedPresetId, "natural");
  assert.equal(resolved.presetSource, "site-prompt");
  assert.equal(resolved.hasSitePromptOverride, true);
});

test("site preset persistence helper preserves other profile fields", () => {
  const original = {
    "https://example.com": {
      provider: "deepseek",
      model: "site-model",
      targetLanguage: "Japanese"
    }
  };

  const saved = updateSiteProfilePreset(original, "https://example.com/docs", "technical");
  assert.equal(saved.origin, "https://example.com");
  assert.equal(saved.siteProfiles["https://example.com"].preset, "technical");
  assert.equal(saved.siteProfiles["https://example.com"].model, "site-model");
  assert.equal(original["https://example.com"].preset, undefined);

  const removed = updateSiteProfilePreset(saved.siteProfiles, "https://example.com", "none");
  assert.equal(removed.siteProfiles["https://example.com"].preset, undefined);
  assert.equal(removed.siteProfiles["https://example.com"].model, "site-model");
});
