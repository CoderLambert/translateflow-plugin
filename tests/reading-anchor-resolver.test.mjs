import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const files = ["text-projection-policy.js", "text-projection-builder.js", "text-projection.js", "reading-anchor-resolver.js"];
const sources = await Promise.all(files.map(file => readFile(new URL(`../src/content/${file}`, import.meta.url), "utf8")));
async function sha256(text) {
  const bytes = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function fixture(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/article" });
  const { window } = dom, nativeStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
  Object.defineProperty(window.performance, "now", { configurable: true, value: () => 0 });
  Object.assign(window, { TextEncoder, TextDecoder, requestAnimationFrame: callback => window.setTimeout(() => callback(window.performance.now()), 0),
    cancelAnimationFrame: id => window.clearTimeout(id), chrome: { dom: { openOrClosedShadowRoot: () => null } } });
  window.getComputedStyle = element => { const value = nativeStyle(element), inline = ["A", "B", "CODE", "EM", "I", "KBD", "MARK", "SPAN", "STRONG"].includes(element.tagName); return { display: value.display || (inline ? "inline" : "block"), visibility: value.visibility || "visible",
    opacity: value.opacity || "1", whiteSpace: value.whiteSpace || "normal", contentVisibility: value.contentVisibility || "visible" }; };
  window.__TRANSLATE_FLOW_CONTENT__ = { modules: { runtime: { constants: { EXTENSION_UI_ATTR: "data-tf-extension-ui", TRANSLATION_CLASS: "abt-translation" }, cleanText: value => String(value).trim() } } };
  for (const source of sources) window.eval(source);
  return { dom, window, modules: window.__TRANSLATE_FLOW_CONTENT__.modules };
}
async function anchorFor(f, selector, exact, { prefix = "", suffix = "", digest = true } = {}) {
  const value = f.modules.textProjection.project(f.window.document.querySelector(selector));
  assert.equal(value.status, "resolved", JSON.stringify(value));
  return { status: "resolved", quote: { exact, prefix, suffix }, position: { start: 0, end: exact.length }, blockDigest: digest ? await sha256(value.text) : null };
}

test("resolver restores a split-inline exact Range after node replacement and ignores the stale position hint", async t => {
  const f = fixture('<main><p id="target">alpha <span>ses</span><em>sion</em> tail</p></main>'); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "alpha ", suffix: " tail" });
  anchor.position = { start: 999, end: 1006 };
  f.window.document.querySelector("#target").innerHTML = 'alpha <strong>session</strong> tail';
  const replaced = f.modules.textProjection.project(f.window.document.querySelector("#target"));
  assert.equal(await sha256(replaced.text), anchor.blockDigest);
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "resolved", JSON.stringify(result)); assert.equal(result.range.toString(), "session");
  assert.equal(result.range.startContainer.parentElement.tagName, "STRONG");
});

test("resolver returns ambiguous for two fully corroborated blocks and never chooses the first", async t => {
  const f = fixture('<main><p class="same">alpha session tail</p><p class="same">alpha session tail</p></main>'); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, ".same", "session", { prefix: "alpha ", suffix: " tail" });
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "ambiguous"); assert.equal(result.range, null);
});

test("resolver distinguishes missing, unsupported and bounded not-loaded outcomes", async t => {
  const missing = fixture('<main><p id="target">alpha changed tail</p></main>'); t.after(() => missing.dom.window.close());
  const missingResult = await missing.modules.readingAnchorResolver.resolve({ status: "unsupported", quote: { exact: "session", prefix: "alpha ", suffix: " tail" }, position: null, blockDigest: null });
  assert.equal(missingResult.status, "missing");

  const unsupported = fixture('<main><private-widget>session</private-widget></main>'); t.after(() => unsupported.dom.window.close());
  const unsupportedResult = await unsupported.modules.readingAnchorResolver.resolve({ status: "unsupported", quote: { exact: "session", prefix: "", suffix: "" }, position: null, blockDigest: null });
  assert.equal(unsupportedResult.status, "unsupported");

  const limited = fixture('<main><p>other</p></main>'); t.after(() => limited.dom.window.close());
  limited.modules.textProjection.createScanner = () => ({
    complete: false,
    progress: () => ({ complete: false, incomplete: true, unsupported: false, stats: { nodes: 25_001, chars: 0, elapsedMs: 1 } }),
    snapshot: () => ({ status: "resolved", text: "", mapping: [], nodes: new Map(), domNodes: new Map(),
      complete: false, incomplete: true, unsupported: false, stats: { nodes: 25_001, chars: 0, elapsedMs: 1 } })
  });
  const limitedResult = await limited.modules.readingAnchorResolver.resolve({ status: "unsupported", quote: { exact: "session", prefix: "", suffix: "" }, position: null, blockDigest: null });
  assert.equal(limitedResult.status, "not-loaded"); assert.ok(limitedResult.stats.nodes > 25_000);
});

test("resolver rejects a quote whose retained block digest changed", async t => {
  const f = fixture('<main><p id="target">alpha session tail</p></main>'); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "alpha ", suffix: " tail" });
  anchor.blockDigest = "0".repeat(64);
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "missing"); assert.equal(result.range, null);
});

test("resolver retries one stale DOM revision and aborts without retaining a Range", async t => {
  const f = fixture('<main><p id="target">alpha session tail</p></main>'); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "alpha ", suffix: " tail", digest: false });
  let calls = 0;
  f.modules.textProjection.revision = () => calls++ === 0 ? 1 : 2;
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "resolved"); assert.equal(result.retries, 1); assert.equal(result.range.toString(), "session");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.modules.readingAnchorResolver.resolve(anchor, { signal: controller.signal }), error => error.name === "AbortError");
});

test("resolver never reads an oversized text node after its length already exceeds the slice", async t => {
  const f = fixture('<main><p id="giant"></p></main>'); t.after(() => f.dom.window.close());
  const node = f.window.document.createTextNode("x".repeat(20_000)); f.window.document.querySelector("#giant").appendChild(node);
  let reads = 0; const descriptor = Object.getOwnPropertyDescriptor(f.window.Node.prototype, "nodeValue");
  Object.defineProperty(node, "nodeValue", { configurable: true, get() { reads++; return descriptor.get.call(this); } });
  const result = await f.modules.readingAnchorResolver.resolve({ status: "unsupported", quote: { exact: "session", prefix: "", suffix: "" }, position: null, blockDigest: null });
  assert.equal(result.status, "not-loaded"); assert.equal(reads, 0);
});

test("page resolver shares one projection across summaries and keeps per-record ambiguity", async t => {
  const f = fixture('<main><p id="one">alpha session tail</p><p id="two">beta record end</p><p>alpha session tail</p></main>'); t.after(() => f.dom.window.close());
  const first = await anchorFor(f, "#one", "session", { prefix: "alpha ", suffix: " tail" });
  const second = await anchorFor(f, "#two", "record", { prefix: "beta ", suffix: " end" });
  const results = await f.modules.readingAnchorResolver.resolvePage([{ recordId: "a", anchor: first }, { recordId: "b", anchor: second }]);
  assert.equal(results.get("a").status, "ambiguous"); assert.equal(results.get("b").status, "resolved"); assert.equal(results.get("b").range.toString(), "record");
});

test("resumable page scan resolves a target beyond the first projection slice", async t => {
  const article = Array.from({ length: 90 }, (_, index) => `<p>section ${index} ${"filler ".repeat(90)}</p>`).join("");
  const f = fixture(`<main>${article}<p id="target">start 😀 session end</p></main>`); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "start 😀 ", suffix: " end" });
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "resolved", JSON.stringify(result));
  assert.equal(result.range.toString(), "session");
  assert.ok(result.stats.chars > 16_000);
  assert.ok(result.stats.waitMs >= 0);
});

test("page scan reports two end matches as ambiguous and preserves UTF-16 emoji and whitespace mapping", async t => {
  const article = Array.from({ length: 40 }, (_, index) => `<p>section ${index} ${"filler ".repeat(80)}</p>`).join("");
  const f = fixture(`<main>${article}<p id="duplicate">before session tail middle before session tail</p><p id="split">${"x".repeat(63)}😀   <span> cross</span>   boundary </p></main>`); t.after(() => f.dom.window.close());
  const duplicate = await anchorFor(f, "#duplicate", "session", { prefix: "before ", suffix: " tail" });
  assert.equal((await f.modules.readingAnchorResolver.resolve(duplicate)).status, "ambiguous");
  const split = await anchorFor(f, "#split", "😀 cross boundary", { prefix: "x".repeat(63) });
  f.window.document.querySelector("#split").innerHTML = `${"x".repeat(63)}<span>😀   cross</span>   boundary `;
  const resolved = await f.modules.readingAnchorResolver.resolve(split);
  assert.equal(resolved.status, "resolved", JSON.stringify(resolved));
  assert.equal(resolved.verifiedText, "😀 cross boundary");
  assert.equal(resolved.range.toString(), "😀   cross   boundary");
});

test("page scan restarts after a DOM revision and never reuses the stale final-page result", async t => {
  const paragraphs = Array.from({ length: 260 }, (_, index) => `<p>paragraph ${index}</p>`).join("");
  const f = fixture(`<main>${paragraphs}<p id="target">session at the end</p></main>`); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "", suffix: " at the end" });
  const nativeFrame = f.window.requestAnimationFrame.bind(f.window);
  let changed = false;
  f.window.requestAnimationFrame = callback => nativeFrame(time => {
    if (!changed) { changed = true; f.window.document.querySelector("#target").textContent = "changed at the end"; }
    callback(time);
  });
  const result = await f.modules.readingAnchorResolver.resolve(anchor);
  assert.equal(result.status, "missing");
  assert.equal(result.retries, 1);
});

test("page resolver caps work at 200 summaries and marks remaining rows not-loaded", async t => {
  const f = fixture('<main><p id="target">alpha session tail</p></main>'); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "alpha ", suffix: " tail" });
  const items = Array.from({ length: 201 }, (_, index) => ({ recordId: String(index), anchor }));
  const results = await f.modules.readingAnchorResolver.resolvePage(items);
  assert.equal(results.size, 201);
  assert.equal(results.get("199").status, "resolved");
  assert.equal(results.get("200").status, "not-loaded");
});

test("cancelling one shared long-page consumer leaves the other resolver result intact", async t => {
  const article = Array.from({ length: 80 }, (_, index) => `<p>${"filler ".repeat(500)}section ${index}</p>`).join("");
  const f = fixture(`<main>${article}<p id="target">start session at the end</p></main>`); t.after(() => f.dom.window.close());
  const anchor = await anchorFor(f, "#target", "session", { prefix: "start ", suffix: " at the end", digest: false });
  const frames = []; let nextFrameId = 0;
  f.window.requestAnimationFrame = callback => { const id = ++nextFrameId; frames.push({ id, callback }); return id; };
  f.window.cancelAnimationFrame = id => { const index = frames.findIndex(frame => frame.id === id); if (index >= 0) frames.splice(index, 1); };
  const controller = new AbortController();
  const markersRequest = f.modules.readingAnchorResolver.resolvePage([{ recordId: "marker-record", anchor }], { signal: controller.signal });
  let settled = false;
  const returnCardRequest = f.modules.readingAnchorResolver.resolve(anchor).finally(() => { settled = true; });
  assert.ok(frames.length > 0, "both consumers should share an in-progress page scan");
  controller.abort();
  await assert.rejects(markersRequest, error => error.name === "AbortError");
  let turns = 0;
  while (!settled) {
    assert.ok(turns++ < 40, "the surviving consumer should finish within the bounded scan");
    const frame = frames.shift(); assert.ok(frame, "the surviving scan should have a scheduled frame");
    frame.callback(turns * 16);
    await new Promise(resolve => setImmediate(resolve));
  }
  const result = await returnCardRequest;
  assert.equal(result.status, "resolved"); assert.equal(result.verifiedText, "session");
  assert.equal(result.range.toString(), "session");
});
