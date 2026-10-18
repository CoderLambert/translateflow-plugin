import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

async function setup() {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/article" });
  const frames = [];
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.__TRANSLATE_FLOW_CONTENT__ = { modules: {} };
  await import(`../src/entries/selection-markdown.js?test=${crypto.randomUUID()}`);
  return { dom, frames, renderer: globalThis.__TRANSLATE_FLOW_CONTENT__.modules.selectionMarkdownRenderer };
}

test("Selection Markdown builds basic DOM without activating model HTML or remote images", async () => {
  const { dom, renderer } = await setup();
  const target = document.createElement("div"); document.body.appendChild(target);
  renderer.render(target, [
    "## Summary",
    "",
    "**bold** and *emphasis* with `code`.",
    "",
    "- first",
    "- second",
    "",
    "| A | B |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "<img src=x onerror=alert(1)>",
    "![remote](https://remote.invalid/pixel.png)",
    "[unsafe](javascript:alert(1)) [safe](https://example.org/path)"
  ].join("\n"));

  assert.equal(target.querySelector("h2")?.textContent, "Summary");
  assert.equal(target.querySelector("strong")?.textContent, "bold");
  assert.equal(target.querySelectorAll("li").length, 2);
  assert.equal(target.querySelectorAll("table").length, 1);
  assert.equal(target.querySelectorAll("img,script").length, 0);
  assert.match(target.textContent, /<img src=x onerror=alert\(1\)>/u);
  assert.match(target.querySelector(".tf-selection-markdown-image-alt")?.textContent || "", /remote/u);
  assert.match(target.textContent, /unsafe/u);
  assert.equal([...target.querySelectorAll("a")].some(link => link.href.startsWith("javascript:")), false);
  assert.equal(target.querySelector("a")?.href, "https://example.org/path");
  assert.equal(target.querySelector("a")?.rel, "noopener noreferrer");
  dom.window.close();
});

test("Selection Markdown coalesces streaming updates and commits only the latest text", async () => {
  const { dom, frames, renderer } = await setup();
  const target = document.createElement("div"); document.body.appendChild(target);
  let rendered = 0;
  renderer.render(target, "**partial", { streaming: true, onRendered: () => rendered++ });
  renderer.render(target, "**complete**", { streaming: true, onRendered: () => rendered++ });
  assert.equal(frames.length, 1);
  frames.shift()(0);
  assert.equal(target.querySelector("strong")?.textContent, "complete");
  assert.equal(rendered, 1);
  dom.window.close();
});
