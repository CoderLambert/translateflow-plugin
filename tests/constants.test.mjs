import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUND_MESSAGES, CONTENT_MESSAGES, CONTENT_SCRIPT_FILES, DEFAULT_CONFIG } from "../src/shared/constants.js";

test("default config remains compatible with existing DeepSeek cache version", () => {
  assert.equal(DEFAULT_CONFIG.provider, "deepseek"); assert.equal(DEFAULT_CONFIG.model, "deepseek-flash");
  assert.equal(DEFAULT_CONFIG.targetLanguage, "Simplified Chinese"); assert.equal(DEFAULT_CONFIG.appearance, "standard");
  assert.equal(DEFAULT_CONFIG.youtubeSubtitleMode, "bilingual"); assert.equal(DEFAULT_CONFIG.youtubeSubtitleSize, "standard");
});

test("message values stay unique inside each channel", () => {
  assert.equal(new Set(Object.values(BACKGROUND_MESSAGES)).size, Object.keys(BACKGROUND_MESSAGES).length);
  assert.equal(new Set(Object.values(CONTENT_MESSAGES)).size, Object.keys(CONTENT_MESSAGES).length);
});

test("build-free content runtime mirrors Quick Control message values", () => {
  const source = readFileSync(new URL("../src/content/runtime.js", import.meta.url), "utf8");
  const required = [CONTENT_MESSAGES.QUICK_CONTROL_SHOW, CONTENT_MESSAGES.QUICK_CONTROL_TOGGLE, BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT, BACKGROUND_MESSAGES.TEMP_PRESET_SET, BACKGROUND_MESSAGES.SITE_APPEARANCE_SAVE, BACKGROUND_MESSAGES.QUICK_CONTROL_SITE_HIDE, BACKGROUND_MESSAGES.OPEN_OPTIONS];
  for (const value of required) assert.ok(source.includes(`"${value}"`), `${value} missing from content runtime`);
});

test("task runtime is loaded before content processors", () => {
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js") > CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js"));
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js") < CONTENT_SCRIPT_FILES.indexOf("src/content/processor.js"));
});

test("appearance runtime loads after core runtime and before translation tasks", () => {
  const runtimeIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js"), appearanceIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/appearance.js"), tasksIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/tasks.js");
  assert.ok(appearanceIndex > runtimeIndex); assert.ok(appearanceIndex < tasksIndex);
});

test("shared UI foundation loads after runtime and before extension-owned controls", () => {
  const uiFiles = ["src/content/ui/tokens.js", "src/content/ui/quick-control-styles.js", "src/content/ui/host.js", "src/content/ui/primitives.js", "src/content/ui/toast.js"];
  const runtimeIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/runtime.js"), popoverIndex = CONTENT_SCRIPT_FILES.indexOf("src/content/selection/popover.js");
  for (const file of uiFiles) { const index = CONTENT_SCRIPT_FILES.indexOf(file); assert.ok(index > runtimeIndex, `${file} should load after runtime`); assert.ok(index < popoverIndex, `${file} should load before selection controls`); }
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/ui/quick-control-styles.js") < CONTENT_SCRIPT_FILES.indexOf("src/content/ui/host.js"));
});

test("YouTube subtitle stack is injected in dependency order before bootstrap", () => {
  const files = ["src/content/subtitles/source.js", "src/content/subtitles/sources/text-track.js", "src/content/subtitles/sources/youtube.js", "src/content/subtitles/pipeline.js", "src/content/subtitles/renderer.js", "src/content/subtitles/controller.js"];
  for (const file of files) assert.ok(CONTENT_SCRIPT_FILES.includes(file), `${file} should be injected`);
  for (let index = 1; index < files.length; index += 1) assert.ok(CONTENT_SCRIPT_FILES.indexOf(files[index]) > CONTENT_SCRIPT_FILES.indexOf(files[index - 1]), `${files[index]} should follow ${files[index - 1]}`);
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/subtitles/controller.js") < CONTENT_SCRIPT_FILES.indexOf("content.js"));
});

test("content bootstrap is loaded last", () => assert.equal(CONTENT_SCRIPT_FILES.at(-1), "content.js"));

test("selection modules are loaded before the content bootstrap", () => {
  for (const file of ["src/content/selection/selection.js", "src/content/selection/popover.js", "src/content/selection/controller.js"]) {
    assert.ok(CONTENT_SCRIPT_FILES.includes(file), `${file} should be injected`); assert.ok(CONTENT_SCRIPT_FILES.indexOf(file) < CONTENT_SCRIPT_FILES.indexOf("content.js"));
  }
});
