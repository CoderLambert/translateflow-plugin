import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { READING_METHOD } from "../src/shared/reading/constants.js";
import { response } from "./fixtures/reading/contract.mjs";

const sources = await Promise.all(["reading-contract.js", "selection/handoff-client.js"].map(file =>
  readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
function realmFor(registration) {
  const calls = [], modules = { selectionSourceSnapshot: { documentGeneration: "doc-target" } };
  const realm = vm.createContext({ TextEncoder, URL, __TRANSLATE_FLOW_CONTENT__: { modules } });
  const parse = vm.runInContext("JSON.parse", realm);
  modules.runtime = { async sendRuntimeMessage(request) {
      calls.push(JSON.parse(JSON.stringify(request)));
      const value = request.method === READING_METHOD.REGISTER_DOCUMENT ? response(request.method, "content", { data: registration }) : response(request.method, "content");
      return parse(JSON.stringify(value));
    }
  };
  for (const source of sources) vm.runInContext(source, realm);
  return { modules, calls };
}

test("content registers its real document and consumes only a backend-bound handoff", async () => {
  const registration = response(READING_METHOD.REGISTER_DOCUMENT, "content").data;
  const none = realmFor(registration); assert.deepEqual(JSON.parse(JSON.stringify(await none.modules.readingHandoff.ready)), { state: "none" });
  assert.deepEqual(none.calls.map(call => call.method), [READING_METHOD.REGISTER_DOCUMENT]);
  const bound = realmFor({ ...registration, handoffId: "handoff-1" });
  assert.equal((await bound.modules.readingHandoff.ready).state, "consumed");
  assert.deepEqual(bound.calls.map(call => call.method), [READING_METHOD.REGISTER_DOCUMENT, READING_METHOD.CONSUME_HANDOFF]);
  assert.equal(bound.calls[1].handoffId, "handoff-1");
});
