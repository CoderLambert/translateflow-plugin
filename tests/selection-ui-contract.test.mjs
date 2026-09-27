import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Selection settings expose all explanation-depth modes and license path", async () => {
  const [html, js] = await Promise.all([
    source("options.html"),
    source("options.js")
  ]);

  assert.match(html, /id="selectionExplanationDepth"/);
  for (const value of ["auto", "concise", "standard", "professional"]) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(html, /assets\/lexicon\/core\/THIRD_PARTY_NOTICES\.txt/);
  assert.match(js, /normalizeSelectionDepth\(config\.selectionExplanationDepth\)/);
  assert.match(js, /selectionExplanationDepth:\s*normalizeSelectionDepth\(selectionExplanationDepth\.value\)/);
});

test("Selection popover keeps a non-modal structured result region", async () => {
  const [popover, tokens] = await Promise.all([
    source("src/content/selection/popover.js"),
    source("src/content/ui/tokens.js")
  ]);

  assert.match(popover, /aria-modal", "false"/);
  assert.match(popover, /tf-selection-result-badge/);
  assert.match(popover, /tf-selection-generated/);
  assert.match(popover, /function reposition\(\)/);
  assert.match(tokens, /\.tf-selection-panel[\s\S]*max-height:[^;]+;/);
  assert.match(tokens, /\.tf-selection-result[\s\S]*overflow:\s*auto;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Selection result model separates local provenance and AI explanation", async () => {
  const [controller, resultModel] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/result-model.js")
  ]);

  assert.match(resultModel, /技术词条/);
  assert.match(resultModel, /本地词典/);
  assert.match(resultModel, /AI 辅助/);
  assert.match(resultModel, /词典包 ·/);
  assert.match(controller, /本地词典未找到可靠结果，且 AI 辅助暂不可用/);
  assert.match(controller, /copyTextForCard/);
});
