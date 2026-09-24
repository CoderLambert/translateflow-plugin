import {
  buildChatCompletionsUrl,
  getProviderHostPermissionPattern
} from "../../shared/provider-config.js";
import {
  buildTranslationPrompt,
  requestChatCompletions,
  requestParsedTranslation
} from "./shared.js";

const LOCAL_TRANSLATION_MAX_ITEMS = 8;
const LOCAL_TRANSLATION_MAX_CHARS = 3200;
const STRUCTURED_MARKER_RE = /⟦TF:(\d+):(S|E)⟧/g;
const SHIELDED_MARKER_RE = /\[\[TF_(\d+)_(S|E)\]\]/g;

export const openAICompatibleProvider = Object.freeze({
  id: "openai-compatible",

  async translateBatch(segments, config, { signal } = {}) {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    await assertEndpointPermission(config.apiBaseUrl);

    const model = requireModel(config.model);
    if (isTranslationOptimizedModel(model)) {
      return translateWithTranslationModel(segments, config, model, signal);
    }

    const payload = {
      segments: segments.map((item) => ({ id: String(item.id), text: String(item.text) }))
    };
    const translationPrompt = buildTranslationPrompt(
      config,
      "Translate to Simplified Chinese and return JSON only."
    );
    let malformedAttempt = 0;

    const request = () => {
      malformedAttempt += 1;
      const useInlinePrompt = malformedAttempt > 1;
      return requestChatCompletions({
        url: buildChatCompletionsUrl(config.apiBaseUrl),
        apiKey: config.apiKey,
        providerLabel: "OpenAI-compatible",
        requireApiKey: false,
        signal,
        body: {
          model,
          messages: useInlinePrompt
            ? [
                {
                  role: "user",
                  content: buildInlineTranslationRequest(translationPrompt, payload)
                }
              ]
            : [
                { role: "system", content: translationPrompt },
                { role: "user", content: JSON.stringify(payload) }
              ],
          stream: false,
          temperature: 0.2
        }
      });
    };

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

async function translateWithTranslationModel(segments, config, model, signal) {
  const chunks = splitTranslationSegments(segments);
  const translated = [];

  for (const chunk of chunks) {
    const requestSegments = chunk.map((item) => ({
      id: String(item.id),
      text: shieldStructuredMarkers(String(item.text))
    }));
    const payload = { segments: requestSegments };
    const translationPrompt = buildTranslationModelPrompt(config);
    let structuredOutputEnabled = true;

    const request = async () => {
      const baseBody = {
        model,
        messages: [
          {
            role: "user",
            content: buildTranslationModelRequest(translationPrompt, payload)
          }
        ],
        stream: false,
        temperature: 0.7,
        top_p: 0.6,
        top_k: 20,
        repeat_penalty: 1.05,
        max_tokens: 4096
      };

      if (structuredOutputEnabled) {
        try {
          return await requestChatCompletions({
            url: buildChatCompletionsUrl(config.apiBaseUrl),
            apiKey: config.apiKey,
            providerLabel: "OpenAI-compatible",
            requireApiKey: false,
            signal,
            body: {
              ...baseBody,
              response_format: buildTranslationResponseFormat(requestSegments)
            }
          });
        } catch (error) {
          if (!isStructuredOutputUnsupported(error)) throw error;
          structuredOutputEnabled = false;
        }
      }

      return requestChatCompletions({
        url: buildChatCompletionsUrl(config.apiBaseUrl),
        apiKey: config.apiKey,
        providerLabel: "OpenAI-compatible",
        requireApiKey: false,
        signal,
        body: baseBody
      });
    };

    const chunkResult = await requestParsedTranslation({
      request,
      segments: requestSegments,
      providerLabel: "OpenAI-compatible"
    });

    translated.push(...chunkResult.map((item) => ({
      id: String(item.id),
      text: restoreStructuredMarkers(item.text)
    })));
  }

  return translated;
}

function buildTranslationModelPrompt(config) {
  return buildTranslationPrompt(
    config,
    "Translate the provided web-page segments into Simplified Chinese."
  )
    .split("\n")
    .filter((line) => {
      const normalized = line.trim().toLowerCase();
      if (!normalized) return true;
      if (normalized.includes("return valid json")) return false;
      if (normalized.includes("every input id must appear")) return false;
      if (normalized.includes("translateflow structured-marker protocol")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function buildTranslationModelRequest(translationPrompt, payload) {
  return [
    translationPrompt,
    "",
    "Translate every segments[].text value independently.",
    "Do not translate, delete, duplicate, reorder, or alter structural tokens matching [[TF_<number>_S]] or [[TF_<number>_E]].",
    "Keep technical identifiers, API names, variable names, URLs, and code-like tokens unchanged when appropriate.",
    "Return only data that conforms to the required response schema. Do not add explanations or Markdown fences.",
    "",
    "Input JSON:",
    JSON.stringify(payload)
  ].join("\n");
}

function buildTranslationResponseFormat(segments) {
  const properties = {};
  const required = [];

  for (const item of segments) {
    const id = String(item.id);
    properties[id] = { type: "string" };
    required.push(id);
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "translateflow_translation_batch",
      strict: true,
      schema: {
        type: "object",
        properties: {
          translations: {
            type: "object",
            properties,
            required,
            additionalProperties: false
          }
        },
        required: ["translations"],
        additionalProperties: false
      }
    }
  };
}

function buildInlineTranslationRequest(translationPrompt, payload) {
  return [
    translationPrompt,
    "",
    "Translate only each segments[].text value in the input JSON.",
    "Keep every id exactly unchanged and include every input id exactly once.",
    'Return valid JSON only, exactly in this shape: {"translations":[{"id":"...","text":"..."}]}.',
    "Do not add explanations or Markdown code fences.",
    "",
    "Input JSON:",
    JSON.stringify(payload)
  ].join("\n");
}

function splitTranslationSegments(segments) {
  const chunks = [];
  let current = [];
  let chars = 0;

  for (const segment of segments) {
    const item = { id: String(segment.id), text: String(segment.text) };
    const nextChars = chars + item.text.length;

    if (
      current.length > 0
      && (
        current.length >= LOCAL_TRANSLATION_MAX_ITEMS
        || nextChars > LOCAL_TRANSLATION_MAX_CHARS
      )
    ) {
      chunks.push(current);
      current = [];
      chars = 0;
    }

    current.push(item);
    chars += item.text.length;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function shieldStructuredMarkers(text) {
  return String(text || "").replace(
    STRUCTURED_MARKER_RE,
    (_match, id, kind) => `[[TF_${id}_${kind}]]`
  );
}

function restoreStructuredMarkers(text) {
  return String(text || "")
    .replace(
      SHIELDED_MARKER_RE,
      (_match, id, kind) => `⟦TF:${id}:${kind}⟧`
    )
    .replace(/\\:/g, ":");
}

function isStructuredOutputUnsupported(error) {
  const status = Number(error?.status || 0);
  return error?.code === "HTTP_ERROR" && (status === 400 || status === 404 || status === 422);
}

function isTranslationOptimizedModel(model) {
  const normalized = String(model || "").trim().toLowerCase();
  return /(^|[\/_:. -])(hy[-_]?mt(?:2)?|translategemma)(?=$|[\/_:. -])/.test(normalized);
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
