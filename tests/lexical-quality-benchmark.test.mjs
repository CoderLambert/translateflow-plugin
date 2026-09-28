import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  matchesTopExpectation,
  phraseRecovered,
  validateLexicalQualityFixture
} from "../scripts/benchmark-lexical-quality.mjs";

const fixtureUrl = new URL("./fixtures/lexical-quality-v1.json", import.meta.url);

test("lexical quality corpus is broad, versioned and structurally valid", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.equal(validateLexicalQualityFixture(fixture), true);
  assert.ok(fixture.cases.length >= 50);

  const groups = new Set(fixture.cases.map((item) => item.group));
  for (const group of [
    "general", "polysemy", "technical", "entity",
    "normalization", "inflection", "phrase-context", "no-hit"
  ]) {
    assert.ok(groups.has(group), `missing benchmark group: ${group}`);
  }

  const ids = new Set(fixture.cases.map((item) => item.id));
  for (const required of [
    "ordinary-descendant",
    "inflection-configured",
    "inflection-children",
    "phrase-descendant-combinator",
    "phrase-runtime-environment",
    "nohit-project-token"
  ]) {
    assert.ok(ids.has(required), `missing benchmark case: ${required}`);
  }
});

test("top-sense expectations require every supplied evidence dimension", () => {
  const candidate = {
    kind: "lexical",
    headword: "branch",
    partOfSpeech: "noun",
    translations: ["分支"],
    typeLabels: []
  };
  assert.equal(matchesTopExpectation(candidate, {
    translationAny: ["分支"],
    partOfSpeechAny: ["noun"]
  }), true);
  assert.equal(matchesTopExpectation(candidate, {
    translationAny: ["分支"],
    partOfSpeechAny: ["verb"]
  }), false);
});

test("phrase recovery accepts attributable candidate aliases, not arbitrary context text", () => {
  const result = {
    lookup: {
      status: "candidates",
      query: { text: "runtime" }
    },
    decision: {
      candidates: [{
        headword: "run-time system",
        queryForm: "runtime environment",
        aliases: ["runtime system", "runtime environment"]
      }]
    }
  };
  assert.equal(phraseRecovered(result, "runtime environment"), true);
  assert.equal(phraseRecovered(result, "container image"), false);
});
