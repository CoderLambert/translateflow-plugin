import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAppearance } from "../src/shared/appearance.js";

const contentCss = await readFile(new URL("../content.css", import.meta.url), "utf8");
const toastSource = await readFile(new URL("../src/content/ui/toast.js", import.meta.url), "utf8");
const uiTokens = await readFile(new URL("../src/content/ui/tokens.js", import.meta.url), "utf8");
const appearanceSource = await readFile(new URL("../src/shared/appearance.js", import.meta.url), "utf8");

test("reading presets use the sage/beige visual language without the legacy blue accent", () => {
  const standard = resolveAppearance("standard");
  const compact = resolveAppearance("compact");
  const reading = resolveAppearance("reading");
  const minimal = resolveAppearance("minimal");

  assert.equal(standard.variables["--tf-translation-border-color"], "rgba(111, 150, 104, 0.34)");
  assert.equal(compact.variables["--tf-translation-border-width"], "1px");
  assert.equal(reading.variables["--tf-translation-background"], "rgba(246, 241, 232, 0.46)");
  assert.equal(minimal.variables["--tf-translation-background"], "transparent");
  assert.equal(minimal.variables["--tf-translation-border-width"], "0px");
  assert.doesNotMatch(appearanceSource, /34,\s*113,\s*177/);
});

test("translated paragraphs stay lightweight and inherit host typography", () => {
  assert.match(contentCss, /font:\s*inherit\s*!important/);
  assert.match(contentCss, /box-shadow:\s*none\s*!important/);
  assert.match(contentCss, /border-left:\s*var\(--tf-translation-border-width/);
  assert.match(contentCss, /rgba\(111,\s*150,\s*104,\s*0\.34\)/);
  assert.doesNotMatch(contentCss, /rgba\(34,\s*113,\s*177/);
});

test("toast feedback is compact and carries semantic text-independent cues", () => {
  assert.match(uiTokens, /max-width:\s*320px/);
  assert.match(uiTokens, /\.tf-toast-icon/);
  assert.match(uiTokens, /data-kind="error"/);
  assert.match(toastSource, /success:\s*"✓"/);
  assert.match(toastSource, /warning:\s*"!"/);
  assert.match(toastSource, /normalizedKind === "error" \? "assertive" : "polite"/);
  assert.match(toastSource, /tf-toast-message/);
});

test("a standing progress notice can stay visible without a hide timer", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  const layer = window.document.createElement("div");
  window.document.body.appendChild(layer);
  const app = { modules: { uiHost: { getLayer: () => layer } } };
  window.eval(`globalThis.__TRANSLATE_FLOW_CONTENT__ = ${JSON.stringify({})};`);
  const context = { __TRANSLATE_FLOW_CONTENT__: app, document: window.document };
  const { runInNewContext } = await import("node:vm");
  runInNewContext(toastSource, { ...context, setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window) });
  const toast = app.modules.uiToast;
  assert.equal(typeof toast?.show, "function");

  toast.show("Translating… 1/20", "info", { persistent: true });
  const node = layer.querySelector(".tf-toast");
  assert.equal(node.dataset.visible, "true");
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(node.dataset.visible, "true", "a persistent notice ignores the auto-hide timer");

  toast.show("Done", "success");
  assert.equal(node.querySelector(".tf-toast-message").textContent, "Done");
  dom.window.close();
});
