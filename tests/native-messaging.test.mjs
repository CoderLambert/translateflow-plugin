import test from "node:test";
import assert from "node:assert/strict";
import { CHATGPT_PLAN_NATIVE_HOST, createNativeMessagingClient } from "../src/background/providers/native-messaging.js";

const CAPABILITIES = ["auth.status", "auth.start", "auth.select", "auth.logout", "models.list", "infer.start", "cancel"];

function fakeBrowser(handler, { permissions = ["nativeMessaging"], optionalPermissions = [], connectError = null } = {}) {
  const posted = [];
  const messages = new Set();
  const disconnects = new Set();
  const port = {
    postMessage(request) { posted.push(request); handler(request, port); },
    disconnect() { for (const listener of disconnects) listener(); },
    onMessage: { addListener(listener) { messages.add(listener); }, removeListener(listener) { messages.delete(listener); } },
    onDisconnect: { addListener(listener) { disconnects.add(listener); }, removeListener(listener) { disconnects.delete(listener); } },
    deliver(frame) { for (const listener of messages) listener(frame); }
  };
  let connects = 0;
  const browser = {
    runtime: {
      getManifest: () => ({ permissions, optional_permissions: optionalPermissions }),
      connectNative(name) { connects += 1; if (connectError) throw connectError; assert.equal(name, CHATGPT_PLAN_NATIVE_HOST); return port; },
      lastError: undefined
    },
    permissions: { contains: async () => false }
  };
  return { browser, port, posted, get connects() { return connects; } };
}

function reply(port, request, payload, sequence = 0) {
  port.deliver({ type: "terminal", requestId: request.requestId, sequence, ok: true, payload });
}

function fail(port, request, code, sequence = 0) {
  port.deliver({ type: "terminal", requestId: request.requestId, sequence, ok: false, error: { code, message: "fixture failure" } });
}

function helloOr(handler) {
  return (request, port) => {
    if (request.method === "hello") reply(port, request, { protocolVersion: 1, capabilities: CAPABILITIES });
    else handler(request, port);
  };
}

test("missing nativeMessaging permission is rejected before connectNative", async () => {
  const fixture = fakeBrowser(() => {}, { permissions: [] });
  const client = createNativeMessagingClient({ getBrowser: () => fixture.browser });
  await assert.rejects(client.ensureConnected(), { code: "NATIVE_MESSAGING_PERMISSION" });
  assert.equal(fixture.connects, 0);
});

test("ChatGPT host handshake, status, model list, and streamed result share one port", async () => {
  const fixture = fakeBrowser(helloOr((request, port) => {
    if (request.method === "auth.status") reply(port, request, { connected: true, canInfer: true, storage: "fake" });
    else if (request.method === "models.list") reply(port, request, { models: [{ slug: "fixture-model", displayName: "Fixture" }] });
    else if (request.method === "infer.start") {
      port.deliver({ type: "event", requestId: request.requestId, sequence: 0, event: "infer.delta", payload: { text: "hello" } });
      reply(port, request, { text: "hello" }, 1);
    } else assert.fail(`Unexpected host method: ${request.method}`);
  }));
  const client = createNativeMessagingClient({ getBrowser: () => fixture.browser });
  const status = await client.authStatus();
  const models = await client.listModels();
  const deltas = [];
  const result = await client.infer({ model: "fixture-model", instructions: "fixture", input: "question" }, { onDelta: value => deltas.push(value) });

  assert.equal(fixture.connects, 1);
  assert.deepEqual(fixture.posted.map(value => value.method), ["hello", "auth.status", "models.list", "infer.start"]);
  assert.deepEqual(status, { connected: true, canInfer: true, storage: "fake" });
  assert.equal(models.models[0].slug, "fixture-model");
  assert.deepEqual(deltas, ["hello"]);
  assert.deepEqual(result, { text: "hello" });
});

test("account add and selection use bounded explicit native messages", async () => {
  const fixture = fakeBrowser(helloOr((request, port) => {
    if (request.method === "auth.start") {
      assert.deepEqual(request.payload, { addAccount: true });
      reply(port, request, { connected: true });
    } else if (request.method === "auth.select") {
      assert.deepEqual(request.payload, { accountId: "account-second" });
      reply(port, request, { selected: true });
    } else assert.fail(`Unexpected host method: ${request.method}`);
  }));
  const client = createNativeMessagingClient({ getBrowser: () => fixture.browser });
  await client.startAuth({ addAccount: true });
  await client.selectAccount("account-second");
  assert.deepEqual(fixture.posted.map(value => value.method), ["hello", "auth.start", "auth.select"]);
});

test("missing SIWC scope and an expired token surface distinct recoverable errors", async () => {
  const noScope = fakeBrowser(helloOr((request, port) => fail(port, request, "missing_scope")));
  const client = createNativeMessagingClient({ getBrowser: () => noScope.browser });
  await assert.rejects(client.infer({ model: "m", instructions: "i", input: "x" }), { code: "MISSING_SCOPE" });

  const expired = fakeBrowser(helloOr((request, port) => fail(port, request, "token_expired")));
  const expiredClient = createNativeMessagingClient({ getBrowser: () => expired.browser });
  await assert.rejects(expiredClient.authStatus(), { code: "RECONNECT_REQUIRED" });
});

test("invalid host sequence and missing host fail closed", async () => {
  const badSequence = fakeBrowser((request, port) => reply(port, request, { protocolVersion: 1, capabilities: CAPABILITIES }, 1));
  const client = createNativeMessagingClient({ getBrowser: () => badSequence.browser });
  await assert.rejects(client.ensureConnected(), { code: "NATIVE_HOST_PROTOCOL" });

  const missing = fakeBrowser(() => {}, { connectError: new Error("host path must not escape to callers") });
  await assert.rejects(createNativeMessagingClient({ getBrowser: () => missing.browser }).ensureConnected(), { code: "NATIVE_HOST_UNAVAILABLE" });
});

test("cancel sends a separate control request and never resolves a partial inference", async () => {
  let inferRequest;
  let cancelSent;
  const fixture = fakeBrowser(helloOr((request, port) => {
    if (request.method === "infer.start") inferRequest = request;
    if (request.method === "cancel") {
      cancelSent = request;
      assert.equal(request.payload.requestId, inferRequest.requestId);
      reply(port, request, { cancelled: true });
      fail(port, inferRequest, "cancelled");
    }
  }));
  const client = createNativeMessagingClient({ getBrowser: () => fixture.browser });
  await client.ensureConnected();
  const controller = new AbortController();
  const pending = client.infer({ model: "m", instructions: "i", input: "x" }, { signal: controller.signal, onDelta: () => assert.fail("No partial event was sent") });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(inferRequest);
  controller.abort();
  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(cancelSent?.method, "cancel");
  assert.deepEqual(fixture.posted.map(value => value.method), ["hello", "infer.start", "cancel"]);
});
