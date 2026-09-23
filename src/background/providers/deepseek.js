import {
  buildTranslationPrompt,
  requestChatCompletions,
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

    const request = () => requestChatCompletions({
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
        thinking: { type: "disabled" },
        stream: false,
        temperature: 0.2
      }
    });

    return requestParsedTranslation({
      request,
      segments,
      providerLabel: "DeepSeek"
    });
  },

  async test(config) {
    const data = await requestChatCompletions({
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
        thinking: { type: "disabled" },
        stream: false,
        temperature: 0
      }
    });
    return data?.choices?.[0]?.message?.content?.trim() || "OK";
  }
});
