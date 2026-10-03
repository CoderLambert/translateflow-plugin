import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("#107 Selection release gate keeps every required fixture family in manual verification", async () => {
  const [
    integrated,
    releaseGate,
    missing,
    corrupt,
    incompatible,
    fixture,
    workflow
  ] = await Promise.all([
    source("e2e/translateflow.spec.mjs"),
    source("e2e/selection-release-gate.spec.mjs"),
    source("e2e/selection-lexicon-error.spec.mjs"),
    source("e2e/selection-lexicon-corrupt.spec.mjs"),
    source("e2e/selection-lexicon-incompatible.spec.mjs"),
    source("e2e/support/extension-fixture.mjs"),
    source(".github/workflows/lexicon-release.yml")
  ]);

  for (const marker of [
    "selection controls are isolated, avoid page-cache reuse, and resolve local lexicon without Provider calls",
    "single-word lexical no-hit is neutral and provider-free until an explicit action",
    "ambiguous Selection keeps dictionary content visible through explicit AI detail",
    "technical entity Selection stays compact and preserves supplied identity metadata",
    "Selection AI detail cancel preserves local content and stale completion cannot overwrite retry",
    "Selection card exposes provenance, explicit AI retry, narrow viewport and copy",
    "selection context stays selection-only inside nested editable surfaces"
  ]) {
    assert.ok(integrated.includes(marker), marker);
  }

  for (const marker of [
    "technical Core/Technical competition stays local, attributable and Provider-free",
    "unknown multi-word phrase falls back to ordinary translation without lexical concatenation",
    "Selection remains readable in dark reduced-motion mode without page overflow",
    "long lexical card remains inside the viewport at every selection edge",
    "new Selection supersedes in-flight AI detail and outside click dismisses the current card"
  ]) {
    assert.ok(releaseGate.includes(marker), marker);
  }

  assert.match(missing, /lexiconPacks: "missing"/);
  assert.match(missing, /内置本地词典资源缺失或不可读/);
  assert.match(corrupt, /lexiconPacks: "corrupt"/);
  assert.match(corrupt, /内置本地词典校验失败/);
  assert.match(incompatible, /lexiconPacks: "incompatible"/);
  assert.match(incompatible, /与当前扩展版本不兼容/);

  assert.match(fixture, /prepareExtensionTestCopy\(/);
  assert.doesNotMatch(fixture, /buildExtension\(/);
  assert.match(await source("e2e/support/production-artifact.mjs"), /lexiconPacks === "corrupt"/);
  assert.match(await source("e2e/support/production-artifact.mjs"), /lexiconPacks === "incompatible"/);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request):/m);
  assert.match(workflow, /npm run test:e2e -- --reporter=line,json/);
  assert.match(workflow, /REQUIRE_RELEASE_LEXICON_PACKS: "1"/);
});

test("#107 hard assertions remain explicit in browser evidence", async () => {
  const [integrated, releaseGate, corrupt, incompatible] = await Promise.all([
    source("e2e/translateflow.spec.mjs"),
    source("e2e/selection-release-gate.spec.mjs"),
    source("e2e/selection-lexicon-corrupt.spec.mjs"),
    source("e2e/selection-lexicon-incompatible.spec.mjs")
  ]);

  assert.match(integrated, /expect\(harness\.server\.calls\)\.toHaveLength\(0\)/);
  assert.match(integrated, /Selection Explain/);
  assert.match(integrated, /CACHE_LOOKUP/);
  assert.match(integrated, /hits\)\.toEqual\(\[\]\)/);
  assert.match(integrated, /contextText\.length\)\.toBeLessThanOrEqual\(900\)/);
  assert.match(integrated, /userContent\)\.not\.toContain\(page\.url\(\)\)/);
  assert.match(integrated, /aria-modal/);
  assert.match(integrated, /toBeFocused\(\)/);

  assert.match(releaseGate, /technical-concept/);
  assert.match(releaseGate, /data-result-kind", "translation"/);
  assert.match(releaseGate, /transitionDuration\)\.toBe\("0s"\)/);
  assert.match(releaseGate, /scrollWidth - document\.documentElement\.clientWidth/);
  assert.match(releaseGate, /not\.toContainText\("持续存在或保持有效"\)/);
  assert.match(releaseGate, /toBeHidden\(\)/);

  for (const diagnostic of [corrupt, incompatible]) {
    assert.match(diagnostic, /设置 > 本地词典/);
    assert.match(diagnostic, /name: "重试"/);
    assert.match(diagnostic, /server\.calls\)\.toHaveLength\(0\)/);
  }
});
