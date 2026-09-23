import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSLATION_PRESETS,
  composePresetPrompt,
  getPreset,
  normalizePresetId
} from "../src/shared/presets.js";
import { composeGlossaryPrompt } from "../src/shared/glossary.js";

test("built-in preset ids are stable and complete", () => {
  assert.deepEqual(
    TRANSLATION_PRESETS.map((preset) => preset.id),
    ["technical", "academic", "news", "natural"]
  );
});

test("unknown or empty preset keeps prompt unchanged", () => {
  const prompt = "custom prompt";
  assert.equal(composePresetPrompt(prompt, ""), prompt);
  assert.equal(composePresetPrompt(prompt, "unknown"), prompt);
  assert.equal(normalizePresetId("TECHNICAL"), "technical");
  assert.equal(normalizePresetId("unknown"), "");
});

test("preset composition is deterministic and does not mutate the base prompt", () => {
  const prompt = "custom prompt";
  const a = composePresetPrompt(prompt, "technical");
  const b = composePresetPrompt(prompt, "technical");

  assert.equal(a, b);
  assert.match(a, /^custom prompt/);
  assert.match(a, /Translation style preset: Technical/);
  assert.equal(prompt, "custom prompt");
  assert.equal(getPreset("technical").label, "Technical");
});

test("preset then glossary composition is deterministic", () => {
  const glossary = [
    { source: "repository", target: "仓库" },
    { source: "pull request", target: "拉取请求" }
  ];
  const a = composeGlossaryPrompt(composePresetPrompt("base", "technical"), glossary);
  const b = composeGlossaryPrompt(composePresetPrompt("base", "technical"), glossary);

  assert.equal(a, b);
  assert.ok(a.indexOf("Translation style preset: Technical") < a.indexOf("Terminology glossary"));
});
