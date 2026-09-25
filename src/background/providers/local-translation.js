import {
  ProviderRequestError,
  buildTranslationPrompt
} from "./shared.js";

export const LOCAL_BATCH_MAX_SEGMENTS = 8;
export const LOCAL_BATCH_MAX_CHARS = 3200;

export function isLocalTranslationModel(model) {
  const value = String(model || "").trim().toLowerCase();
  if (!value) return false;
  return [
    "hy-mt",
    "hy_mt",
    "hy.mt",
    "translate-gemma",
    "translate_gemma",
    "translategemma"
  ].some((hint) => value.includes(hint));
}

export function splitLocalTranslationBatches(
  segments,
  { maxSegments = LOCAL_BATCH_MAX_SEGMENTS, maxChars = LOCAL_BATCH_MAX_CHARS } = {}
) {
  const normalized = (Array.isArray(segments) ? segments : []).map((item) => ({
    id: String(item?.id ?? ""),
    text: String(item?.text ?? "")
  }));
  const batches = [];
  let current = [];
  let chars = 0;

  for (const segment of normalized) {
    const size = segment.text.length;
    if (current.length && (current.length >= maxSegments || chars + size > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += size;
  }

  if (current.length) batches.push(current);
  return batches;
}

export function encodeLocalMarkers(text) {
  return String(text || "").replace(/⟦TF:(\d+):([SE])⟧/g, "[[TF_$1_$2]]");
}

export function decodeLocalMarkers(text) {
  return String(text || "").replace(/\[\[TF_(\d+)_([SE])\]\]/g, "⟦TF:$1:$2⟧");
}

export function buildLocalTranslationRequestBody({
  segments,
  config,
  model,
  useStructuredOutput = true
}) {
  const prepared = (Array.isArray(segments) ? segments : []).map((item) => ({
    id: String(item.id),
    text: encodeLocalMarkers(item.text)
  }));
  const ids = prepared.map((item) => item.id);
  const prompt = normalizeMarkerPrompt(buildTranslationPrompt(
    config,
    "Translate to Simplified Chinese."
  ));
  const markerInstruction = prepared.some((item) => /\[\[TF_\d+_[SE]\]\]/.test(item.text))
    ? "Preserve every marker matching [[TF_<number>_S]] or [[TF_<number>_E]] exactly; do not translate, remove, reorder, or alter it."
    : "";
  const outputContract = [
    'Return JSON only in this shape: {"translations":{"<id>":"<translation>"}}.',
    "Return every input id exactly once. Do not add unknown ids."
  ].join(" ");

  const body = {
    model,
    messages: [{
      role: "user",
      content: [
        prompt,
        markerInstruction,
        outputContract,
        `Input JSON:\n${JSON.stringify({ segments: prepared })}`
      ].filter(Boolean).join("\n\n")
    }],
    stream: false,
    temperature: 0.2
  };

  if (useStructuredOutput) {
    body.response_format = buildLocalResponseFormat(ids);
  }
  return body;
}

export function parseLocalTranslationResult(data, segments, providerLabel = "OpenAI-compatible") {
  const message = data?.choices?.[0]?.message;
  const raw = message?.parsed ?? message?.content;
  if (raw === undefined || raw === null || raw === "") {
    throw malformed(providerLabel, "没有返回翻译内容。");
  }

  const parsed = typeof raw === "string" ? parseJsonValue(raw, providerLabel) : raw;
  const items = normalizeTranslationItems(parsed, providerLabel);
  const expectedIds = (Array.isArray(segments) ? segments : []).map((item) => String(item.id));
  const expectedSet = new Set(expectedIds);
  const byId = new Map();

  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!expectedSet.has(id)) {
      throw malformed(providerLabel, `返回了未知 id：${id || "(empty)"}。`);
    }
    if (byId.has(id)) {
      throw malformed(providerLabel, `重复返回 id：${id}。`);
    }
    if (typeof item?.text !== "string") {
      throw malformed(providerLabel, `id ${id} 的翻译不是字符串。`);
    }
    byId.set(id, decodeLocalMarkers(item.text.trim()));
  }

  const missing = expectedIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw malformed(providerLabel, `缺少翻译 id：${missing.join(", ")}。`);
  }

  return expectedIds.map((id) => ({ id, text: byId.get(id) }));
}

export function isUnsupportedStructuredOutputError(error) {
  if (!error || error.code !== "HTTP_ERROR") return false;
  if (![400, 404, 415, 422].includes(Number(error.status || 0))) return false;
  return /response[_ -]?format|json[_ -]?schema|structured|schema|unsupported|not supported|unrecognized.*argument/i
    .test(String(error.message || ""));
}

function buildLocalResponseFormat(ids) {
  const properties = Object.fromEntries(ids.map((id) => [id, { type: "string" }]));
  return {
    type: "json_schema",
    json_schema: {
      name: "translateflow_translations",
      strict: true,
      schema: {
        type: "object",
        properties: {
          translations: {
            type: "object",
            properties,
            required: ids,
            additionalProperties: false
          }
        },
        required: ["translations"],
        additionalProperties: false
      }
    }
  };
}

function normalizeMarkerPrompt(prompt) {
  return String(prompt || "")
    .replaceAll("⟦TF:<number>:S⟧", "[[TF_<number>_S]]")
    .replaceAll("⟦TF:<number>:E⟧", "[[TF_<number>_E]]");
}

function normalizeTranslationItems(parsed, providerLabel) {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") {
    throw malformed(providerLabel, "返回 JSON 不是对象或数组。");
  }

  if (Array.isArray(parsed.translations)) return parsed.translations;
  if (isPlainObject(parsed.translations)) return mapToItems(parsed.translations);
  if (Array.isArray(parsed.segments)) return parsed.segments;
  if (isPlainObject(parsed.segments)) return mapToItems(parsed.segments);

  throw malformed(providerLabel, "返回格式缺少 translations 或 segments。");
}

function mapToItems(value) {
  return Object.entries(value).map(([id, entry]) => ({
    id,
    text: typeof entry === "string" ? entry : entry?.text
  }));
}

function parseJsonValue(content, providerLabel) {
  const trimmed = String(content || "").trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {}

  const objectStart = unfenced.indexOf("{");
  const arrayStart = unfenced.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length) {
    const start = Math.min(...starts);
    const closing = unfenced[start] === "{" ? "}" : "]";
    const end = unfenced.lastIndexOf(closing);
    if (end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {}
    }
  }

  throw malformed(providerLabel, "返回内容无法解析为 JSON。");
}

function malformed(providerLabel, detail) {
  return new ProviderRequestError(`${providerLabel} ${detail}`, {
    code: "MALFORMED_RESPONSE"
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
