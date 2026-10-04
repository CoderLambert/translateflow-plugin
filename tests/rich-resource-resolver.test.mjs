import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const RESOLVER = new URL("../src/content/selection/rich-resource-resolver.js", import.meta.url);

test("closing a rich viewer purges queued stale MDD resource reads", async () => {
  const calls = [];
  const pending = [];
  const app = { modules: {
    contentI18n: createContentI18nStub(),
    runtime: {
      messages: { background: {
        RICH_MDD_RESOURCE: "RICH_MDD_RESOURCE",
        RICH_MDD_RESOURCE_READ_CANCEL: "RICH_MDD_RESOURCE_READ_CANCEL"
      } },
      sendRuntimeMessage(message) {
        calls.push(message);
        if (message.type === "RICH_MDD_RESOURCE_READ_CANCEL") {
          return Promise.resolve({ ok: true, cancelled: true });
        }
        return new Promise((resolve) => pending.push(resolve));
      }
    },
    richResourcePath: {
      normalize(value) { return String(value || ""); }
    }
  } };
  const context = vm.createContext({
    __TRANSLATE_FLOW_CONTENT__: app,
    TextDecoder,
    Uint8Array,
    Blob,
    URL,
    atob
  });
  vm.runInContext(await readFile(RESOLVER, "utf8"), context);
  const resolver = app.modules.richResourceResolver;
  const container = {};
  const resources = Array.from({ length: 8 }, (_, index) => ({
    kind: "stylesheet",
    path: `styles/${index}.css`,
    label: "",
    element: null
  }));

  resolver.attach(container, { appendChild() {} }, {}, resources, "rich-mdict-10000000-0000-4000-8000-000000000001");
  await flushMicrotasks();

  assert.equal(calls.length, 2, "only the configured two resource reads should start");
  assert.equal(resolver.runningReadCount, 2);
  assert.equal(resolver.pendingReadCount, 6);

  resolver.close(container);
  assert.equal(resolver.pendingReadCount, 0, "closing the viewer should purge its queued reads");
  await flushMicrotasks();

  const reads = calls.filter((message) => message.type === "RICH_MDD_RESOURCE");
  const cancels = calls.filter((message) => message.type === "RICH_MDD_RESOURCE_READ_CANCEL");
  assert.equal(reads.length, 2, "only the two already-running resource reads may reach the background");
  assert.equal(cancels.length, 2, "each running resource read must receive a cancellation");
  assert.deepEqual(
    cancels.map((message) => message.requestId).sort(),
    reads.map((message) => message.requestId).sort(),
    "cancellation must target exactly the running resource requests"
  );

  for (const resolve of pending) resolve({ ok: false, found: false });
  await flushMicrotasks();

  assert.equal(
    calls.filter((message) => message.type === "RICH_MDD_RESOURCE").length,
    2,
    "purged queued reads must never reach the background"
  );
  assert.equal(resolver.runningReadCount, 0);
  assert.equal(resolver.pendingReadCount, 0);
});

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
