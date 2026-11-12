import {
  buildTranslationPrompt,
  requestChatCompletions,
  requestParsedJson,
  requestParsedTranslation
} from "./shared.js";

const API_URL = "https://api.deepseek.com/chat/completions";

export const deepSeekProvider = Object.freeze({
  id: "deepseek",

  async translateBatch(segments, config, { signal } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const payload = {
      segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
    };

    const request = () => requestChatCompletions({ config: { ...config, platform: "deepseek", protocol: "openai-chat", apiBaseUrl: "https://api.deepseek.com" },
      url: API_URL,
      apiKey: config.apiKey,
      providerLabel: "DeepSeek",
      requireApiKey: true,
      signal,
      body: {
        model: config.model?.trim() || "deepseek-flash",
        messages: [
          { role: "system", content: buildTranslationPrompt(config, "Translate to Simplified Chinese.") },
          { role: "user", content: JSON.stringify(payload) }
        ],
        response_format: { type: "json_object" },
        stream: false
      }
    });

    return requestParsedTranslation({
      request,
      segments,
      providerLabel: "DeepSeek"
    });
  },

  async completeJson({ systemPrompt, payload, parseResult }, config, { signal } = {}) {
    const request = () => requestChatCompletions({ config: { ...config, platform: "deepseek", protocol: "openai-chat", apiBaseUrl: "https://api.deepseek.com" },
      url: API_URL,
      apiKey: config.apiKey,
      providerLabel: "DeepSeek",
      requireApiKey: true,
      signal,
      body: {
        model: config.model?.trim() || "deepseek-flash",
        messages: [
          { role: "system", content: String(systemPrompt || "") },
          { role: "user", content: JSON.stringify(payload || {}) }
        ],
        response_format: { type: "json_object" },
        stream: false
      }
    });

    return requestParsedJson({
      request,
      providerLabel: "DeepSeek",
      parseResult
    });
  },

  async completeText({ systemPrompt, prompt }, config, { signal } = {}) {
    const data = await requestChatCompletions({ config: { ...config, platform: "deepseek", protocol: "openai-chat", apiBaseUrl: "https://api.deepseek.com" }, url: API_URL, apiKey: config.apiKey, providerLabel: "DeepSeek", requireApiKey: true, signal,
      body: { model: config.model?.trim() || "deepseek-flash", messages: [{ role: "system", content: String(systemPrompt || "") },
        { role: "user", content: String(prompt || "") }], stream: false } });
    return { text: String(data?.choices?.[0]?.message?.content || ""), mode: "unary" };
  },

  async test(config) {
    const data = await requestChatCompletions({ config: { ...config, platform: "deepseek", protocol: "openai-chat", apiBaseUrl: "https://api.deepseek.com" },
      url: API_URL,
      apiKey: config.apiKey,
      providerLabel: "DeepSeek",
      requireApiKey: true,
      body: {
        model: config.model?.trim() || "deepseek-flash",
        messages: [
          { role: "system", content: "Reply with exactly: OK" },
          { role: "user", content: "Connection test" }
        ],
        stream: false,
      }
    });
    const result = data?.choices?.[0]?.message?.content?.trim();
    if (result !== "OK") throw Object.assign(new Error("DeepSeek 连接测试未返回 OK。"), { code: "MALFORMED_RESPONSE" });
    return result;
  }
});
