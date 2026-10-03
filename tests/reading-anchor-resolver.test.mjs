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
  limited.modules.textProjection.project = () => ({ status: "resolved", text: "", mapping: [], domNodes: new Map(), stats: { nodes: 25_001, chars: 0, elapsedMs: 1 } });
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
