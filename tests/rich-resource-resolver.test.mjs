import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const RESOLVER = new URL("../src/content/selection/rich-resource-resolver.js", import.meta.url);
const MEDIA = new URL("../src/content/selection/rich-resource-media.js", import.meta.url);

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
  vm.runInContext(await readFile(MEDIA, "utf8"), context);
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

test("duplicate visible image instances share one URL and release it after the last instance leaves", async () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const harness = createMediaLifecycleHarness({
    "images/shared.png": { bytes, mime: "image/png", width: 2, height: 2 }
  });
  const parent = new FakeParent();
  const first = parent.append(new FakeElement("SPAN"));
  const second = parent.append(new FakeElement("SPAN"));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, [
    { kind: "image", path: "images/shared.png", label: "shared", elements: [first, second] }
  ], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  harness.observer.trigger(first, true);
  harness.observer.trigger(second, true);
  await waitFor(() => harness.resolver.activeObjectUrlCount === 1);
  const url = parent.children[0].src;
  assert.match(url, /^blob:/u);
  assert.equal(parent.children[1].src, url);
  assert.equal(harness.messages.filter((message) => message.type === "RICH_MDD_RESOURCE").length, 1);
  assert.equal(harness.resolver.activeObjectUrlBytes, bytes.byteLength);

  harness.observer.trigger(parent.children[0], false);
  assert.equal(parent.children[0].tagName, "IMG", "offscreen cleanup keeps the image's intrinsic layout box");
  assert.equal(parent.children[0].src, "");
  assert.equal(parent.children[0].style.visibility, "hidden");
  assert.equal(parent.children[0].width, 2);
  assert.equal(parent.children[0].height, 2);
  assert.equal(harness.resolver.activeObjectUrlCount, 1, "one visible duplicate keeps the shared URL alive");
  harness.observer.trigger(parent.children[1], false);
  await waitFor(() => harness.resolver.activeObjectUrlCount === 0);
  assert.equal(harness.resolver.activeObjectUrlBytes, 0);
  harness.resolver.close(container);
});

test("validated Oxford symbol resources stay inline after their local images load", async () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const harness = createMediaLifecycleHarness({
    "img/OPP.png": { bytes, mime: "image/png", width: 24, height: 24 }
  });
  const parent = new FakeParent();
  const placeholder = parent.append(new FakeElement("SPAN"));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, [{
    kind: "image", path: "img/OPP.png", presentation: "oxford-opposition", element: placeholder
  }], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  harness.observer.trigger(placeholder, true);
  await waitFor(() => parent.children[0].tagName === "IMG");
  const image = parent.children[0];
  assert.match(image.className, /tf-rich-resource-image-oxford-inline/u);
  assert.equal(image.attributes.get("alt"), "content.rich.oxfordOppositionDescription");
  assert.equal(image.attributes.get("aria-label"), "content.rich.oxfordOppositionDescription");
  harness.resolver.close(container);
});

test("image budget failure retries after offscreen release and preserves audio headroom", async () => {
  const imageBytes = Buffer.alloc(8 * 1024 * 1024, 0x39);
  const audioBytes = Buffer.alloc(8 * 1024 * 1024, 0x41);
  const assets = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [
    `images/${index}.png`, { bytes: imageBytes, mime: "image/png", width: 1000, height: 2000 }
  ]));
  assets["audio/tone.wav"] = { bytes: audioBytes, mime: "audio/wav", width: 0, height: 0 };
  const harness = createMediaLifecycleHarness(assets);
  const parent = new FakeParent();
  const placeholders = Array.from({ length: 4 }, () => parent.append(new FakeElement("SPAN")));
  const audioButton = parent.append(new FakeElement("BUTTON"));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, [
    ...placeholders.map((element, index) => ({ kind: "image", path: `images/${index}.png`, label: "", element })),
    { kind: "audio", path: "audio/tone.wav", label: "tone", element: audioButton }
  ], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  for (const placeholder of placeholders.slice(0, 3)) harness.observer.trigger(placeholder, true);
  await waitFor(() => harness.resolver.activeObjectUrlCount === 3);
  assert.equal(harness.resolver.activeObjectUrlBytes, 24 * 1024 * 1024);

  harness.observer.trigger(placeholders[3], true);
  await waitFor(() => pathReadCount(harness.messages, "images/3.png") === 1);
  await waitFor(() => harness.resolver.runningReadCount === 0);
  assert.equal(harness.resolver.activeObjectUrlCount, 3, "the 24 MiB image budget keeps the visible fourth image as a retryable placeholder");

  harness.observer.trigger(parent.children[0], false);
  await waitFor(() => pathReadCount(harness.messages, "images/3.png") === 2 &&
    harness.resolver.activeObjectUrlCount === 3);
  assert.equal(harness.resolver.activeObjectUrlBytes, 24 * 1024 * 1024);
  const loadedFourth = parent.children[3];
  assert.equal(loadedFourth.tagName, "IMG", "the visible image is retried when an earlier image is released");

  const button = parent.children.find((node) => node.tagName === "BUTTON");
  button.listeners.get("click")();
  await waitFor(() => harness.resolver.activeObjectUrlCount === 4);
  assert.equal(harness.resolver.activeObjectUrlBytes, 32 * 1024 * 1024, "the reserved 8 MiB slot remains available for clicked audio");
  assert.equal(harness.messages.filter((message) => message.type === "RICH_MDD_RESOURCE" && message.path === "audio/tone.wav").length, 1);

  harness.resolver.close(container);
  assert.equal(harness.resolver.activeObjectUrlCount, 0);
  assert.equal(harness.resolver.activeObjectUrlBytes, 0);
});

test("global image pixel cap keeps the visible placeholder retryable until pixels are released", async () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const harness = createMediaLifecycleHarness(Object.fromEntries(["a", "b", "c"].map((name) => [
    `images/${name}.png`, { bytes, mime: "image/png", width: 3000, height: 2000 }
  ])));
  const parent = new FakeParent();
  const placeholders = ["a", "b", "c"].map(() => parent.append(new FakeElement("SPAN")));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, placeholders.map((element, index) => ({
    kind: "image", path: `images/${["a", "b", "c"][index]}.png`, label: "", element
  })), "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  harness.observer.trigger(placeholders[0], true);
  harness.observer.trigger(placeholders[1], true);
  await waitFor(() => harness.resolver.activeObjectUrlCount === 2);
  assert.equal(harness.resolver.activeImagePixelCount, 12_000_000);
  harness.observer.trigger(placeholders[2], true);
  await waitFor(() => pathReadCount(harness.messages, "images/c.png") === 1);
  await waitFor(() => harness.resolver.runningReadCount === 0);
  assert.equal(harness.resolver.activeObjectUrlCount, 2);

  harness.observer.trigger(parent.children[0], false);
  await waitFor(() => pathReadCount(harness.messages, "images/c.png") === 2 &&
    harness.resolver.activeObjectUrlCount === 2);
  assert.equal(harness.resolver.activeImagePixelCount, 12_000_000);
  harness.resolver.close(container);
  assert.equal(harness.resolver.activeImagePixelCount, 0);
});

test("full reported AVIF dimensions consume the cumulative viewer pixel budget", async () => {
  const bytes = Buffer.from([0, 0, 0, 1]);
  const harness = createMediaLifecycleHarness({
    "images/full.avif": { bytes, mime: "image/avif", width: 4096, height: 4096 },
    "images/tail.png": { bytes, mime: "image/png", width: 1, height: 1 }
  });
  const parent = new FakeParent();
  const full = parent.append(new FakeElement("SPAN"));
  const tail = parent.append(new FakeElement("SPAN"));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, [
    { kind: "image", path: "images/full.avif", label: "", element: full },
    { kind: "image", path: "images/tail.png", label: "", element: tail }
  ], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  harness.observer.trigger(full, true);
  await waitFor(() => harness.resolver.activeObjectUrlCount === 1);
  assert.equal(harness.resolver.activeImagePixelCount, 4096 * 4096);

  harness.observer.trigger(tail, true);
  await waitFor(() => pathReadCount(harness.messages, "images/tail.png") === 1);
  await waitFor(() => harness.resolver.runningReadCount === 0);
  assert.equal(harness.resolver.activeObjectUrlCount, 1,
    "one additional pixel must exceed the cumulative 16 Mi-pixel viewer budget");
  assert.equal(harness.resolver.activeImagePixelCount, 4096 * 4096);

  harness.observer.trigger(parent.children[0], false);
  await waitFor(() => pathReadCount(harness.messages, "images/tail.png") === 2 &&
    harness.resolver.activeObjectUrlCount === 1);
  assert.equal(harness.resolver.activeImagePixelCount, 1,
    "the queued 1x1 image may load only after the full-size image releases its budget");
  harness.resolver.close(container);
});

test("independent audio controls request distinct first, middle, and last MDD paths on click", async () => {
  const paths = Array.from({ length: 526 }, (_, index) =>
    `interop/tone-${String(index).padStart(3, "0")}.wav`);
  assert.equal(new Set(paths).size, 526);
  const audioBytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
  const harness = createMediaLifecycleHarness(Object.fromEntries(paths.map((path) => [path, {
    bytes: audioBytes, mime: "audio/wav", width: 0, height: 0
  }])));
  const parent = new FakeParent();
  const buttons = paths.map(() => parent.append(new FakeElement("BUTTON")));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, paths.map((path, index) => ({
    kind: "audio", path, label: `tone-${String(index).padStart(3, "0")}`, element: buttons[index]
  })), "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");

  assert.equal(harness.messages.filter((message) => message.type === "RICH_MDD_RESOURCE").length, 0);
  assert.equal(harness.resolver.activeObjectUrlCount, 0);
  for (const index of [0, 262, 525, 0]) {
    const button = parent.children[index];
    assert.equal(button.tagName, "BUTTON");
    button.listeners.get("click")();
    await waitFor(() => harness.resolver.activeObjectUrlCount === 1);
  }
  assert.deepEqual(
    harness.messages.filter((message) => message.type === "RICH_MDD_RESOURCE").map((message) => message.path),
    [paths[0], paths[262], paths[525], paths[0]]
  );
  assert.equal(harness.resolver.activeObjectUrlCount, 1, "the one active audio slot releases its previous URL on each switch");
  harness.resolver.close(container);
  assert.equal(harness.resolver.activeObjectUrlCount, 0);
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
  vm.runInContext(await readFile(MEDIA, "utf8"), context);
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
  for (let attempt = 0; attempt < 800; attempt += 1) {
    if (predicate()) return;
    await flushMicrotasks();
  }
  assert.fail("Timed out waiting for rich resource resolver to settle.");
}

function pathReadCount(messages, path) {
  return messages.filter((message) => message.type === "RICH_MDD_RESOURCE" && message.path === path).length;
}

function createMediaLifecycleHarness(assets) {
  const messages = [];
  let latestObserver = null;
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); latestObserver = this; }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    trigger(target, isIntersecting) {
      if (this.targets.has(target)) this.callback([{ target, isIntersecting }]);
    }
  }
  const document = { createElement(name) { return new FakeElement(name.toUpperCase()); } };
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
        const asset = assets[message.path];
        if (!asset) return Promise.resolve({ ok: true, found: false, packageVersion: "v1" });
        return Promise.resolve({
          ok: true, found: true, packageVersion: "v1", mime: asset.mime,
          size: asset.bytes.byteLength, base64: asset.bytes.toString("base64"),
          width: asset.width, height: asset.height
        });
      }
    },
    richResourcePath: { normalize(value) { return String(value || ""); } }
  } };
  const context = vm.createContext({
    __TRANSLATE_FLOW_CONTENT__: app, document, IntersectionObserver: Observer,
    TextDecoder, Uint8Array, Blob, URL, atob, crypto: globalThis.crypto
  });
  vm.runInContext(readFileSync(MEDIA, "utf8"), context);
  vm.runInContext(readFileSync(RESOLVER, "utf8"), context);
  const resolver = app.modules.richResourceResolver;
  return { messages, resolver, get observer() { return latestObserver; } };
}

class FakeParent {
  constructor() { this.children = []; }
  append(element) {
    element.parentNode = this;
    this.children.push(element);
    return element;
  }
  replace(oldElement, nextElement) {
    const index = this.children.indexOf(oldElement);
    if (index < 0) return;
    this.children[index] = nextElement;
    nextElement.parentNode = this;
    oldElement.parentNode = null;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.src = "";
  }
  get isConnected() { return Boolean(this.parentNode); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); if (name === "src") this.src = ""; }
  replaceWith(next) { this.parentNode?.replace(this, next); }
  pause() {}
  load() {}
}
