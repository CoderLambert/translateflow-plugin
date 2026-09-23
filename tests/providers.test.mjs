import test from "node:test";
import assert from "node:assert/strict";
import { buildTranslationPrompt } from "../src/background/providers/shared.js";

test("provider prompt includes the resolved target language", () => {
  assert.equal(
    buildTranslationPrompt({ prompt: "Translate naturally.", targetLanguage: "Japanese" }),
    "Translate naturally.\nTarget language: Japanese."
  );
});

test("provider prompt updates the built-in language instruction", () => {
  assert.equal(
    buildTranslationPrompt({
      prompt: "Translate the provided English web-page segments into natural Simplified Chinese.",
      targetLanguage: "English"
    }),
    "Translate the provided English web-page segments into natural English."
  );
});

test("provider prompt does not duplicate an already-mentioned target language", () => {
  const prompt = "Translate the content into Simplified Chinese.";
  assert.equal(
    buildTranslationPrompt({ prompt, targetLanguage: "Simplified Chinese" }),
    prompt
  );
});
