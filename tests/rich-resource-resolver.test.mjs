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

  } };
  const context = vm.createContext({
    __TRANSLATE_FLOW_CONTENT__: app,
    TextDecoder,
    Uint8Array,
    Blob,
    URL,
    atob
  });
  vm.runInContext(await readFile(new URL("../src/content/selection/rich-resource-path.js", import.meta.url), "utf8"), context);
  vm.runInContext(await readFile(MEDIA, "utf8"), context);
  vm.runInContext(await readFile(new URL("../src/content/selection/rich-resource-fonts.js", import.meta.url), "utf8"), context);
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

  assert.equal(harness.observer.options.root, null, "lazy media follows the browser viewport and clipping scroll ancestors");

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

  } };
  const document = {
    createElement(name) { return { tagName: name, textContent: "", remove() { this.removed = true; } }; }
  };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, TextDecoder, Uint8Array, Blob, URL, atob });
  vm.runInContext(await readFile(new URL("../src/content/selection/rich-resource-path.js", import.meta.url), "utf8"), context);
  vm.runInContext(await readFile(MEDIA, "utf8"), context);
  vm.runInContext(await readFile(new URL("../src/content/selection/rich-resource-fonts.js", import.meta.url), "utf8"), context);
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
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); latestObserver = this; }
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

  } };
  const context = vm.createContext({
    __TRANSLATE_FLOW_CONTENT__: app, document, IntersectionObserver: Observer,
    TextDecoder, Uint8Array, Blob, URL, atob, crypto: globalThis.crypto
  });
  vm.runInContext(readFileSync(new URL("../src/content/selection/rich-resource-path.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(MEDIA, "utf8"), context);
  vm.runInContext(readFileSync(new URL("../src/content/selection/rich-resource-fonts.js", import.meta.url), "utf8"), context);
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

test("the same image path retains separate ordinary and validated semantic descriptor styles", async () => {
  const bytes = Buffer.from([137, 80, 78, 71]);
  const harness = createMediaLifecycleHarness({ "img/OPP.png": { bytes, mime: "image/png", width: 24, height: 24 } });
  const parent = new FakeParent();
  const ordinary = parent.append(new FakeElement("SPAN")), semantic = parent.append(new FakeElement("SPAN"));
  const container = {};
  harness.resolver.attach(container, { appendChild() {} }, {}, [
    { kind: "image", path: "img/OPP.png", element: ordinary },
    { kind: "image", path: "img/OPP.png", presentation: "oxford-opposition", element: semantic }
  ], "rich-mdict-10000000-0000-4000-8000-000000000001", "v1");
  harness.observer.trigger(ordinary, true); harness.observer.trigger(semantic, true);
  await waitFor(() => parent.children.every((node) => node.tagName === "IMG"));
  assert.equal(parent.children[0].className, "tf-rich-resource-image");
  assert.match(parent.children[1].className, /tf-rich-resource-image-oxford-inline/u);
  assert.equal(harness.resolver.activeObjectUrlCount, 2);
  harness.resolver.close(container); assert.equal(harness.resolver.activeObjectUrlCount, 0);
});

function createFontHarness({ manifest, fontBytes = Buffer.alloc(32), rejectDecode = false, rejectWeight = null, deferDecode = false, deferRead = false, stale = false, imageSlots = [], constructorFails = false, cryptoProvider = globalThis.crypto, stylesheetCss = null } = {}) {
  const messages = [], styles = [], notices = [], created = [], pendingReads = [], pendingLoads = [], registered = new Set();
  const document = {
    fonts: registered,
    createElement(tag) { return { tagName: tag.toUpperCase(), className: '', textContent: '', remove() { this.removed = true; } }; }
  };
  class Face {
    constructor(family, bytes, descriptors) {
      if (constructorFails) throw new Error('synthetic native constructor rejection');
      this.family = family; this.bytes = bytes; this.style = descriptors.style; this.weight = descriptors.weight; this.display = descriptors.display; this.status = 'unloaded'; created.push(this);
    }
    load() {
      this.status = 'loading';
      if (deferDecode) return new Promise((resolve) => pendingLoads.push(() => { this.status = 'loaded'; resolve(this); }));
      if (rejectDecode || this.weight === rejectWeight) { this.status = 'error'; return Promise.reject(new Error('synthetic decoder rejection')); }
      this.status = 'loaded'; return Promise.resolve(this);
    }
  }
  const faces = manifest || [{ familyToken: 'tffamily0', path: 'fonts/fixture.ttf', style: 'normal', weight: '400', display: 'swap' }];
  const css = Buffer.from(stylesheetCss || '.tf-rich-viewer .entry{font-family:tffamily0,serif;color:red}.tf-rich-viewer .choice:checked ~ .panel{display:block}');
  const app = { modules: { contentI18n: createContentI18nStub(), runtime: {
    messages: { background: { RICH_MDD_RESOURCE: 'RICH_MDD_RESOURCE', RICH_MDD_RESOURCE_READ_CANCEL: 'RICH_MDD_RESOURCE_READ_CANCEL' } },
    sendRuntimeMessage(message) {
      messages.push(message);
      if (message.type === 'RICH_MDD_RESOURCE_READ_CANCEL') return Promise.resolve({ ok: true, cancelled: true });
      if (/\.png$/u.test(message.path || '')) return Promise.resolve({ ok: true, found: false, packageVersion: 'v1' });
      if (message.path === 'entry.css') return Promise.resolve({ ok: true, found: true, packageVersion: 'v1', mime: 'text/css', size: css.length, base64: css.toString('base64'), safeCss: css.toString(), assetSlots: imageSlots, fontFaces: faces });
      const result = { ok: true, found: true, packageVersion: stale ? 'v2' : 'v1', mime: 'font/ttf', size: fontBytes.length, base64: fontBytes.toString('base64') };
      return deferRead ? new Promise((resolve) => pendingReads.push(() => resolve(result))) : Promise.resolve(result);
    }
  } } };
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document, FontFace: Face, TextEncoder, TextDecoder, Uint8Array, Blob, URL, atob, crypto: cryptoProvider });
  for (const name of ['rich-resource-path', 'rich-resource-media', 'rich-resource-fonts', 'rich-resource-resolver']) vm.runInContext(readFileSync(new URL(`../src/content/selection/${name}.js`, import.meta.url), 'utf8'), context);
  const resolver = app.modules.richResourceResolver;
  const attach = () => { const container = { ownerDocument: document }; const viewport = { appendChild: (node) => notices.push(node) }; const session = resolver.attach(container, { appendChild: (node) => styles.push(node) }, viewport, [{ kind: 'stylesheet', path: 'entry.css' }], 'fixture', 'v1'); return { container, session }; };
  return { resolver, attach, messages, styles, notices, created, registered, pendingReads, pendingLoads };
}

test('local font manifests preserve four face variants and isolate random family aliases across sessions', async () => {
  const manifest = ['normal', 'italic'].flatMap((style) => ['400', '700'].map((weight) => ({ familyToken: 'tffamily0', path: `fonts/${style}-${weight}.ttf`, style, weight, display: 'swap' })));
  const h = createFontHarness({ manifest }); const first = h.attach(), second = h.attach();
  await waitFor(() => h.registered.size === 8);
  const aliases = [...h.registered].map((face) => face.family);
  assert.equal(new Set(aliases).size, 2); assert.ok(aliases.every((value) => /^tf-rich-font-[0-9a-f]{32}-0$/u.test(value)));
  assert.equal(h.styles.length, 2); assert.notEqual(h.styles[0].textContent, h.styles[1].textContent);
  assert.ok(h.styles.every((node) => !node.textContent.includes('tffamily0') && node.textContent.includes(':checked ~ .panel')));
  assert.equal(h.resolver.activeFontBytes, 8 * 32);
  h.resolver.close(first.container); assert.equal(h.registered.size, 4);
  h.resolver.close(second.container); assert.equal(h.registered.size, 0); assert.equal(h.resolver.activeFontBytes, 0);
});

for (const options of [{ rejectDecode: true }, { constructorFails: true }, { stale: true }]) test(`bad font stays a default-font fallback and body/state CSS remains: ${JSON.stringify(options)}`, async () => {
  const h = createFontHarness(options), { container } = h.attach();
  await waitFor(() => h.notices.length === 1);
  assert.equal(h.registered.size, 0); assert.equal(h.resolver.activeFontBytes, 0);
  assert.equal(h.styles.length, 1); assert.match(h.styles[0].textContent, /:checked ~ \.panel/u); assert.doesNotMatch(h.styles[0].textContent, /tffamily/u);
  assert.equal(h.notices[0].textContent, 'content.rich.fontsUnavailable');
  h.resolver.close(container); assert.equal(h.notices[0].removed, true);
});

test('malformed font manifests and combined slot overflow cannot introduce page font names or reads', async () => {
  for (const manifest of [
    [{ familyToken: 'page-font', path: 'fonts/a.ttf', style: 'normal', weight: '400', display: 'swap' }],
    [{ familyToken: 'tffamily0', path: 'https://attacker.invalid/a.ttf', style: 'normal', weight: '400', display: 'swap' }],
    Array.from({ length: 9 }, () => ({ familyToken: 'tffamily0', path: 'fonts/a.ttf', style: 'normal', weight: '400', display: 'swap' })),
    Array.from({ length: 2 }, () => ({ familyToken: 'tffamily0', path: 'fonts/a.ttf', style: 'normal', weight: '400', display: 'swap' }))
  ]) {
    const h = createFontHarness({ manifest }); const { container } = h.attach();
    await waitFor(() => h.styles.length === 1);
    assert.equal(h.messages.filter((message) => /\.ttf$/u.test(message.path || '')).length, 0);
    assert.match(h.styles[0].textContent, /font-family:serif,serif/u); assert.equal(h.notices.length, 1);
    h.resolver.close(container);
  }
});

test('close while a font read or native decode is pending never appends an old face and reservations settle once', async () => {
  for (const phase of ['read', 'decode']) {
    const h = createFontHarness({ deferRead: phase === 'read', deferDecode: phase === 'decode' }); const { container } = h.attach();
    await waitFor(() => (phase === 'read' ? h.pendingReads.length : h.pendingLoads.length) === 1);
    assert.equal(h.resolver.activeFontBytes, phase === 'decode' ? 32 : 0);
    h.resolver.close(container); h.resolver.close(container);
    assert.equal(h.registered.size, 0);
    if (phase === 'decode') assert.equal(h.resolver.activeFontBytes, 32, 'pending native bytes stay reserved until the same two-read job settles');
    (phase === 'read' ? h.pendingReads[0] : h.pendingLoads[0])();
    await waitFor(() => h.resolver.activeFontBytes === 0 && h.resolver.pendingReadCount === 0);
    assert.equal(h.registered.size, 0); assert.equal(h.notices.length, 0);
  }
});

test('font pending work shares the existing two-read queue across repeated close/reopen', async () => {
  const h = createFontHarness({ deferDecode: true }); const first = h.attach(), second = h.attach();
  await waitFor(() => h.pendingLoads.length === 2);
  h.resolver.close(first.container); h.resolver.close(second.container);
  const third = h.attach();
  await waitFor(() => h.resolver.pendingReadCount > 0);
  assert.equal(h.created.length, 2); assert.equal(h.resolver.activeFontBytes, 64);
  h.pendingLoads[0](); h.pendingLoads[1]();
  await waitFor(() => h.pendingLoads.length === 3);
  assert.equal(h.resolver.activeFontBytes, 32); assert.equal(h.registered.size, 0);
  h.pendingLoads[2](); await waitFor(() => h.registered.size === 1);
  h.resolver.close(third.container); assert.equal(h.resolver.activeFontBytes, 0);
});

test('font bytes reserve the existing 32MiB active budget before decode, without using image budget', async () => {
  const manifest = Array.from({ length: 5 }, (_, index) => ({ familyToken: `tffamily${index}`, path: `fonts/${index}.ttf`, style: 'normal', weight: '400', display: 'swap' }));
  const h = createFontHarness({ manifest, fontBytes: Buffer.alloc(8 * 1024 * 1024) }); const { container, session } = h.attach();
  await waitFor(() => h.notices.length === 1);
  assert.equal(h.registered.size, 4); assert.equal(h.created.length, 4); assert.equal(session.objectBytes, 32 * 1024 * 1024); assert.equal(session.imageBytes, 0);
  assert.equal(h.resolver.activeFontBytes, 32 * 1024 * 1024);
  h.resolver.close(container); assert.equal(h.registered.size, 0); assert.equal(h.resolver.activeFontBytes, 0);
});


test('eight image slots plus a font face reject font admission but retain the body CSS', async () => {
  const h = createFontHarness({ imageSlots: Array.from({ length: 8 }, (_, index) => ({ kind: 'image', token: `tfasset${index}`, path: `images/${index}.png` })) });
  const { container } = h.attach(); await waitFor(() => h.styles.length === 1);
  assert.equal(h.notices.length, 1); assert.equal(h.created.length, 0);
  assert.equal(h.messages.filter((message) => /\.ttf$/u.test(message.path || '')).length, 0);
  assert.match(h.styles[0].textContent, /:checked ~ \.panel/u); h.resolver.close(container);
});


test('one failed font variant reports one degradation notice without discarding other faces or state CSS', async () => {
  const manifest = ['normal', 'italic'].flatMap((style) => ['400', '700'].map((weight) => ({ familyToken: 'tffamily0', path: `fonts/${style}-${weight}.ttf`, style, weight, display: 'swap' })));
  const h = createFontHarness({ manifest, rejectWeight: '400' }), { container } = h.attach();
  await waitFor(() => h.created.length === 4 && h.registered.size === 2);
  assert.equal(h.notices.length, 1); assert.ok([...h.registered].every((face) => face.weight === '700'));
  assert.equal(h.resolver.activeFontBytes, 64); assert.match(h.styles[0].textContent, /:checked ~ \.panel/u);
  h.resolver.close(container); assert.equal(h.resolver.activeFontBytes, 0);
});


test('HTTP-like runtimes without randomUUID still use cryptographic random aliases', async () => {
  const h = createFontHarness({ cryptoProvider: { getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) } });
  const { container } = h.attach(); await waitFor(() => h.registered.size === 1);
  assert.match([...h.registered][0].family, /^tf-rich-font-[0-9a-f]{32}-0$/u);
  assert.equal(h.notices.length, 0); h.resolver.close(container);
});

test('missing native randomness falls back without dropping body CSS or exposing source family tokens', async () => {
  const h = createFontHarness({ cryptoProvider: {} }); const { container } = h.attach();
  await waitFor(() => h.styles.length === 1);
  assert.equal(h.created.length, 0); assert.equal(h.notices.length, 1);
  assert.doesNotMatch(h.styles[0].textContent, /tffamily/u); assert.match(h.styles[0].textContent, /:checked ~ \.panel/u);
  h.resolver.close(container);
});

test('session alias expansion keeps the 64KiB CSS output budget and falls back without native font work', async () => {
  const manifest = Array.from({ length: 8 }, (_, index) => ({ familyToken: `tffamily${index}`, path: `fonts/${index}.ttf`, style: 'normal', weight: '400', display: 'swap' }));
  const stylesheetCss = '.tf-rich-viewer .entry{font-family:' + manifest.map((face) => face.familyToken).join(',') + ';color:red}';
  const h = createFontHarness({ manifest, stylesheetCss: stylesheetCss.repeat(512) }); const { container } = h.attach();
  await waitFor(() => h.styles.length === 1);
  assert.ok(Buffer.byteLength(h.styles[0].textContent) <= 64 * 1024);
  assert.equal(h.created.length, 0); assert.equal(h.notices.length, 1);
  assert.doesNotMatch(h.styles[0].textContent, /tffamily/u); assert.match(h.styles[0].textContent, /color:red/u);
  h.resolver.close(container);
});

const collidingNonFontCss = '.tf-rich-viewer [data-rich-target-id="tffamily0"]:checked ~ .panel{display:block}.tf-rich-viewer .tffamily0{color:red}.tf-rich-viewer .label::before{content:"font-family:tffamily0; { tffamily0 }"}';
for (const [branch, options] of [
  ['loaded', {}], ['decode failure', { rejectDecode: true }], ['bad manifest', { manifest: [{ familyToken: 'invalid' }] }], ['no randomness', { cryptoProvider: {} }]
]) test(`font token collisions preserve selectors and literal content in the ${branch} branch`, async () => {
  const h = createFontHarness({ ...options, stylesheetCss: collidingNonFontCss + '.tf-rich-viewer .entry{font-family:tffamily0,serif}' });
  const { container } = h.attach(); await waitFor(() => h.styles.length === 1);
  assert.ok(h.styles[0].textContent.startsWith(collidingNonFontCss));
  if (branch === 'bad manifest' || branch === 'no randomness') assert.match(h.styles[0].textContent, /font-family:serif,serif/u);
  else assert.match(h.styles[0].textContent, /font-family:tf-rich-font-[0-9a-f]{32}-0,serif/u);
  if (branch === 'decode failure') await waitFor(() => h.notices.length === 1);
  h.resolver.close(container);
});

test('font alias overflow fallback preserves colliding non-font CSS exactly', async () => {
  const manifest = Array.from({ length: 8 }, (_, index) => ({ familyToken: `tffamily${index}`, path: `fonts/${index}.ttf`, style: 'normal', weight: '400', display: 'swap' }));
  const families = manifest.map((face) => face.familyToken).join(',');
  const h = createFontHarness({ manifest, stylesheetCss: collidingNonFontCss + `.tf-rich-viewer .entry{font-family:${families};color:red}`.repeat(512) });
  const { container } = h.attach(); await waitFor(() => h.styles.length === 1);
  assert.ok(h.styles[0].textContent.startsWith(collidingNonFontCss));
  assert.ok(Buffer.byteLength(h.styles[0].textContent) <= 64 * 1024);
  assert.equal(h.created.length, 0); assert.equal(h.notices.length, 1);
  assert.match(h.styles[0].textContent.slice(collidingNonFontCss.length), /font-family:serif,serif/u);
  h.resolver.close(container);
});

test('family declaration scanning skips strings, escaped syntax and parenthesized non-font values', async () => {
  const protectedCss = '@media (max-width:500px){.tf-rich-viewer .tffamily0{color:rgb(0,0,0);content:"font-family:tffamily0; \\" tffamily0"}.tf-rich-viewer [data-rich-target-id="tffamily0"]{color:red}}';
  const h = createFontHarness({ stylesheetCss: protectedCss + '.tf-rich-viewer .entry{font-family:tffamily0,serif}' });
  const { container } = h.attach(); await waitFor(() => h.styles.length === 1);
  assert.ok(h.styles[0].textContent.startsWith(protectedCss));
  assert.match(h.styles[0].textContent.slice(protectedCss.length), /font-family:tf-rich-font-[0-9a-f]{32}-0,serif/u);
  h.resolver.close(container);
});
