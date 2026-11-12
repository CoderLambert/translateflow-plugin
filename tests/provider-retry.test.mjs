import { providerResponse } from "./support/provider-response.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { requestChatCompletions } from "../src/background/providers/shared.js";

function response(status, payload, headers = {}) { return providerResponse(status, payload, headers); }

test("provider request retries 429 and succeeds on the next attempt", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return response(429, { error: { message: "slow down" } }, { "Retry-After": "0" });
    }
    return response(200, { choices: [{ message: { content: "OK" } }] });
  };

  try {
    const result = await requestChatCompletions({
      url: "https://example.test/chat/completions",
      apiKey: "test",
      providerLabel: "Test",
      body: { model: "test-model", messages: [{ role: "user", content: "test" }] },
      retryPolicy: {
        maxAttempts: 2,
        malformedMaxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
        requestTimeoutMs: 1000
      }
    });
    assert.equal(calls, 2);
    assert.equal(result.choices[0].message.content, "OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider request does not retry auth failure", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(401, { error: { message: "bad key" } });
  };

  try {
    await assert.rejects(
      requestChatCompletions({
        url: "https://example.test/chat/completions",
        apiKey: "bad",
        providerLabel: "Test",
        body: { model: "test-model", messages: [{ role: "user", content: "test" }] },
        retryPolicy: {
          maxAttempts: 3,
          malformedMaxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
          requestTimeoutMs: 1000
        }
      }),
      (error) => error?.code === "AUTH" && error?.status === 401
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pre-aborted provider request never reaches fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(200, {});
  };

  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      requestChatCompletions({
        url: "https://example.test/chat/completions",
        apiKey: "test",
        providerLabel: "Test",
        body: { model: "test-model", messages: [{ role: "user", content: "test" }] },
        signal: controller.signal
      }),
      (error) => error?.code === "CANCELLED"
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
