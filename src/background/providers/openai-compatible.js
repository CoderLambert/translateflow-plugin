import { structuredRecoveryPlan } from "./structured-recovery.js";
import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern
} from "../../shared/provider-config.js";
import {
  buildTranslationPrompt,
  openAIAuthenticationHeaders,
  requestChatCompletions,
  requestParsedJson,
  requestParsedTranslation,
  validateParsedTranslation
} from "./shared.js";
import {
  isUnsupportedStreamingError,
  requestChatCompletionsStream
} from "./openai-sse.js";
import {
  buildLocalTranslationRequestBody,
  buildLocalPlainRecoveryBody,
  parseLocalPlainRecovery,
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
    const model = requireModel(config.model), body = withTemperature({ model, messages: [{ role: "system", content: String(systemPrompt || "") }, { role: "user", content: String(prompt || "") }] }, config, 0.2);
    if (config.streaming) {
      try {
        const data = await requestChatCompletionsStream({ url: buildChatCompletionsUrl(config.apiBaseUrl), apiKey: config.apiKey, headers: openAIAuthenticationHeaders(config, config.apiKey), providerLabel: providerLabel(config),
          requireApiKey: false, signal, body, onTextDelta: onDelta });
        return { text: String(data?.choices?.[0]?.message?.content || ""), mode: "stream" };
      } catch (error) { if (!isUnsupportedStreamingError(error)) throw error; }
    }
    const data = await requestChatCompletions({ url: buildChatCompletionsUrl(config.apiBaseUrl), apiKey: config.apiKey, headers: openAIAuthenticationHeaders(config, config.apiKey), providerLabel: providerLabel(config),
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
      headers: openAIAuthenticationHeaders(config, config.apiKey),
      providerLabel: providerLabel(config),
      requireApiKey: false,
      body: withTemperature({
        model,
        messages: localTranslationModel
          ? [{ role: "user", content: "Reply with exactly: OK" }]
          : [
              { role: "system", content: "Reply with exactly: OK" },
              { role: "user", content: "Connection test" }
            ],
        stream: false
      }, config, 0)
    });
    const result = data?.choices?.[0]?.message?.content?.trim();
    if (result !== "OK") {
      const error = new Error(`${providerLabel(config)} 连接测试返回了非预期内容。`);
      error.code = "MALFORMED_RESPONSE";
      throw error;
    }
    return result;
  }
});

export const openAIChatProvider = Object.freeze({ ...openAICompatibleProvider, id: "openai-chat" });

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
    providerLabel: providerLabel(config),
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

  const body = withTemperature({
    model,
    messages,
    stream: false
  }, config, 0.1);
  if (structured) body.response_format = { type: "json_object" };

  return requestChatCompletions({
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    headers: openAIAuthenticationHeaders(config, config.apiKey),
    providerLabel: providerLabel(config),
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
        headers: openAIAuthenticationHeaders(config, config.apiKey),
        providerLabel: providerLabel(config),
        requireApiKey: false,
        signal,
        body: { ...body, stream: false }
      });

  return requestParsedTranslation({
    request,
    segments,
    providerLabel: providerLabel(config)
  });
}

async function requestGenericStreaming(body, config, signal, onProgress) {
  const request = {
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    headers: openAIAuthenticationHeaders(config, config.apiKey),
    providerLabel: providerLabel(config),
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
  return withTemperature({
    model,
    messages: [
      {
        role: "system",
        content: buildTranslationPrompt(config, "Translate to Simplified Chinese and return JSON only.")
      },
      { role: "user", content: JSON.stringify(payload) }
    ]
  }, config, 0.2);
}

async function translateLocalBatches(segments, config, model, signal, allowSingleRecovery = true) {
  const batches = splitLocalTranslationBatches(segments);
  const translated = [];
  let structuredOutputSupported = true;

  for (const batch of batches) {
    if (signal?.aborted) throw createCancelledError();

    const plainRecovery = !allowSingleRecovery && batch.length === 1 && batch[0].format !== "tf-markers";
    const request = async () => {
      if (plainRecovery) return requestLocalBatch(batch, config, model, signal, false, true);
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

    let lastParsed = [];
    try {
      const result = await requestParsedTranslation({
        request, segments: batch, providerLabel: providerLabel(config),
        parseResult(data, segments, label) {
          lastParsed = (plainRecovery ? parseLocalPlainRecovery : parseLocalTranslationResult)(data, segments, label);
          return lastParsed;
        }
      });
      translated.push(...result);
    } catch (error) {
      if (error.code !== "MALFORMED_RESPONSE" || (!batch.some(item => item.format === "tf-markers") && (!allowSingleRecovery || batch.length < 2))) throw error;
      // One segment that cannot be recovered must not discard the rest of the
      // batch: the page keeps what was translated and reports the remainder as
      // missing instead of failing every paragraph (and pausing auto mode).
      // Validation of everything that is returned stays exactly as strict.
      const recovered = [];
      let firstFailure = null;
      for (const segment of batch) {
        if (signal?.aborted) throw createCancelledError();
        const existing = lastParsed.find(item => String(item.id) === String(segment.id));
        try { validateParsedTranslation([existing], [segment]); recovered.push(existing); continue; } catch {}
        try {
          if (segment.format !== "tf-markers") {
            if (!allowSingleRecovery || batch.length < 2) throw error;
            recovered.push(...await translateLocalBatches([segment], config, model, signal, false));
            continue;
          }
          const plan = structuredRecoveryPlan(segment);
          const fragments = await translateLocalBatches(plan.fragments, config, model, signal, plan.fragments.length > 1);
          recovered.push(plan.restore(fragments));
        } catch (recoveryError) {
          if (signal?.aborted || recoveryError?.code === "CANCELLED") throw createCancelledError();
          if (recoveryError?.code !== "MALFORMED_RESPONSE") throw recoveryError;
          firstFailure = firstFailure || recoveryError;
        }
      }
      if (!recovered.length) throw firstFailure || error;
      translated.push(...recovered);
    }
  }

  return translated;
}

function requestLocalBatch(batch, config, model, signal, useStructuredOutput, plainRecovery = false) {
  return requestChatCompletions({
    url: buildChatCompletionsUrl(config.apiBaseUrl),
    apiKey: config.apiKey,
    headers: openAIAuthenticationHeaders(config, config.apiKey),
    providerLabel: providerLabel(config),
    requireApiKey: false,
    signal,
    body: plainRecovery ? buildLocalPlainRecoveryBody(batch[0], config, model) : buildLocalTranslationRequestBody({
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

function providerLabel(config) { return String(config?.providerLabel || PROVIDER_LABEL); }

function withTemperature(body, config, legacyFallback) {
  const explicit = Number(config?.temperature);
  if (config?.temperature !== null && config?.temperature !== undefined && Number.isFinite(explicit)) {
    return { ...body, temperature: explicit };
  }
  return config?.connectionId ? body : { ...body, temperature: legacyFallback };
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
