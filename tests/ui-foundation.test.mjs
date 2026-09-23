import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PRIMITIVES = new URL("../src/content/ui/primitives.js", import.meta.url);

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.type = "";
    this.disabled = false;
    this.selected = false;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }
}

function loadPrimitives() {
  const context = vm.createContext({
    document: {
      createElement(tagName) {
        return new FakeNode(tagName);
      }
    },
    __TRANSLATE_FLOW_CONTENT__: {
      modules: {
        uiHost: {}
      }
    }
  });

  vm.runInContext(readFileSync(PRIMITIVES, "utf8"), context);
  return context.__TRANSLATE_FLOW_CONTENT__.modules.uiPrimitives;
}

test("select and menu primitives provide reusable accessible shells", () => {
  const ui = loadPrimitives();
  const select = ui.select({
    label: "Subtitle mode",
    value: "bilingual",
    options: [
      { value: "off", label: "Off" },
      { value: "bilingual", label: "Bilingual" }
    ]
  });

  assert.equal(select.className, "tf-ui-select");
  assert.equal(select.getAttribute("aria-label"), "Subtitle mode");
  assert.equal(select.children.length, 2);
  assert.equal(select.children[1].selected, true);

  const menu = ui.menu({ label: "Translation options", className: "custom-menu" });
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(menu.getAttribute("aria-label"), "Translation options");
  assert.match(menu.className, /tf-ui-menu/);
  assert.match(menu.className, /custom-menu/);
});

test("status badge exposes semantic kind without product-specific behavior", () => {
  const ui = loadPrimitives();
  const badge = ui.badge({ text: "Ready", kind: "success" });

  assert.equal(badge.tagName, "SPAN");
  assert.equal(badge.textContent, "Ready");
  assert.equal(badge.dataset.kind, "success");
  assert.equal(badge.className, "tf-ui-badge");
});

test("progress primitive clamps values and updates ARIA state", () => {
  const ui = loadPrimitives();
  const progress = ui.progress({ value: 3, max: 4, label: "Translation progress" });

  assert.equal(progress.getAttribute("role"), "progressbar");
  assert.equal(progress.getAttribute("aria-label"), "Translation progress");
  assert.equal(progress.getAttribute("aria-valuenow"), "3");
  assert.equal(progress.getAttribute("aria-valuemax"), "4");
  assert.equal(progress.firstElementChild.style.width, "75%");
  assert.equal(progress.dataset.state, "active");

  ui.setProgress(progress, 9, 4);
  assert.equal(progress.getAttribute("aria-valuenow"), "4");
  assert.equal(progress.firstElementChild.style.width, "100%");
  assert.equal(progress.dataset.state, "complete");
});
