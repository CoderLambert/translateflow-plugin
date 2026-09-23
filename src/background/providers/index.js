import { PROVIDER_IDS } from "../../shared/constants.js";
import { deepSeekProvider } from "./deepseek.js";
import { openAICompatibleProvider } from "./openai-compatible.js";

const PROVIDERS = new Map([
  [deepSeekProvider.id, deepSeekProvider],
  [openAICompatibleProvider.id, openAICompatibleProvider]
]);

export function getProvider(config) {
  const providerId = String(config?.provider || PROVIDER_IDS.DEEPSEEK).trim().toLowerCase();
  const provider = PROVIDERS.get(providerId);
  if (!provider) throw new Error(`不支持的翻译 Provider：${providerId}`);
  return provider;
}

export async function translateBatch(segments, config) {
  return getProvider(config).translateBatch(segments, config);
}

export async function testProvider(config) {
  return getProvider(config).test(config);
}
