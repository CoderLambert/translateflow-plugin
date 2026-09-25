import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern
} from "../../shared/provider-config.js";
import {
  buildTranslationPrompt,
  requestChatCompletions,
  requestParsedTranslation
} from "./shared.js";
import {
  buildLocalTranslationRequestBody,
  isLocalTranslationModel,
  isUnsupportedStructuredOutputError,
  parseLocalTranslationResult,
  splitLocalTranslationBatches
} from "./local-translation.js";

const PROVIDER_LABEL = "OpenAI-compatible";

export const openAICompatibleProvider = Object.freeze({
  id: "openai-compatible",

  async translateBatch(segments, config, { signal } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    await assertEndpointPermission(config.apiBaseUrl);
    const model = requireModel(config.model);

    if (isLocalTranslationModel(model)) {
      return translateLocalBatches(segments, config, model, signal);
    }
    return translateGenericBatch(segments, config, model, signal);
  },

  async test(config) {
    await assertEndpointPermission(config.apiBaseUrl);
    const model = requireModel(config.model);
    const localTranslationModel = isLocalTranslationModel(model);
    const data = await requestChatCompletions({
      url: buildChatCompletionsUrl(config.apiBaseUrl),
      apiKey: config.apiKey,
      providerLabel: PROVIDER_LABEL,
      requireApiKey: false,
      body: {
        model,
        messages: localTranslationModel
          ? [{ role: "user", content: "Reply with exactly: OK" }]
          : [
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

async function translateGenericBatch(segments, config, model, signal) {
  const payload = {
    segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
  };
  const request = () => requestChatCompletions({
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    providerLabel: PROVIDER_LABEL,
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
    providerLabel: PROVIDER_LABEL
  });
}

async function translateLocalBatches(segments, config, model, signal) {
  const batches = splitLocalTranslationBatches(segments);
  const translated = [];
  let structuredOutputSupported = true;

  for (const batch of batches) {
    if (signal?.aborted) throw createCancelledError();

    const request = async () => {
      if (!structuredOutputSupported) {
        return requestLocalBatch(batch, config, model, signal, false);
      }
      try {
        return await requestLocalBatch(batch, config, model, signal, true);
      } catch (error) {
        if (!isUnsupportedStructuredOutputError(error)) throw error;
        structuredOutputSupported = false;
        return requestLocalBatch(batch, config, model, signal, false);
      }
    };

    const result = await requestParsedTranslation({
      request,
      segments: batch,
      providerLabel: PROVIDER_LABEL,
      parseResult: parseLocalTranslationResult
    });
    translated.push(...result);
  }

  return translated;
}

function requestLocalBatch(batch, config, model, signal, useStructuredOutput) {
  return requestChatCompletions({
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    providerLabel: PROVIDER_LABEL,
    requireApiKey: false,
    signal,
    body: buildLocalTranslationRequestBody({
      segments: batch,
      config,
      model,
      useStructuredOutput
    })
  });
}

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

function createCancelledError() {
  const error = new Error("翻译请求已取消。");
  error.code = "CANCELLED";
  return error;
}
