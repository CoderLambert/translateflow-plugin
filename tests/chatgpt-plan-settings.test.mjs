import test from "node:test";
import assert from "node:assert/strict";
import { clearChatGPTPlanModelSelections, handleChatGPTPlanAction } from "../src/background/providers/chatgpt-plan-settings.js";

test("account change clears only ChatGPT model choices and preserves unrelated profile settings", async () => {
  const value = {
    provider: "chatgpt-plan",
    chatgptPlanModel: "old-account-model",
    siteProfiles: {
      "https://inherited-chatgpt.test": { model: "old-site-model", prompt: "preserve this" },
      "https://deepseek.test": { provider: "deepseek", model: "deepseek-flash" },
      "https://explicit-chatgpt.test": { provider: "chatgpt-plan", model: "old-explicit-model", appearance: "reading" },
      "https://empty.test": { provider: "openai-compatible", model: "external-model" }
    }
  };
  const writes = [];
  const storage = { async get() { return structuredClone(value); }, async set(patch) { writes.push(patch); Object.assign(value, patch); } };

  assert.equal(await clearChatGPTPlanModelSelections(storage), true);
  assert.equal(value.chatgptPlanModel, "");
  assert.deepEqual(value.siteProfiles["https://inherited-chatgpt.test"], { prompt: "preserve this" });
  assert.deepEqual(value.siteProfiles["https://deepseek.test"], { provider: "deepseek", model: "deepseek-flash" });
  assert.deepEqual(value.siteProfiles["https://explicit-chatgpt.test"], { provider: "chatgpt-plan", appearance: "reading" });
  assert.deepEqual(value.siteProfiles["https://empty.test"], { provider: "openai-compatible", model: "external-model" });
  assert.equal(writes.length, 1);
});

test("connect prepares the host and clears stale model choices before starting official sign-in", async () => {
  const value = { provider: "chatgpt-plan", chatgptPlanModel: "old-model", siteProfiles: {} };
  const order = [];
  const storage = { async get() { return structuredClone(value); }, async set(patch) { order.push("clear-model"); Object.assign(value, patch); } };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage } };
  try {
    const result = await handleChatGPTPlanAction("connect", {
      async ensureConnected() { order.push("host-ready"); },
      async startAuth() { order.push("sign-in"); return { connected: true }; }
    });
    assert.deepEqual(order, ["host-ready", "clear-model", "sign-in"]);
    assert.equal(result.modelSelectionCleared, true);
    assert.equal(value.chatgptPlanModel, "");
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test("failed sign-in reports that prior model selection was already cleared", async () => {
  const value = { provider: "chatgpt-plan", chatgptPlanModel: "old-model", siteProfiles: {} };
  const storage = { async get() { return structuredClone(value); }, async set(patch) { Object.assign(value, patch); } };
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage } };
  try {
    await assert.rejects(handleChatGPTPlanAction("connect", {
      async ensureConnected() {},
      async startAuth() { throw Object.assign(new Error("authorization failed"), { code: "AUTH_FAILED" }); }
    }), error => error.code === "AUTH_FAILED" && error.modelSelectionCleared === true);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

async function assertConnectAndLogoutClearForDefaultProvider(provider) {
  for (const action of ["connect", "logout"]) {
    const otherProvider = provider === "deepseek" ? "openai-compatible" : "deepseek";
    const value = {
      provider,
      chatgptPlanModel: "old-account-model",
      siteProfiles: {
        "https://inherits-default.test": { model: `keep-${provider}` },
        "https://explicit-chatgpt.test": { provider: "chatgpt-plan", model: "old-site-account-model", prompt: "keep prompt" },
        "https://other-provider.test": { provider: otherProvider, model: `keep-${otherProvider}` }
      }
    };
    const storage = { async get() { return structuredClone(value); }, async set(patch) { Object.assign(value, patch); } };
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { storage: { local: storage } };
    try {
      const result = await handleChatGPTPlanAction(action, {
        async ensureConnected() {},
        async startAuth() { return { connected: true }; },
        async logout() { return { connected: false }; }
      });

      assert.equal(result.modelSelectionCleared, true, `${action} under ${provider} should clear the dedicated account model`);
      assert.equal(value.chatgptPlanModel, "");
      assert.deepEqual(value.siteProfiles["https://inherits-default.test"], { model: `keep-${provider}` });
      assert.deepEqual(value.siteProfiles["https://explicit-chatgpt.test"], { provider: "chatgpt-plan", prompt: "keep prompt" });
      assert.deepEqual(value.siteProfiles["https://other-provider.test"], { provider: otherProvider, model: `keep-${otherProvider}` });
    } finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
    }
  }
}

test("connect and logout clear ChatGPT selections when DeepSeek is the default provider", async () => {
  await assertConnectAndLogoutClearForDefaultProvider("deepseek");
});

test("connect and logout clear ChatGPT selections when OpenAI-compatible is the default provider", async () => {
  await assertConnectAndLogoutClearForDefaultProvider("openai-compatible");
});
