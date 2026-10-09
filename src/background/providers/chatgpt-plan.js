import { PROVIDER_IDS } from "../../shared/constants.js";
import { buildTranslationPrompt, ProviderRequestError } from "./shared.js";
import { NativeHostError, nativeMessagingClient } from "./native-messaging.js";

const PROVIDER_LABEL = "ChatGPT subscription";
const MAX_INSTRUCTIONS_BYTES = 16 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_STREAM_DELTA_CHARS = 2048;

export function createChatGPTPlanProvider({ nativeClient = nativeMessagingClient } = {}) {
  return Object.freeze({
    id: PROVIDER_IDS.CHATGPT_PLAN,
    streaming: true,

    async translateBatch(segments, config, { signal, onProgress } = {}) {
      if (!Array.isArray(segments) || segments.length === 0) return [];
      const instructions = `${buildTranslationPrompt(config, "Translate to the requested target language and return JSON only.")}\nReturn exactly one JSON object with a translations array. Each input id must appear once.`;
      const input = JSON.stringify({ segments: segments.map(item => ({ id: String(item.id), text: String(item.text) })) });
      validateInferenceInput(requireModel(config?.model), instructions, input);
      let outputChars = 0;
      const result = await nativeClient.infer({ model: config.model, instructions, input }, {
        signal,
        onDelta(delta) {
          outputChars += delta.length;
          emitProgress(onProgress, { type: "streaming", outputChars });
        }
      });
      return parseTranslations(result.text, segments);
    },

    async completeJson({ systemPrompt, payload, parseResult = value => value } = {}, config, { signal } = {}) {
      const instructions = String(systemPrompt || "");
      const input = JSON.stringify(payload || {});
      validateInferenceInput(requireModel(config?.model), instructions, input);
      const result = await nativeClient.infer({ model: config.model, instructions, input }, { signal });
      let parsed;
      try { parsed = JSON.parse(result.text); }
      catch (cause) { throw malformedResponse("ChatGPT returned invalid structured JSON.", cause); }
      try { return parseResult(parsed); }
      catch (cause) {
        if (cause instanceof ProviderRequestError) throw cause;
        throw malformedResponse("ChatGPT returned structured content that does not match the Selection contract.", cause);
      }
    },

    async completeText({ systemPrompt, prompt } = {}, config, { signal, onDelta } = {}) {
      const instructions = String(systemPrompt || "");
      const input = String(prompt || "");
      validateInferenceInput(requireModel(config?.model), instructions, input);
      let streamed = "";
      const result = await nativeClient.infer({ model: config.model, instructions, input }, {
        signal,
        onDelta(delta) {
          const text = String(delta || "");
          streamed += text;
          emitBoundedDeltas(text, onDelta, signal);
        }
      });
      const text = String(result.text || "");
      if (!text || text !== streamed) {
        throw new ProviderRequestError("ChatGPT's completed response did not match its stream.", { code: "NATIVE_HOST_PROTOCOL" });
      }
      return { text, mode: "stream" };
    },

    async test() {
      const status = await nativeClient.authStatus();
      requireInferenceAccess(status);
      const result = await nativeClient.listModels();
      const count = Array.isArray(result.models) ? result.models.length : 0;
      return `${PROVIDER_LABEL} connected; ${count} models available.`;
    }
  });
}

export const chatGPTPlanProvider = createChatGPTPlanProvider();
export function createChatGPTPlanController(client = nativeMessagingClient) {
  return Object.freeze({
    ensureConnected: () => client.ensureConnected(),
    authStatus: () => client.authStatus(),
    startAuth: options => client.startAuth(options),
    selectAccount: accountId => client.selectAccount(accountId),
    logout: () => client.logout(),
    listModels: () => client.listModels()
  });
}

export const chatGPTPlanController = createChatGPTPlanController();

function requireInferenceAccess(status) {
  if (status?.connected && status?.canInfer) return;
  const code = status?.connected ? "RECONNECT_REQUIRED" : "NOT_CONNECTED";
  throw new NativeHostError(code, "Connect a ChatGPT account with plan access in Settings.");
}

function requireModel(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 128) {
    throw new ProviderRequestError("Select a ChatGPT model in Settings before using this provider.", { code: "CHATGPT_MODEL_REQUIRED" });
  }
  return model;
}

function validateInferenceInput(model, instructions, input) {
  if (new TextEncoder().encode(model).length > 128 || new TextEncoder().encode(instructions).length > MAX_INSTRUCTIONS_BYTES ||
    !input || new TextEncoder().encode(input).length > MAX_INPUT_BYTES) {
    throw new ProviderRequestError("The ChatGPT request exceeded the local host's input limits.", { code: "LIMIT" });
  }
}

function parseTranslations(raw, segments) {
  let parsed;
  try { parsed = JSON.parse(String(raw || "")); }
  catch (cause) { throw malformedResponse("ChatGPT returned invalid translation JSON.", cause); }
  if (!Array.isArray(parsed?.translations)) throw malformedResponse("ChatGPT returned no translations array.");
  const expected = new Map(segments.map(item => [String(item.id), item]));
  const values = new Map();
  for (const item of parsed.translations) {
    const id = String(item?.id || "");
    if (!expected.has(id) || values.has(id) || typeof item.text !== "string" || !item.text.trim()) {
      throw malformedResponse("ChatGPT returned an invalid translation set.");
    }
    values.set(id, item.text.trim());
  }
  if (values.size !== expected.size) throw malformedResponse("ChatGPT did not translate every input segment.");
  return [...expected.keys()].map(id => ({ id, text: values.get(id) }));
}

function malformedResponse(message, cause) {
  return new ProviderRequestError(message, { code: "MALFORMED_RESPONSE", cause });
}

function emitProgress(listener, event) {
  if (typeof listener !== "function") return;
  try { listener(Object.freeze({ ...event })); } catch {}
}

function emitBoundedDeltas(text, listener, signal) {
  if (typeof listener !== "function") return;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + MAX_STREAM_DELTA_CHARS, text.length);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end -= 1;
    if (signal?.aborted) return;
    listener(text.slice(start, end));
    start = end;
  }
}

function isHighSurrogate(code) { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code) { return code >= 0xdc00 && code <= 0xdfff; }
