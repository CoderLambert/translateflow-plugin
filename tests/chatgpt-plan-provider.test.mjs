import test from "node:test";
import assert from "node:assert/strict";
import { getProvider } from "../src/background/providers/index.js";
import { createChatGPTPlanController, createChatGPTPlanProvider } from "../src/background/providers/chatgpt-plan.js";
import { ProviderRequestError } from "../src/background/providers/shared.js";

function fixtureClient(reply) {
  const calls = [];
  return {
    calls,
    async infer(input, options = {}) {
      calls.push({ input, options });
      const value = await reply(input, options, calls.length);
      for (const delta of value.deltas || []) options.onDelta?.(delta);
      if (value.error) throw value.error;
      return { text: value.text };
    },
    async authStatus() { calls.push({ method: "auth.status" }); return { connected: true, canInfer: true }; },
    async listModels() { calls.push({ method: "models.list" }); return { models: [{ slug: "fixture", displayName: "Fixture" }] }; }
  };
}

test("ChatGPT subscription is registered as a shared Provider", () => {
  assert.equal(getProvider({ provider: "chatgpt-plan" }).id, "chatgpt-plan");
});

test("translation uses the injected host once and validates exact response IDs", async () => {
  const client = fixtureClient(async () => ({
    text: JSON.stringify({ translations: [{ id: "b", text: "第二" }, { id: "a", text: "第一" }] })
  }));
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  const result = await provider.translateBatch([{ id: "a", text: "one" }, { id: "b", text: "two" }], {
    model: "fixture-model", prompt: "Translate naturally.", targetLanguage: "Chinese", apiKey: "must-not-be-used"
  });

  assert.deepEqual(result, [{ id: "a", text: "第一" }, { id: "b", text: "第二" }]);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].input, {
    model: "fixture-model",
    instructions: "Translate naturally.\nTarget language: Chinese.\nReturn exactly one JSON object with a translations array. Each input id must appear once.",
    input: JSON.stringify({ segments: [{ id: "a", text: "one" }, { id: "b", text: "two" }] })
  });
});

test("malformed or duplicate translations fail without retry or API-key fallback", async () => {
  const client = fixtureClient(async () => ({ text: JSON.stringify({ translations: [
    { id: "a", text: "first" }, { id: "a", text: "second" }
  ] }) }));
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  await assert.rejects(provider.translateBatch([{ id: "a", text: "one" }], { model: "fixture" }),
    error => error instanceof ProviderRequestError && error.code === "MALFORMED_RESPONSE");
  assert.equal(client.calls.length, 1);
});

test("Selection JSON and learning text consume only a completed matching stream", async () => {
  const client = fixtureClient(async (_input, _options, index) => index === 1
    ? { text: "{\"answer\":\"explained\"}" }
    : { text: "A complete answer", deltas: ["A complete ", "answer"] });
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  const parsed = await provider.completeJson({ systemPrompt: "JSON only", payload: { text: "selection" }, parseResult: value => value.answer }, { model: "fixture" });
  const deltas = [];
  const complete = await provider.completeText({ systemPrompt: "Plain text", prompt: "follow-up" }, { model: "fixture" }, { onDelta: value => deltas.push(value) });

  assert.equal(parsed, "explained");
  assert.deepEqual(deltas, ["A complete ", "answer"]);
  assert.deepEqual(complete, { text: "A complete answer", mode: "stream" });
  assert.equal(client.calls.length, 2);
});

test("large native deltas are bounded without changing text or splitting a surrogate pair", async () => {
  const ascii = "a".repeat(2049);
  const crossBoundary = `${"b".repeat(2047)}🧠z`;
  const client = fixtureClient(async (_input, _options, index) => ({
    text: index === 1 ? ascii : crossBoundary,
    deltas: [index === 1 ? ascii : crossBoundary]
  }));
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  const first = [];
  const result1 = await provider.completeText({ prompt: "ascii" }, { model: "fixture" }, { onDelta: delta => first.push(delta) });
  const second = [];
  const result2 = await provider.completeText({ prompt: "unicode" }, { model: "fixture" }, { onDelta: delta => second.push(delta) });

  assert.deepEqual(first.map(delta => delta.length), [2048, 1]);
  assert.equal(first.join(""), ascii);
  assert.deepEqual(result1, { text: ascii, mode: "stream" });
  assert.deepEqual(second.map(delta => delta.length), [2047, 3]);
  assert.equal(second.join(""), crossBoundary);
  assert.equal(second[1].startsWith("🧠"), true);
  assert.deepEqual(result2, { text: crossBoundary, mode: "stream" });
});

test("an incomplete/mismatched host stream is rejected and the host error is preserved", async () => {
  const mismatch = createChatGPTPlanProvider({ nativeClient: fixtureClient(async () => ({ text: "complete", deltas: ["partial"] })) });
  await assert.rejects(mismatch.completeText({ prompt: "q" }, { model: "fixture" }), { code: "NATIVE_HOST_PROTOCOL" });

  const failure = new ProviderRequestError("incomplete fixture", { code: "INFERENCE_INCOMPLETE" });
  const failed = createChatGPTPlanProvider({ nativeClient: fixtureClient(async () => ({ error: failure })) });
  await assert.rejects(failed.completeText({ prompt: "q" }, { model: "fixture" }), error => error === failure);
});

test("model and host input limits are enforced before any host call", async () => {
  const client = fixtureClient(async () => ({ text: "unused" }));
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  await assert.rejects(provider.completeText({ prompt: "q" }, { model: "" }), { code: "CHATGPT_MODEL_REQUIRED" });
  await assert.rejects(provider.completeText({ systemPrompt: "x".repeat(16 * 1024 + 1), prompt: "q" }, { model: "fixture" }), { code: "LIMIT" });
  assert.equal(client.calls.length, 0);
});

test("provider check reads account/model status and does not infer", async () => {
  const client = fixtureClient(async () => assert.fail("status must not call inference"));
  const provider = createChatGPTPlanProvider({ nativeClient: client });
  assert.equal(await provider.test({}), "ChatGPT subscription connected; 1 models available.");
  assert.deepEqual(client.calls.map(value => value.method), ["auth.status", "models.list"]);
});

test("production controller forwards add-account and account selection to the native client", async () => {
  const calls = [];
  const controller = createChatGPTPlanController({
    async ensureConnected() { calls.push(["ready"]); },
    async authStatus() { calls.push(["status"]); return {}; },
    async startAuth(options) { calls.push(["auth", options]); return {}; },
    async selectAccount(accountId) { calls.push(["select", accountId]); return {}; },
    async logout() { calls.push(["logout"]); return {}; },
    async listModels() { calls.push(["models"]); return {}; }
  });

  await controller.ensureConnected();
  await controller.startAuth({ addAccount: true });
  await controller.selectAccount("account-second");
  assert.deepEqual(calls, [["ready"], ["auth", { addAccount: true }], ["select", "account-second"]]);
});
