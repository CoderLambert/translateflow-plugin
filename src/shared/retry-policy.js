export const DEFAULT_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  malformedMaxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 4000,
  requestTimeoutMs: 45000
});

export function classifyProviderFailure({ status = 0, code = "" } = {}) {
  const normalizedCode = String(code || "").toUpperCase();

  if (normalizedCode === "CANCELLED") {
    return { retryable: false, category: "cancelled" };
  }
  if (["CONFIG", "AUTH", "PERMISSION"].includes(normalizedCode)) {
    return { retryable: false, category: "configuration" };
  }
  if (normalizedCode === "MALFORMED_RESPONSE") {
    return { retryable: true, category: "malformed" };
  }
  if (normalizedCode === "NETWORK" || normalizedCode === "TIMEOUT") {
    return { retryable: true, category: normalizedCode.toLowerCase() };
  }

  const httpStatus = Number(status || 0);
  if (httpStatus === 408 || httpStatus === 425 || httpStatus === 429 || httpStatus >= 500) {
    return { retryable: true, category: httpStatus === 429 ? "rate-limit" : "http-transient" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { retryable: false, category: "auth" };
  }
  if (httpStatus >= 400) {
    return { retryable: false, category: "http-permanent" };
  }

  return { retryable: false, category: "unknown" };
}

export function getMaxAttemptsForFailure(failure, policy = DEFAULT_RETRY_POLICY) {
  const { category, retryable } = classifyProviderFailure(failure);
  if (!retryable) return 1;
  if (category === "malformed") return Number(policy.malformedMaxAttempts || 2);
  return Number(policy.maxAttempts || 3);
}

export function computeRetryDelayMs({
  attempt,
  retryAfterMs = 0,
  baseDelayMs = DEFAULT_RETRY_POLICY.baseDelayMs,
  maxDelayMs = DEFAULT_RETRY_POLICY.maxDelayMs
}) {
  const serverDelay = Math.max(0, Number(retryAfterMs) || 0);
  if (serverDelay > 0) return Math.min(serverDelay, maxDelayMs);
  const exponent = Math.max(0, Number(attempt || 1) - 1);
  return Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
}

export function parseRetryAfterMs(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, timestamp - now);
}
