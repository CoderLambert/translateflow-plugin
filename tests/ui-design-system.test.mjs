import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile(new URL("../src/ui/styles/tokens.css", import.meta.url), "utf8");
const components = await readFile(new URL("../src/ui/styles/components.css", import.meta.url), "utf8");
const contentTokens = await readFile(new URL("../src/content/ui/tokens.js", import.meta.url), "utf8");
const popup = await readFile(new URL("../popup.html", import.meta.url), "utf8");
const options = await readFile(new URL("../options.html", import.meta.url), "utf8");

test("extension pages share the TranslateFlow sage/beige token vocabulary", () => {
  for (const token of [
    "--tf-green-700",
    "--tf-bg-app",
    "--tf-bg-panel",
    "--tf-bg-card",
    "--tf-text-main",
    "--tf-border-main",
    "--tf-focus-ring",
    "--tf-transition"
  ]) assert.ok(tokens.includes(token), token + " missing from extension tokens");

  assert.doesNotMatch(tokens, /#1769aa|#2878d0|#58a6ff/i);
  assert.match(popup, /src\/ui\/styles\/tokens\.css/);
  assert.match(options, /src\/ui\/styles\/tokens\.css/);
});

test("shared extension primitives cover the required control families", () => {
  for (const selector of [
    ".tf-button--primary",
    ".tf-button--secondary",
    ".tf-button--ghost",
    ".tf-card",
    ".tf-field",
    ".tf-select",
    ".tf-switch",
    ".tf-badge",
    ".tf-accordion",
    ".tf-toast-surface"
  ]) assert.ok(components.includes(selector), selector + " missing from component primitives");

  assert.match(components, /:focus-visible/);
  assert.match(components, /prefers-reduced-motion:\s*reduce/);
});

test("content Shadow DOM mirrors the unified semantic tokens without the legacy blue accent", () => {
  for (const token of [
    "--tf-green-700",
    "--tf-bg-panel",
    "--tf-bg-card",
    "--tf-text-main",
    "--tf-border-main",
    "--tf-focus-ring"
  ]) assert.ok(contentTokens.includes(token), token + " missing from content tokens");

  assert.doesNotMatch(contentTokens, /#1769aa|#58a6ff/i);
  assert.match(contentTokens, /prefers-reduced-motion:\s*reduce/);
});
