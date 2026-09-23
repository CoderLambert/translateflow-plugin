import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKGROUND_MESSAGES,
  CONTENT_MESSAGES,
  CONTENT_SCRIPT_FILES,
  DEFAULT_CONFIG
} from "../src/shared/constants.js";

test("default config remains compatible with existing DeepSeek cache version", () => {
  assert.equal(DEFAULT_CONFIG.provider, "deepseek");
  assert.equal(DEFAULT_CONFIG.model, "deepseek-flash");
  assert.equal(DEFAULT_CONFIG.targetLanguage, "Simplified Chinese");
  assert.equal(DEFAULT_CONFIG.appearance, "standard");
});

test("message values stay unique inside each channel", () => {
  assert.equal(new Set(Object.values(BACKGROUND_MESSAGES)).size, Object.keys(BACKGROUND_MESSAGES).length);
  assert.equal(new Set(Object.values(CONTENT_MESSAGES)).size, Object.keys(CONTENT_MESSAGES).length);
});

test("task runtime is loaded before content processors", () => {
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js") > CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js"));
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js") < CONTENT_SCRIPT_FILES.indexOf("src/content/processor.js"));
});

test("appearance runtime loads after core runtime and before translation tasks", () => {
  const runtimeIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js");
  const appearanceIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/appearance.js");
  const tasksIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js");
  assert.ok(appearanceIndex > runtimeIndex);
  assert.ok(appearanceIndex < tasksIndex);
});

test("shared UI foundation loads after runtime and before extension-owned controls", () => {
  const uiFiles = [
    "src/content/ui/tokens.js",
    "src/content/ui/host.js",
    "src/content/ui/primitives.js",
    "src/content/ui/toast.js"
  ];
  const runtimeIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js");
  const popoverIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/selection/popover.js");

  for (const file of uiFiles) {
    const index = CONTENT_SCRIPT_FILES.indexOf(file);
    assert.ok(index > runtimeIndex, `${file} should load after runtime`);
    assert.ok(index < popoverIndex, `${file} should load before selection controls`);
  }
});

test("content bootstrap is loaded last", () => {
  assert.equal(CONTENT_SCRIPT_FILES.at(-1), "content.js");
});

test("selection modules are loaded before the content bootstrap", () => {
  const selectionFiles = [
    "src/content/selection/selection.js",
    "src/content/selection/popover.js",
    "src/content/selection/controller.js"
  ];

  for (const file of selectionFiles) {
    assert.ok(CONTENT_SCRIPT_FILES.includes(file), `${file} should be injected`);
    assert.ok(CONTENT_SCRIPT_FILES.indexOf(file) < CONTENT_SCRIPT_FILES.indexOf("content.js"));
  }
});
