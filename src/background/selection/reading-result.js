import { getCacheContext } from "../cache-db.js";

// The same effective config used for the result/cache; no endpoint, prompt or credentials cross to Content.
export async function readingTranslationResult(pageUrl, config) {
  const { configHash } = await getCacheContext(pageUrl, config);
  return { targetLanguage: config.targetLanguage,
    provenance: { provider: config.provider, model: config.model,
      promptVersion: "translation-prompt-v1", providerConfigFingerprint: configHash } };
}
