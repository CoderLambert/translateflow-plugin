import { deepSeekProvider } from "./deepseek.js";

const PROVIDERS = new Map([
  [deepSeekProvider.id, deepSeekProvider]
]);

export function getProvider(config) {
  const providerId = String(config?.provider || "deepseek").trim().toLowerCase();
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
