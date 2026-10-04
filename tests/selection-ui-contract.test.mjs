import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalogs } from "../src/i18n/catalog.js";

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
  assert.match(html, /i18n\.t\("options\.selection\.autoHelp"\)/);
  assert.match(catalogs.en["options.selection.autoHelp"], /AI details/u);
  assert.match(catalogs.zh_CN["options.selection.autoHelp"], /AI 详解/u);
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
  assert.match(popover, /locale\.bindText\(explainButton, "content\.selection\.aiDetail"\)/);
  assert.match(popover, /locale\.bindAttribute\(panel, "aria-label", "content\.selection\.aria"\)/);
  assert.match(popover, /locale\.bindAttribute\(chip, "aria-label", "content\.selection\.process"\)/);
  assert.match(catalogs.en["content.selection.aria"], /selection translation/u);
  assert.match(catalogs.zh_CN["content.selection.aria"], /划词翻译/u);
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
  assert.match(aiDetail, /locale\.bindAttribute\(retry, "aria-label", "content\.ai\.retryAria"\)/);
  assert.match(aiDetail, /locale\.bindAttribute\(cancel, "aria-label", state === "streaming" \? "content\.ai\.stopAria" : "content\.ai\.cancelAria"\)/);
  assert.match(catalogs.en["content.ai.stopAria"], /Stop/u);
  assert.match(catalogs.zh_CN["content.ai.stopAria"], /停止/u);
  for (const action of ["understand", "analyze", "usage"]) assert.match(aiDetail, new RegExp(action));
});

test("Selection result model separates local provenance and AI explanation", async () => {
  const [controller, resultModel, popover] = await Promise.all([
    source("src/content/selection/controller.js"),
    source("src/content/selection/result-model.js"),
    source("src/content/selection/popover.js")
  ]);

  assert.match(resultModel, /content\.selection\.sourceTechnical/);
  assert.match(resultModel, /content\.selection\.sourceLocal/);
  assert.match(resultModel, /content\.selection\.sourcePack/);
  assert.match(popover, /content\.selection\.loadingWord/);
  assert.match(controller, /content\.ai\.connecting/);
  for (const key of ["content.selection.sourceTechnical", "content.selection.sourceLocal", "content.selection.sourcePack", "content.ai.connecting"]) {
    assert.ok(catalogs.en[key]);
    assert.ok(catalogs.zh_CN[key]);
  }
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
  assert.match(emptyState, /content\.selection\.localEmptyTitle/);
  assert.match(controller, /messageKey: "content\.selection\.localEmptyHelp"/);
  assert.match(emptyState, /messageKey = "content\.selection\.localEmpty"/);
  assert.match(emptyState, /content\.selection\.aiFurtherAria/);
  assert.match(emptyState, /content\.selection\.regularTranslationAria/);
  assert.match(catalogs.en["content.selection.localEmptyTitle"], /local dictionary/u);
  assert.match(catalogs.zh_CN["content.selection.localEmptyTitle"], /本地词典/u);
  assert.match(catalogs.en["content.selection.lexiconMissing"], /Settings/u);
  assert.match(catalogs.zh_CN["content.selection.lexiconMissing"], /本地词典/u);

  assert.match(messages, /LEXICON_STORAGE/);
  assert.match(messages, /content\.selection\.lexiconMissing/);
  assert.match(messages, /content\.selection\.lexiconInvalid/);
  assert.match(messages, /content\.selection\.lexiconIncompatible/);
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
