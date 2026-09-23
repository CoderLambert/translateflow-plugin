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
});

test("message values stay unique inside each channel", () => {
  assert.equal(new Set(Object.values(BACKGROUND_MESSAGES)).size, Object.keys(BACKGROUND_MESSAGES).length);
  assert.equal(new Set(Object.values(CONTENT_MESSAGES)).size, Object.keys(CONTENT_MESSAGES).length);
});

test("content bootstrap is loaded last", () => {
  assert.equal(CONTENT_SCRIPT_FILES.at(-1), "content.js");
});
