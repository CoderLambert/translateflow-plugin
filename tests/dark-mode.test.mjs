import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile(new URL("../src/ui/styles/tokens.css", import.meta.url), "utf8");
const components = await readFile(new URL("../src/ui/styles/components.css", import.meta.url), "utf8");
const popupCss = await readFile(new URL("../popup.css", import.meta.url), "utf8");
const optionsCss = await readFile(new URL("../options.css", import.meta.url), "utf8");
const contentTokens = await readFile(new URL("../src/content/ui/tokens.js", import.meta.url), "utf8");
const quickStyles = await readFile(new URL("../src/content/ui/quick-control-styles.js", import.meta.url), "utf8");

const semanticControlTokens = [
  "--tf-control-track",
  "--tf-control-thumb",
  "--tf-control-thumb-shadow",
  "--tf-primary-foreground",
  "--tf-primary-hover-start",
  "--tf-accent-shadow"
];

test("dark mode completes extension semantic foreground and control tokens", () => {
  assert.match(tokens, /@media \(prefers-color-scheme:\s*dark\)/);
  assert.match(tokens, /--tf-green-900:\s*#dfe9da/);
  assert.match(tokens, /--tf-green-800:\s*#cbdac5/);
  assert.match(tokens, /--tf-primary-foreground:\s*#172017/);
  assert.match(tokens, /--tf-focus-ring:\s*0 0 0 3px rgba\(174, 198, 165, 0\.28\)/);

  for (const token of semanticControlTokens) {
    assert.ok(tokens.includes(token), token + " missing from extension token contract");
  }
});

test("content Shadow UI mirrors the dark semantic control contract", () => {
  assert.match(contentTokens, /@media \(prefers-color-scheme:\s*dark\)/);
  assert.match(contentTokens, /--tf-green-900:\s*#dfe9da/);
  assert.match(contentTokens, /--tf-green-800:\s*#cbdac5/);
  assert.match(contentTokens, /--tf-primary-foreground:\s*#172017/);

  for (const token of semanticControlTokens) {
    assert.ok(contentTokens.includes(token), token + " missing from content token contract");
  }
});

test("primary actions and switches consume theme semantics instead of light-only colors", () => {
  assert.match(components, /\.tf-button--primary[\s\S]*color:\s*var\(--tf-primary-foreground\)/);
  assert.match(optionsCss, /\.primary[\s\S]*color:\s*var\(--tf-primary-foreground\)/);
  assert.match(quickStyles, /\.tf-quick-trigger[\s\S]*color:\s*var\(--tf-primary-foreground\)/);
  assert.match(quickStyles, /\.tf-quick-translate[\s\S]*color:\s*var\(--tf-primary-foreground\)/);

  const switchSources = [components, popupCss, quickStyles].join("\n");
  assert.doesNotMatch(switchSources, /background:\s*#d8d9d1/);
  assert.doesNotMatch(switchSources, /background:\s*#fffdf8/);
  assert.match(switchSources, /var\(--tf-control-track\)/);
  assert.match(switchSources, /var\(--tf-control-thumb\)/);
});
