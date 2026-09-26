import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCorpus,
  buildEnglishLemmaIndex,
  normalizeEnglishLemma,
  parseOmwTab
} from "../scripts/audit-lexicon-sources.mjs";

test("OMW tab parser keeps senses distinct and preserves raw Chinese lexical forms", () => {
  const eng = [
    "# fixture",
    "00000001-a\tlemma\tpersistent",
    "00000001-a\tlemma\tlasting",
    "00000002-a\tlemma\tpersistent",
    "00000003-n\tlemma\tterminal_multiplexer"
  ].join("\n");
  const cmn = [
    "# fixture",
    "00000001-a\tcmn:lemma\t持久+的",
    "00000002-a\tcmn:lemma\t顽强+的",
    "00000003-n\tcmn:lemma\t终端复用器"
  ].join("\n");

  const english = parseOmwTab(eng, { lemmaRelation: "lemma" });
  const chinese = parseOmwTab(cmn, { lemmaRelation: "cmn:lemma" });
  const index = buildEnglishLemmaIndex(english);

  assert.deepEqual(index.get("persistent"), ["00000001-a", "00000002-a"]);
  assert.deepEqual(index.get("terminal multiplexer"), ["00000003-n"]);
  assert.deepEqual(chinese.get("00000001-a"), ["持久+的"]);
  assert.equal(normalizeEnglishLemma("  Terminal_Multiplexer "), "terminal multiplexer");
});

test("source audit reports WordNet and Chinese mapping coverage separately", () => {
  const report = auditCorpus({
    englishTab: [
      "00000001-a\tlemma\tpersistent",
      "00000002-n\tlemma\tcontainer",
      "00000003-n\tlemma\tcontainer"
    ].join("\n"),
    chineseTab: [
      "00000001-a\tcmn:lemma\t持久+的",
      "00000002-n\tcmn:lemma\t集装箱"
    ].join("\n"),
    corpus: {
      cases: [
        { id: "a", term: "persistent", category: "ordinary" },
        { id: "b", term: "container", category: "technical" },
        { id: "c", term: "tmux", category: "entity" }
      ]
    }
  });

  assert.deepEqual(report.groups.ordinary, {
    cases: 1,
    wordnetTermHits: 1,
    chineseMappedTerms: 1,
    wordnetSynsets: 1,
    chineseMappedSynsets: 1
  });
  assert.equal(report.cases.find((item) => item.term === "container").coverage, "partial");
  assert.equal(report.cases.find((item) => item.term === "tmux").coverage, "wordnet-miss");
});
