import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const source = await readFile(new URL("../src/content/runtime.js", import.meta.url), "utf8");
function runtime(chrome) {
  const app = { modules: { contentI18n: createContentI18nStub() } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, chrome, URL,
    location: { href: "https://fixture.invalid/article" } });
  return app.modules.runtime;
}

for (const chrome of [undefined, {}, { runtime: {} }]) {
  test(`missing messaging API is an explicit invalid-context error (${JSON.stringify(chrome)})`, async () => {
    await assert.rejects(runtime(chrome).sendRuntimeMessage({ type: "probe" }), { code: "EXTENSION_CONTEXT_INVALIDATED" });
  });
}

test("valid messaging and callback errors retain their existing behavior", async () => {
  const chrome = { runtime: { sendMessage(_payload, callback) { callback({ ok: true }); } } };
  const content = runtime(chrome);
  assert.deepEqual(await content.sendRuntimeMessage({ type: "probe" }), { ok: true });
  chrome.runtime.lastError = { message: "Temporary connection failure" };
  await assert.rejects(content.sendRuntimeMessage({ type: "probe" }), { message: "Temporary connection failure" });
});

test("native invalidation thrown by an existing API is still propagated", async () => {
  const content = runtime({ runtime: { sendMessage() { throw new Error("Extension context invalidated."); } } });
  await assert.rejects(content.sendRuntimeMessage({ type: "probe" }), { message: "Extension context invalidated." });
});
