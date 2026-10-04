import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Selection settings expose all explanation-depth modes and license path", async () => {
  const [html, js] = await Promise.all([
    source("src/options/CommonSections.tsx"),
    source("src/options/client.ts")
  ]);

  assert.match(html, /id="selectionExplanationDepth"/);
  for (const value of ["auto", "concise", "standard", "professional"]) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(html, /点击“AI 详解”/);
  assert.match(html, /assets\/lexicon\/core\/THIRD_PARTY_NOTICES\.txt/);
  assert.match(js, /normalizeSelectionDepth\(value\.selectionExplanationDepth\)/);
  assert.match(js, /selectionExplanationDepth:\s*normalizeSelectionDepth\(input\.selectionExplanationDepth\)/);
});

test("Selection popover keeps a non-modal structured result region", async () => {
  const [popover, renderer, tokens, aiStyles, emptyStyles, lexicalStyles] = await Promise.all([
    source("src/content/selection/popover.js"),
    source("src/content/selection/result-renderer.js"),
    source("src/content/ui/tokens.js"),
    source("src/content/ui/selection-ai-detail-styles.js"),
    source("src/content/ui/selection-empty-state-styles.js"),
    source("src/content/ui/selection-lexical-styles.js")
  ]);

  assert.match(popover, /aria-modal", "false"/);
  assert.match(renderer, /tf-selection-result-badge/);
  assert.match(renderer, /tf-selection-dictionary-entries/);
  assert.match(renderer, /tf-selection-entry-meaning/);
  assert.match(popover, /renderStructuredResult/);
  assert.match(popover, /showAiDetailResult/);
  assert.match(popover, /AI 详解/);
  assert.match(popover, /label: "处理所选文本"/);
  assert.match(popover, /duplicatesHeadword/);
  assert.match(popover, /tf-selection-action-primary/);
  assert.match(popover, /tf-selection-action-quiet/);
  assert.match(popover, /function reposition\(\)/);
  assert.match(tokens, /\.tf-selection-panel[\s\S]*max-height:[^;]+;/);
  assert.match(tokens, /\.tf-selection-result[\s\S]*overflow:\s*auto;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(aiStyles, /\.tf-selection-ai-detail/);
  assert.match(aiStyles, /\.tf-selection-ai-actions/);
  assert.match(emptyStyles, /\.tf-selection-empty/);
  assert.match(emptyStyles, /\.tf-selection-empty-actions/);
  assert.match(lexicalStyles, /\.tf-selection-dictionary-entry/);
  assert.match(lexicalStyles, /\.tf-selection-entry-provenance/);
  assert.match(lexicalStyles, /\.tf-selection-more-entries/);
  assert.match(lexicalStyles, /\.tf-selection-action-primary/);
  assert.match(lexicalStyles, /\.tf-selection-action-quiet/);
});

test("Selection assistant preserves the local card while streaming, stopping and retrying", async () => {
  const [controller, popover, aiDetail] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/popover.js"),
    source("src/content/selection/ai-detail.js")
  ]);

  assert.match(controller, /explainSnapshot\(snapshot, resolved\.depth, card, event, action\)/);
  assert.match(controller, /selection\.assistant-stream/);
  assert.match(controller, /message\.type === "started"/);
  assert.match(controller, /popover\.showAiDetailStreaming/);
  assert.match(controller, /popover\.showAiDetailStopping/);
  assert.match(controller, /popover\.showAiDetailInterrupted/);
  assert.match(controller, /message\.turn\?\.completionStatus !== "completed"/);
  assert.match(controller, /isCurrentSelection\(version, snapshot, expectedPage\)/);
  assert.match(popover, /showAiDetailResult/);
  assert.match(aiDetail, /aria-busy/);
  assert.match(aiDetail, /重新请求 AI 详解/);
  assert.match(aiDetail, /停止 AI 回答/);
  for (const action of ["understand", "analyze", "usage"]) assert.match(aiDetail, new RegExp(action));
});

test("Selection result model separates local provenance and AI explanation", async () => {
  const [controller, resultModel, popover] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/result-model.js"),
    source("src/content/selection/popover.js")
  ]);

  assert.match(resultModel, /技术词条/);
  assert.match(resultModel, /本地词典/);
  assert.match(resultModel, /AI 辅助/);
  assert.match(resultModel, /词典包 ·/);
  assert.match(popover, /正在查词/);
  assert.match(controller, /正在连接 AI 助手/);
  assert.match(controller, /resolved\.routeReason === "no-hit-local"/);
  assert.match(controller, /popover\.showEmpty/);
  assert.match(controller, /forceTranslation: true/);
  assert.match(controller, /explainSnapshot/);
  assert.doesNotMatch(controller, /resolved\.route === "needs-explanation"/);
  assert.match(controller, /copyTextForCard/);
});

test("Selection no-hit is neutral while local lexicon failures keep diagnostic error copy", async () => {
  const [controller, popover, emptyState, messages] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/popover.js"),
    source("src/content/selection/empty-state.js"),
    source("src/content/selection/messages.js")
  ]);

  assert.match(controller, /resolved\.routeReason === "no-hit-local"/);
  assert.match(popover, /setStatus\(statusNode, "", "info"\)/);
  assert.match(emptyState, /container\.dataset\.resultKind = "empty"/);
  assert.match(emptyState, /本地词典暂未收录/);
  assert.match(emptyState, /使用 AI 进一步解释这个词/);
  assert.match(emptyState, /使用普通翻译处理这个词/);

  assert.match(messages, /LEXICON_STORAGE/);
  assert.match(messages, /设置 > 本地词典/);
  assert.match(messages, /LEXICON_CORRUPT/);
  assert.match(messages, /LEXICON_INCOMPATIBLE/);
  assert.match(controller, /popover\.showError/);
});

test("Selection result hierarchy renders dictionary content before provenance", async () => {
  const renderer = await source("src/content/selection/result-renderer.js");

  const headwordIndex = renderer.indexOf("renderHeadword(container, result)");
  const compactIndex = renderer.indexOf("renderCompactMeaning(container, result)");
  const badgesIndex = renderer.indexOf("renderBadges(container, result.badges)");
  assert.ok(headwordIndex >= 0 && compactIndex > headwordIndex && badgesIndex > compactIndex);
  assert.match(renderer, /tf-selection-entry-provenance/);
});
