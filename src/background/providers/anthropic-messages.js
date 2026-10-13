import { buildProviderProtocolUrl } from "../../shared/provider-connections.js";
import { requestParsedTranslation, requestProviderJson } from "./shared.js";
import { assertConnectionPermission, exactTestResult, optionalGenerationSettings, parseTranslationText, requestParsedStructuredText, requireConnectionConfig, translationInput } from "./native-protocol-shared.js";

export const anthropicMessagesProvider = Object.freeze({
  id: "anthropic-messages",
  async translateBatch(segments, config, { signal } = {}) { if (!segments?.length) return []; const request = () => complete(translationInput(segments, config), config, signal);
    return requestParsedTranslation({ request, segments, providerLabel: label(config), parseResult: (data, values, name) => parseTranslationText(extract(data), values, name) }); },
  async completeJson({ systemPrompt, payload, parseResult } = {}, config, { signal } = {}) { return requestParsedStructuredText({ request: () => complete({ systemPrompt, prompt: JSON.stringify(payload || {}) }, config, signal), extract, parseResult, providerLabel: label(config) }); },
  async completeText(input, config, { signal } = {}) { return { text: extract(await complete(input, config, signal)), mode: "unary" }; },
  async test(config) { return exactTestResult(extract(await complete({ systemPrompt: "Reply with exactly: OK", prompt: "Connection test" }, config)), label(config)); }
});
async function complete({ systemPrompt, prompt } = {}, config, signal) { const { model, apiKey, label: providerLabel } = requireConnectionConfig(config, "Anthropic Messages"); await assertConnectionPermission(config.apiBaseUrl, providerLabel);
  return requestProviderJson({ url: buildProviderProtocolUrl({ ...connection(config), protocol: "anthropic-messages" }, model), headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, providerLabel, signal,
    body: { model, system: String(systemPrompt || ""), messages: [{ role: "user", content: String(prompt || "") }], ...optionalGenerationSettings(config) } }); }
function extract(data) { return (data?.content || []).filter(item => item?.type === "text").map(item => item.text || "").join(""); }
function connection(config) { return { id: config.connectionId || "runtime", revision: 1, name: label(config), platform: config.platform || "anthropic", baseUrl: config.apiBaseUrl, credentialId: "runtime", defaultModel: config.model, settings: { allowEmptyApiKey: config.allowEmptyApiKey, allowInsecureHttp: config.allowInsecureHttp } }; }
function label(config) { return String(config?.providerLabel || "Anthropic Messages"); }
