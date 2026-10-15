import { buildProviderProtocolUrl } from "../../shared/provider-connections.js";
import { requestParsedTranslation, requestProviderJson } from "./shared.js";
import { assertConnectionPermission, exactTestResult, parseTranslationText, requestParsedStructuredText, requireConnectionConfig, translationInput } from "./native-protocol-shared.js";

export const geminiGenerateProvider = Object.freeze({
  id: "gemini-generate",
  async translateBatch(segments, config, { signal } = {}) { if (!segments?.length) return []; const request = () => complete(translationInput(segments, config), config, signal);
    return requestParsedTranslation({ request, segments, providerLabel: label(config), parseResult: (data, values, name) => parseTranslationText(extract(data), values, name) }); },
  async completeJson({ systemPrompt, payload, parseResult } = {}, config, { signal } = {}) { return requestParsedStructuredText({ request: () => complete({ systemPrompt, prompt: JSON.stringify(payload || {}) }, config, signal), extract, parseResult, providerLabel: label(config) }); },
  async completeText(input, config, { signal } = {}) { return { text: extract(await complete(input, config, signal)), mode: "unary" }; },
  async test(config) { return exactTestResult(extract(await complete({ systemPrompt: "Reply with exactly: OK", prompt: "Connection test" }, config)), label(config)); }
});
async function complete({ systemPrompt, prompt } = {}, config, signal) { const { model, apiKey, label: providerLabel } = requireConnectionConfig(config, "Gemini generateContent"); await assertConnectionPermission(config.apiBaseUrl, providerLabel);
  const generationConfig = {}; if (Number.isFinite(config?.temperature)) generationConfig.temperature = Number(config.temperature); if (Number.isSafeInteger(config?.outputTokens)) generationConfig.maxOutputTokens = config.outputTokens;
  return requestProviderJson({ url: buildProviderProtocolUrl({ ...connection(config), protocol: "gemini-generate" }, model), headers: apiKey ? { "x-goog-api-key": apiKey } : {}, providerLabel, signal,
    body: { systemInstruction: { parts: [{ text: String(systemPrompt || "") }] }, contents: [{ role: "user", parts: [{ text: String(prompt || "") }] }], generationConfig } }); }
function extract(data) { return (data?.candidates?.[0]?.content?.parts || []).map(item => item?.text || "").join(""); }
function connection(config) { return { id: config.connectionId || "runtime", revision: 1, name: label(config), platform: config.platform || "gemini", baseUrl: config.apiBaseUrl, credentialId: "runtime", defaultModel: config.model, settings: { allowEmptyApiKey: config.allowEmptyApiKey, allowInsecureHttp: config.allowInsecureHttp } }; }
function label(config) { return String(config?.providerLabel || "Gemini generateContent"); }
