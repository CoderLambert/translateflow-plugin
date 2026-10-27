import { withProviderLifetime } from "../provider-lifetime.js";
import { MACHINE_ENGINE } from "../../shared/machine-translation.js";
import { translateMachineRoute } from "./machine-translation-routing.js";
import { PROVIDER_IDS } from "../../shared/constants.js";
import { requireChatGPTPlanDeveloperBuild } from "../../shared/chatgpt-native-host.js";
import { deepSeekProvider } from "./deepseek.js";
import { openAIChatProvider, openAICompatibleProvider } from "./openai-compatible.js";
import { chatGPTPlanProvider } from "./chatgpt-plan.js";
import { openAIResponsesProvider } from "./openai-responses.js";
import { anthropicMessagesProvider } from "./anthropic-messages.js";
import { geminiGenerateProvider } from "./gemini-generate.js";

const PROVIDERS = new Map([
  [deepSeekProvider.id, deepSeekProvider],
  [openAICompatibleProvider.id, openAICompatibleProvider],
  [openAIChatProvider.id, openAIChatProvider],
  [openAIResponsesProvider.id, openAIResponsesProvider],
  [anthropicMessagesProvider.id, anthropicMessagesProvider],
  [geminiGenerateProvider.id, geminiGenerateProvider],
  [chatGPTPlanProvider.id, chatGPTPlanProvider]
]);

export function getProvider(config) {
  const providerId = String(config?.provider || PROVIDER_IDS.DEEPSEEK).trim().toLowerCase();
  if (providerId === PROVIDER_IDS.CHATGPT_PLAN) requireChatGPTPlanDeveloperBuild(globalThis.chrome?.runtime?.getManifest?.());
  const provider = PROVIDERS.get(providerId);
  if (!provider) throw new Error(`不支持的翻译 Provider：${providerId}`);
  return provider;
}

export async function translateBatch(segments, config, options = {}) {
  return withProviderLifetime(() => config?.engine === MACHINE_ENGINE
    ? translateMachineRoute(segments, config, options)
    : getProvider(config).translateBatch(segments, config, options));
}

export async function completeJson(input, config, options = {}) {
  const provider = getProvider(config);
  if (typeof provider.completeJson !== "function") {
    throw new Error(`Provider 不支持结构化 Selection explanation：${provider.id}`);
  }
  return withProviderLifetime(() => provider.completeJson(input, config, options));
}

export async function completeText(input, config, options = {}) {
  return withProviderLifetime(() => getProvider(config).completeText(input, config, options));
}

export async function testProvider(config) {
  return withProviderLifetime(() => getProvider(config).test(config));
}
