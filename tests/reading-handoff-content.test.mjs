import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { READING_METHOD } from "../src/shared/reading/constants.js";
import { response } from "./fixtures/reading/contract.mjs";

const sources = await Promise.all(["reading-contract.js", "selection/handoff-client.js"].map(file =>
  readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
function realmFor(registration) {
  const calls = [], ports = [], modules = { selectionSourceSnapshot: { documentGeneration: "doc-target" } };
  const chrome = { runtime: { connect({ name }) {
    const messages = new Set(), disconnects = new Set();
    const port = { name, onMessage: { addListener: listener => messages.add(listener) }, onDisconnect: { addListener: listener => disconnects.add(listener) },
      disconnect() { for (const listener of disconnects) listener(); } };
    ports.push(port);
    queueMicrotask(() => {
      const baseline = vm.runInContext("JSON.parse", realm)(JSON.stringify({ protocolVersion: 2, type: "reading.invalidate", pageRevision: 1, dataGeneration: 1, consentGeneration: 1 }));
      for (const listener of messages) listener(baseline);
    });
    return port;
  } } };
  const realm = vm.createContext({ TextEncoder, URL, chrome, __TRANSLATE_FLOW_CONTENT__: { modules } });
  const parse = vm.runInContext("JSON.parse", realm);
  modules.runtime = { async sendRuntimeMessage(request) {
      calls.push(JSON.parse(JSON.stringify(request)));
      const value = request.method === READING_METHOD.REGISTER_DOCUMENT ? response(request.method, "content", { data: registration }) : response(request.method, "content");
      return parse(JSON.stringify(value));
    }
  };
  for (const source of sources) vm.runInContext(source, realm);
  return { modules, calls, ports };
}

test("content registers its real document and consumes only a backend-bound handoff", async () => {
  const registration = response(READING_METHOD.REGISTER_DOCUMENT, "content").data;
  const none = realmFor(registration); assert.deepEqual(JSON.parse(JSON.stringify(await none.modules.readingHandoff.ready)), { state: "none" });
  assert.deepEqual(none.calls.map(call => call.method), [READING_METHOD.REGISTER_DOCUMENT]);
  const bound = realmFor({ ...registration, handoffId: "handoff-1" });
  const consumed = await bound.modules.readingHandoff.ready;
  assert.equal(consumed.state, "consumed", JSON.stringify({ consumed, portNames: bound.ports.map(port => port.name) }));
  assert.deepEqual(bound.ports.map(port => port.name), ["reading.invalidate"]);
  assert.deepEqual(bound.calls.map(call => call.method), [READING_METHOD.REGISTER_DOCUMENT, READING_METHOD.CONSUME_HANDOFF]);
  assert.equal(bound.calls[1].handoffId, "handoff-1");
});
