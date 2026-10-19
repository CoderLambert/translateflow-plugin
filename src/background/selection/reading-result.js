import { getConfigHash } from "../cache-db.js";

// Fingerprint the exact effective config used for the Provider call. Page
// locators and credentials never enter the saved provenance DTO.
export async function readingTranslationResult(config) {
  const configHash = await getConfigHash(config);
  return { targetLanguage: config.targetLanguage,
    provenance: { provider: config.provider, model: config.model,
      promptVersion: config.engine === "machine-translation" ? "mt-adapter-v1" : "translation-prompt-v1", providerConfigFingerprint: configHash } };
}
