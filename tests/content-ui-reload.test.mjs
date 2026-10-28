import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function fixture({ invalidated = false } = {}) {
  const dom = new JSDOM("<!doctype html><body><p>Public synthetic text.</p></body>", { runScripts: "outside-only" });
  const w = dom.window;
  w.chrome = { runtime: { getURL: path => {
    if (invalidated) throw new Error("Extension context invalidated.");
    return `chrome-extension://fixture/${path}`;
  } } };
  const modules = {
    runtime: { constants: {} }, brandAssets: { icon: "assets/icons/icon-48.png" },
    contentI18n: { t: key => key, bindText: (el, key) => { el.textContent = key; }, bindAttribute() {}, unbindTree() {} },
    uiHost: { getLayer: () => w.document.body, ownsNode: () => false,
      createFocusReturn: () => ({ capture() {}, clear() {}, restore() {} }), isEventInsidePanel: () => false },
    selection: { installInteractionIsolation() {}, positionPopover() {} },
    selectionViewTabs: { create: () => ({ selectDictionary() {}, dispose() {} }) },
    selectionEmptyState: { create: () => ({ reset() {} }) }, selectionResultRenderer: {}
  };
  w.__TRANSLATE_FLOW_CONTENT__ = { modules };
  for (const name of ["ui/primitives.js", "selection/popover.js"]) {
    w.eval(readFileSync(new URL(`../src/content/${name}`, import.meta.url), "utf8"));
  }
  return { dom, w, modules, ui: modules.uiPrimitives, popover: modules.selectionPopover };
}

test("invalidated extension URL lookup leaves the selection chip usable with a text fallback", () => {
  const h = fixture({ invalidated: true });
  try {
    assert.doesNotThrow(() => h.popover.showChip({ text: "synthetic" }));
    const chip = h.w.document.querySelector(".tf-selection-chip");
    assert.equal(chip.textContent, "content.selection.chipMark");
    assert.equal(chip.querySelector("img"), null);
    assert.doesNotThrow(() => h.popover.hide());
    assert.equal(h.w.document.querySelector(".tf-selection-ui"), null);
  } finally { h.dom.window.close(); }
});

for (const previouslyMounted of [false, true]) test(`partial selection mount can be cleaned up (${previouslyMounted ? "null" : "undefined"} panel)`, () => {
  const h = fixture();
  try {
    if (previouslyMounted) { h.popover.showChip({}); h.popover.hide(); }
    h.ui.brandIcon = () => { throw new Error("Synthetic interrupted icon mount"); };
    assert.throws(() => h.popover.showChip({}), /interrupted icon mount/u);
    assert.doesNotThrow(() => h.popover.hide());
    assert.doesNotThrow(() => h.popover.hide());
    assert.equal(h.w.document.querySelector(".tf-selection-ui"), null);
  } finally { h.dom.window.close(); }
});

test("a healthy context retains the packaged brand icon and normal close/reopen", () => {
  const h = fixture();
  try {
    for (let i = 0; i < 2; i++) {
      h.popover.showChip({});
      assert.equal(h.w.document.querySelector(".tf-selection-chip img").getAttribute("src"), "chrome-extension://fixture/assets/icons/icon-48.png");
      h.popover.hide();
    }
  } finally { h.dom.window.close(); }
});
