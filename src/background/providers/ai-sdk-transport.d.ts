// Public contract of the JS transport. Vendor declarations stay behind this boundary:
// ai@7.0.170 publishes types incompatible with exactOptionalPropertyTypes.
export type SdkCompletionOptions = {
  config?: Record<string, unknown>;
  url?: string; apiKey?: string; body?: Record<string, unknown>;
  providerLabel?: string; requireApiKey?: boolean; signal?: AbortSignal;
  retryPolicy?: { maxAttempts: number; malformedMaxAttempts: number; baseDelayMs: number; maxDelayMs: number; requestTimeoutMs: number };
  timeoutMs?: number; stream?: boolean;
  onProgress?: (event: {type: string; receivedChars: number; eventCount: number}) => void;
  onTextDelta?: (text: string) => void;
};
export function requestSdkCompletion(options: SdkCompletionOptions): Promise<{choices: Array<{message: {content: string}; finish_reason: string}>}>;
