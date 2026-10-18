import test from "node:test";
import assert from "node:assert/strict";
import { startMockServer } from "../e2e/support/mock-server.mjs";

const requestBody = JSON.stringify({ stream: true, messages: [
  { role: "system", content: "Plain text only" },
  { role: "user", content: "synthetic stream fixture" }
] });

test("the mock Provider returns planned HTTP errors for streaming requests", async (t) => {
  const server = await startMockServer();
  t.after(() => server.close());
  server.setFailures([401]);
  const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: "POST", body: requestBody
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { message: "mock failure 401" } });
  assert.equal(server.calls.length, 1);
});

test("a held assistant stream exposes its first chunk and abort settles it without holding the retry", { timeout: 5000 }, async (t) => {
  const server = await startMockServer();
  const controller = new AbortController();
  t.after(async () => { controller.abort(); await server.close(); });
  const held = server.holdNextAssistantStream();
  const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: "POST", body: requestBody, signal: controller.signal
  });
  await held.started;
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /streamed /u);
  assert.equal(server.calls[0].responseState, "pending");
  controller.abort();
  await held.finished;
  assert.equal(server.calls[0].responseState, "closed");
  held.release();

  const retry = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: "POST", body: requestBody
  });
  const text = await retry.text();
  assert.match(text, /streamed /u);
  assert.match(text, /answer/u);
  assert.match(text, /\[DONE\]/u);
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].responseState, "finished");
});
