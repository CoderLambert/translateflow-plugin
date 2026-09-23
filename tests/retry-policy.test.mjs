import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyProviderFailure,
  computeRetryDelayMs,
  getMaxAttemptsForFailure,
  parseRetryAfterMs
} from "../src/shared/retry-policy.js";

test("retry policy retries transient failures but not auth/config failures", () => {
  assert.equal(classifyProviderFailure({ status: 429 }).retryable, true);
  assert.equal(classifyProviderFailure({ status: 503 }).retryable, true);
  assert.equal(classifyProviderFailure({ code: "NETWORK" }).retryable, true);
  assert.equal(classifyProviderFailure({ code: "TIMEOUT" }).retryable, true);
  assert.equal(classifyProviderFailure({ status: 401 }).retryable, false);
  assert.equal(classifyProviderFailure({ code: "CONFIG" }).retryable, false);
  assert.equal(classifyProviderFailure({ code: "PERMISSION" }).retryable, false);
});

test("malformed responses get at most one safe retry by default", () => {
  assert.equal(getMaxAttemptsForFailure({ code: "MALFORMED_RESPONSE" }), 2);
});

test("retry delay uses exponential backoff and honors Retry-After", () => {
  assert.equal(computeRetryDelayMs({ attempt: 1, baseDelayMs: 500, maxDelayMs: 5000 }), 500);
  assert.equal(computeRetryDelayMs({ attempt: 3, baseDelayMs: 500, maxDelayMs: 5000 }), 2000);
  assert.equal(computeRetryDelayMs({
    attempt: 1,
    retryAfterMs: 3000,
    baseDelayMs: 500,
    maxDelayMs: 5000
  }), 3000);
});

test("Retry-After parser supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("2", 0), 2000);
  const now = Date.parse("2026-09-23T00:00:00Z");
  assert.equal(
    parseRetryAfterMs("Wed, 23 Sep 2026 00:00:03 GMT", now),
    3000
  );
});
