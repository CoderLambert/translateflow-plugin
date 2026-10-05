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

test("a missing CSS image degrades its slot without dropping the stylesheet", async () => {
  const harness = await createStylesheetHarness({ imageResponse: { ok: true, found: false, packageVersion: "v1" } });
  await harness.imageRequested;
  await waitFor(() => harness.resolver.runningReadCount === 0);

  assert.equal(harness.styles.length, 1);
  assert.match(harness.styles[0].textContent, /background-image:none/u);
  assert.match(harness.styles[0].textContent, /color:red/u);
  assert.doesNotMatch(harness.styles[0].textContent, /tfasset0/u);
});

test("an expired image response still discards the stylesheet result", async () => {
  const harness = await createStylesheetHarness({ imageResponse: { ok: true, found: false, stale: true, packageVersion: "v2" } });
  await harness.imageRequested;
  await waitFor(() => harness.resolver.runningReadCount === 0);

  assert.equal(harness.styles.length, 0);
});

test("closing a viewer while its CSS image is pending still drops the stylesheet", async () => {
  const harness = await createStylesheetHarness({ deferImage: true });
  await harness.imageRequested;
  harness.resolver.close(harness.container);
  harness.resolveImage({ ok: true, found: false, packageVersion: "v1" });
  await waitFor(() => harness.resolver.runningReadCount === 0);

  assert.equal(harness.styles.length, 0);
  assert.equal(harness.messages.filter((message) => message.type === "RICH_MDD_RESOURCE_READ_CANCEL").length, 1);
});

async function createStylesheetHarness({ imageResponse, deferImage = false }) {
  const messages = [];
  const styles = [];
  const cssBytes = Buffer.from(".entry{background-image:tfasset0;color:red}");
  let notifyImageRequested;
  let resolveImage;
  const imageRequested = new Promise((resolve) => { notifyImageRequested = resolve; });
  const app = { modules: {
    contentI18n: createContentI18nStub(),
    runtime: {
      messages: { background: {
        RICH_MDD_RESOURCE: "RICH_MDD_RESOURCE",
        RICH_MDD_RESOURCE_READ_CANCEL: "RICH_MDD_RESOURCE_READ_CANCEL"
      } },
      sendRuntimeMessage(message) {
        messages.push(message);
        if (message.type === "RICH_MDD_RESOURCE_READ_CANCEL") return Promise.resolve({ ok: true, cancelled: true });
        if (message.path === "styles/entry.css") {
          return Promise.resolve({
            ok: true,
            found: true,
            packageVersion: "v1",
            mime: "text/css",
            size: cssBytes.byteLength,
            base64: cssBytes.toString("base64"),
            safeCss: ".tf-rich-viewer .entry{background-image:tfasset0;color:red}",
            assetSlots: [{ token: "tfasset0", path: "images/missing.png", kind: "image" }]
          });
        }
        notifyImageRequested();
        if (deferImage) return new Promise((resolve) => { resolveImage = resolve; });
        return Promise.resolve(imageResponse);
      }
    },
    richResourcePath: { normalize(value) { return String(value || ""); } }
  } };
  const document = {
    createElement(name) { return { tagName: name, textContent: "", remove() { this.removed = true; } }; }
  };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, TextDecoder, Uint8Array, Blob, URL, atob });
  vm.runInContext(await readFile(RESOLVER, "utf8"), context);
  const resolver = app.modules.richResourceResolver;
  const container = {};
  const shadowRoot = { appendChild(style) { styles.push(style); } };
  resolver.attach(container, shadowRoot, {}, [{ kind: "stylesheet", path: "styles/entry.css", label: "", element: null }], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");
  return { container, imageRequested, messages, resolver, resolveImage: (value) => resolveImage?.(value), styles };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await flushMicrotasks();
  }
  assert.fail("Timed out waiting for rich resource resolver to settle.");
}
