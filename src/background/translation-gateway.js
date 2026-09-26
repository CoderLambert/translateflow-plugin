import { translateBatch } from "./providers/index.js";

const CAPABILITIES = Object.freeze({
  completionMode: "final",
  streaming: true,
  partialResults: false
});

export function getTranslationGatewayCapabilities() {
  return CAPABILITIES;
}

export async function executeTranslation({
  segments,
  config,
  signal,
  onProgress
}) {
  const input = Array.isArray(segments) ? segments : [];
  if (!input.length) return [];

  emitProgress(onProgress, {
    type: "started",
    completionMode: CAPABILITIES.completionMode,
    segmentCount: input.length
  });

  try {
    const translations = await translateBatch(input, config, {
      signal,
      onProgress: (event) => emitProgress(onProgress, {
        ...event,
        completionMode: CAPABILITIES.completionMode
      })
    });
    emitProgress(onProgress, {
      type: "completed",
      completionMode: CAPABILITIES.completionMode,
      segmentCount: input.length,
      translatedCount: Array.isArray(translations) ? translations.length : 0
    });
    return translations;
  } catch (error) {
    emitProgress(onProgress, {
      type: signal?.aborted ? "cancelled" : "failed",
      completionMode: CAPABILITIES.completionMode,
      segmentCount: input.length,
      errorCode: String(error?.code || "")
    });
    throw error;
  }
}

function emitProgress(listener, event) {
  if (typeof listener !== "function") return;
  try {
    listener(Object.freeze({ ...event }));
  } catch {
    // Progress observation must never change translation execution semantics.
  }
}
