import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern
} from "../../shared/provider-config.js";
import {
  buildTranslationPrompt,
  requestChatCompletions,
  requestParsedTranslation
} from "./shared.js";

export const openAICompatibleProvider = Object.freeze({
  id: "openai-compatible",

  async translateBatch(segments, config, { signal } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    await assertEndpointPermission(config.apiBaseUrl);
    const model = requireModel(config.model);
    const payload = {
      segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
    };

    const request = () => requestChatCompletions({
      url: buildChatCompletionsUrl(config.apiBaseUrl),
      apiKey: config.apiKey,
      providerLabel: "OpenAI-compatible",
      requireApiKey: false,
      signal,
      body: {
        model,
        messages: [
          {
            role: "system",
            content: buildTranslationPrompt(config, "Translate to Simplified Chinese and return JSON only.")
          },
          { role: "user", content: JSON.stringify(payload) }
        ],
        stream: false,
        temperature: 0.2
      }
    });

    return requestParsedTranslation({
      request,
      segments,
      providerLabel: "OpenAI-compatible"
    });
  },

  async test(config) {
    await assertEndpointPermission(config.apiBaseUrl);
    const data = await requestChatCompletions({
      url: buildChatCompletionsUrl(config.apiBaseUrl),
      apiKey: config.apiKey,
      providerLabel: "OpenAI-compatible",
      requireApiKey: false,
      body: {
        model: requireModel(config.model),
        messages: [
          { role: "system", content: "Reply with exactly: OK" },
          { role: "user", content: "Connection test" }
        ],
        stream: false,
        temperature: 0
      }
    });
    return data?.choices?.[0]?.message?.content?.trim() || "OK";
  }
});

async function assertEndpointPermission(baseUrl) {
  const pattern = getProviderHostPermissionPattern(baseUrl);
  if (!pattern) {
    const error = new Error("请先配置 OpenAI-compatible Base URL。");
    error.code = "CONFIG";
    throw error;
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    const error = new Error("尚未授权访问 OpenAI-compatible API 地址，请在设置页保存配置并授权后重试。");
    error.code = "PERMISSION";
    throw error;
  }
}

function requireModel(value) {
  const model = String(value || "").trim();
  if (!model) {
    const error = new Error("请先配置 OpenAI-compatible Model。");
    error.code = "CONFIG";
    throw error;
  }
  return model;
}
