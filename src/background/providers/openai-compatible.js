import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern
} from "../../shared/provider-config.js";
import {
  buildTranslationPrompt,
  requestChatCompletions,
  requestParsedJson,
  requestParsedTranslation
} from "./shared.js";
import {
  isUnsupportedStreamingError,
  requestChatCompletionsStream
} from "./openai-sse.js";
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

  async translateBatch(segments, config, { signal, onProgress } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    await assertEndpointPermission(config.apiBaseUrl);
    const model = requireModel(config.model);

    if (isLocalTranslationModel(model)) {
      return translateLocalBatches(segments, config, model, signal);
    }
    return translateGenericBatch(segments, config, model, signal, onProgress);
  },

  async completeJson(input, config, { signal } = {}) {
    return completeStructuredJson(input, config, signal);
  },

  async completeText({ systemPrompt, prompt }, config, { signal, onDelta } = {}) {
    await assertEndpointPermission(config.apiBaseUrl);
    const model = requireModel(config.model), body = { model, messages: [{ role: "system", content: String(systemPrompt || "") }, { role: "user", content: String(prompt || "") }], temperature: 0.2 };
    if (config.streaming) {
      try {
        const data = await requestChatCompletionsStream({ url: buildChatCompletionsUrl(config.apiBaseUrl), apiKey: config.apiKey, providerLabel: PROVIDER_LABEL,
          requireApiKey: false, signal, body, onTextDelta: onDelta });
        return { text: String(data?.choices?.[0]?.message?.content || ""), mode: "stream" };
      } catch (error) { if (!isUnsupportedStreamingError(error)) throw error; }
    }
    const data = await requestChatCompletions({ url: buildChatCompletionsUrl(config.apiBaseUrl), apiKey: config.apiKey, providerLabel: PROVIDER_LABEL,
      requireApiKey: false, signal, body: { ...body, stream: false } });
    return { text: String(data?.choices?.[0]?.message?.content || ""), mode: "unary" };
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

async function completeStructuredJson({ systemPrompt, payload, parseResult } = {}, config, signal) {
  await assertEndpointPermission(config.apiBaseUrl);
  const model = requireModel(config.model);
  const localModel = isLocalTranslationModel(model);
  let structuredOutputSupported = true;

  const request = async () => {
    if (!structuredOutputSupported) {
      return requestStructuredCompletion({ systemPrompt, payload, config, model, signal, localModel, structured: false });
    }
    try {
      return await requestStructuredCompletion({ systemPrompt, payload, config, model, signal, localModel, structured: true });
    } catch (error) {
      if (!isUnsupportedStructuredOutputError(error)) throw error;
      structuredOutputSupported = false;
      return requestStructuredCompletion({ systemPrompt, payload, config, model, signal, localModel, structured: false });
    }
  };

  return requestParsedJson({
    request,
    providerLabel: PROVIDER_LABEL,
    parseResult
  });
}

function requestStructuredCompletion({
  systemPrompt,
  payload,
  config,
  model,
  signal,
  localModel,
  structured
}) {
  const prompt = String(systemPrompt || "").trim();
  const userPayload = JSON.stringify(payload || {});
  const messages = localModel
    ? [{ role: "user", content: [prompt, "Input JSON:", userPayload].filter(Boolean).join("\n\n") }]
    : [
        { role: "system", content: prompt },
        { role: "user", content: userPayload }
      ];

  const body = {
    model,
    messages,
    stream: false,
    temperature: 0.1
  };
  if (structured) body.response_format = { type: "json_object" };

  return requestChatCompletions({
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    providerLabel: PROVIDER_LABEL,
    requireApiKey: false,
    signal,
    body
  });
}

async function translateGenericBatch(segments, config, model, signal, onProgress) {
  const body = buildGenericRequestBody(segments, config, model);
  const request = () => config.streaming
    ? requestGenericStreaming(body, config, signal, onProgress)
    : requestChatCompletions({
        url: buildChatCompletionsUrl(config.apiBaseUrl),
        apiKey: config.apiKey,
        providerLabel: PROVIDER_LABEL,
        requireApiKey: false,
        signal,
        body: { ...body, stream: false }
      });

  return requestParsedTranslation({
    request,
    segments,
    providerLabel: PROVIDER_LABEL
  });
}

async function requestGenericStreaming(body, config, signal, onProgress) {
  const request = {
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    providerLabel: PROVIDER_LABEL,
    requireApiKey: false,
    signal
  };

  try {
    return await requestChatCompletionsStream({
      ...request,
      body,
      onProgress
    });
  } catch (error) {
    if (!isUnsupportedStreamingError(error)) throw error;
    notify(onProgress, { type: "streaming-fallback", reason: "unsupported" });
    return requestChatCompletions({
      ...request,
      body: { ...body, stream: false }
    });
  }
}

function buildGenericRequestBody(segments, config, model) {
  const payload = {
    segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
  };
  return {
    model,
    messages: [
      {
        role: "system",
        content: buildTranslationPrompt(config, "Translate to Simplified Chinese and return JSON only.")
      },
      { role: "user", content: JSON.stringify(payload) }
    ],
    temperature: 0.2
  };
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

function notify(listener, event) {
  if (typeof listener !== "function") return;
  try {
    listener(Object.freeze({ ...event }));
  } catch {}
}
