import { buildProviderProtocolUrl } from "../../shared/provider-connections.js";
import { openAIAuthenticationHeaders, requestParsedTranslation, requestProviderJson } from "./shared.js";
import { assertConnectionPermission, exactTestResult, optionalGenerationSettings, parseTranslationText, requestParsedStructuredText, requireConnectionConfig, translationInput } from "./native-protocol-shared.js";

export const openAIResponsesProvider = Object.freeze({
  id: "openai-responses",
  async translateBatch(segments, config, { signal } = {}) {
    if (!Array.isArray(segments) || !segments.length) return [];
    const request = () => complete(translationInput(segments, config), config, signal);
    return requestParsedTranslation({ request, segments, providerLabel: label(config), parseResult: (data, values, name) => parseTranslationText(extract(data), values, name) });
  },
  async completeJson({ systemPrompt, payload, parseResult } = {}, config, { signal } = {}) {
    return requestParsedStructuredText({ request: () => complete({ systemPrompt, prompt: JSON.stringify(payload || {}) }, config, signal), extract, parseResult, providerLabel: label(config) });
  },
  async completeText(input, config, { signal } = {}) { return { text: extract(await complete(input, config, signal)), mode: "unary" }; },
  async test(config) { return exactTestResult(extract(await complete({ systemPrompt: "Reply with exactly: OK", prompt: "Connection test" }, config)), label(config)); }
});

async function complete({ systemPrompt, prompt } = {}, config, signal) {
  const { model, apiKey, label: providerLabel } = requireConnectionConfig(config, "OpenAI Responses");
  await assertConnectionPermission(config.apiBaseUrl, providerLabel);
  return requestProviderJson({ url: buildProviderProtocolUrl({ ...connection(config), protocol: "openai-responses" }, model),
    headers: openAIAuthenticationHeaders(config, apiKey), providerLabel, signal,
    body: { model, instructions: String(systemPrompt || ""), input: String(prompt || ""),
      ...optionalGenerationSettings(config, { temperature: "temperature", outputTokens: "max_output_tokens" }) } });
}
function extract(data) { if (typeof data?.output_text === "string") return data.output_text; return (data?.output || []).flatMap(item => item?.content || []).filter(item => item?.type === "output_text").map(item => item.text || "").join(""); }
function connection(config) { return { id: config.connectionId || "runtime", revision: 1, name: label(config), platform: config.platform || "custom", baseUrl: config.apiBaseUrl, credentialId: "runtime", defaultModel: config.model, settings: { allowEmptyApiKey: config.allowEmptyApiKey, allowInsecureHttp: config.allowInsecureHttp } }; }
function label(config) { return String(config?.providerLabel || "OpenAI Responses"); }
