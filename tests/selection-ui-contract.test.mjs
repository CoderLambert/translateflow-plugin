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
  assert.match(html, /点击“AI 详解”/);
  assert.match(html, /assets\/lexicon\/core\/THIRD_PARTY_NOTICES\.txt/);
  assert.match(js, /normalizeSelectionDepth\(config\.selectionExplanationDepth\)/);
  assert.match(js, /selectionExplanationDepth:\s*normalizeSelectionDepth\(selectionExplanationDepth\.value\)/);
});

test("Selection popover keeps a non-modal structured result region", async () => {
  const [popover, tokens, aiStyles] = await Promise.all([
    source("src/content/selection/popover.js"),
    source("src/content/ui/tokens.js"),
    source("src/content/ui/selection-ai-detail-styles.js")
  ]);

  assert.match(popover, /aria-modal", "false"/);
  assert.match(popover, /tf-selection-result-badge/);
  assert.match(popover, /tf-selection-generated/);
  assert.match(popover, /AI 详解/);
  assert.match(popover, /function reposition\(\)/);
  assert.match(tokens, /\.tf-selection-panel[\s\S]*max-height:[^;]+;/);
  assert.match(tokens, /\.tf-selection-result[\s\S]*overflow:\s*auto;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(aiStyles, /\.tf-selection-ai-detail/);
  assert.match(aiStyles, /\.tf-selection-ai-actions/);
});

test("Selection AI detail preserves the local card across loading, failure and cancellation", async () => {
  const [controller, popover, aiDetail] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/popover.js"),
    source("src/content/selection/ai-detail.js")
  ]);

  assert.match(controller, /explainSnapshot\(snapshot, resolved\.depth, card\)/);
  assert.match(controller, /popover\.showAiDetailLoading/);
  assert.match(controller, /popover\.showAiDetailError/);
  assert.match(controller, /popover\.showAiDetailCancelled/);
  assert.match(controller, /isCurrentSelection\(version, snapshot, expectedPage\)/);
  assert.match(popover, /showAiDetailResult/);
  assert.match(aiDetail, /aria-busy/);
  assert.match(aiDetail, /重新请求 AI 详解/);
  assert.match(aiDetail, /取消 AI 详解/);
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
  assert.match(controller, /本地词典未找到可靠结果；如需进一步判断，可点击“AI 详解”/);
  assert.match(controller, /explainSnapshot/);
  assert.doesNotMatch(controller, /resolved\.route === "needs-explanation"/);
  assert.match(controller, /copyTextForCard/);
});

test("Selection local lexicon failures direct users to bundled health diagnostics", async () => {
  const controller = await readFile(
    new URL("../src/content/selection/controller.js", import.meta.url),
    "utf8"
  );
  assert.match(controller, /LEXICON_STORAGE/);
  assert.match(controller, /设置 > 本地词典/);
  assert.match(controller, /LEXICON_CORRUPT/);
  assert.match(controller, /LEXICON_INCOMPATIBLE/);
});
