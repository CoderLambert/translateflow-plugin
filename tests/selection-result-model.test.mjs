import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

async function loadResultModel() {
  const code = await readFile(new URL("../src/content/selection/result-model.js", import.meta.url), "utf8");
  const context = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: { modules: { contentI18n: createContentI18nStub({ messages: {
    "content.selection.sourceLocal": "本地词典",
    "content.selection.sourceTechnical": "技术词条",
    "content.selection.sourcePack": "词典包 · {packId}",
    "content.selection.moreCandidates": "还有 {count} 个候选未展开",
    "content.selection.dictionaryDetails": "查看完整词典词条"
  } }) } } });
  vm.runInContext(code, context);
  return context.__TRANSLATE_FLOW_CONTENT__.modules.selectionResultModel;
}

function candidate(overrides = {}) {
  return {
    id: "core:persistent:1",
    kind: "lexical",
    headword: "persistent",
    pronunciation: "",
    partOfSpeech: "adjective",
    translations: ["持久的"],
    domains: [],
    typeLabels: [],
    provenance: { packId: "core", packVersion: "1" },
    ...overrides
  };
}

test("local result preserves ranked candidate boundaries instead of flattening alternatives", async () => {
  const model = await loadResultModel();
  const second = candidate({
    id: "core:persistent:2",
    partOfSpeech: "noun",
    translations: ["持续存在", "持久的", "持续存在"]
  });
  const first = candidate({
    id: "core:persistent:1",
    translations: ["持久的", "持续的", "持久的"]
  });

  const card = model.buildLocalResult({
    decision: {
      topCandidateId: first.id,
      candidates: [second, first]
    }
  });

  assert.equal(card.primaryMeaning, "持久的");
  assert.deepEqual([...card.senses], ["持续的"]);
  assert.deepEqual([...card.examples], []);
  assert.equal(card.dictionaryEntries.length, 2);
  assert.equal(card.dictionaryEntries[0].id, first.id);
  assert.equal(card.dictionaryEntries[0].primary, true);
  assert.deepEqual([...card.dictionaryEntries[0].translations], ["持久的", "持续的"]);
  assert.equal(card.dictionaryEntries[1].id, second.id);
  assert.equal(card.dictionaryEntries[1].primary, false);
  assert.deepEqual([...card.dictionaryEntries[1].translations], ["持续存在", "持久的"]);
  assert.equal(card.moreEntryCount, 0);

  const copied = model.copyTextForCard(card);
  assert.match(copied, /1\. adjective · 本地词典\n\s+持久的\n\s+持续的/);
  assert.match(copied, /2\. noun · 本地词典\n\s+持续存在\n\s+持久的/);
  assert.equal((copied.match(/持久的/g) || []).length, 2);
});

test("local result carries only examples supplied by the dictionary candidate", async () => {
  const model = await loadResultModel();
  const card = model.buildLocalResult({
    decision: {
      candidates: [candidate({ examples: ["A source-provided example."], example: "duplicate" })]
    }
  });

  assert.deepEqual([...card.examples], ["A source-provided example.", "duplicate"]);
  assert.deepEqual([...card.dictionaryEntries[0].examples], ["A source-provided example.", "duplicate"]);
});

test("structured result keeps technical identity and only supplied metadata", async () => {
  const model = await loadResultModel();
  const technical = candidate({
    id: "technical:Q1935361",
    kind: "technical-entity",
    headword: "tmux",
    partOfSpeech: null,
    translations: [],
    domains: ["developer-tool"],
    typeLabels: ["terminal multiplexer"],
    provenance: { packId: "technical-wikidata-en-zh", packVersion: "2026-09" }
  });

  const card = model.buildLocalResult({
    decision: { topCandidateId: technical.id, candidates: [technical] }
  });

  assert.equal(card.kind, "technical");
  assert.equal(card.headword, "tmux");
  assert.equal(card.pronunciation, "");
  assert.equal(card.partOfSpeech, "");
  assert.equal(card.primaryMeaning, "terminal multiplexer");
  assert.equal(card.dictionaryEntries[0].provenanceLabel, "技术词条");
  assert.deepEqual([...card.dictionaryEntries[0].domains], ["developer-tool"]);
  assert.deepEqual([...card.dictionaryEntries[0].typeLabels], ["terminal multiplexer"]);
});

test("Core and Technical candidates remain separate logical entries", async () => {
  const model = await loadResultModel();
  const core = candidate({
    id: "core:container:1",
    headword: "container",
    partOfSpeech: "noun",
    translations: ["容器"],
    domains: ["general"],
    provenance: { packId: "core-semantic", packVersion: "1" }
  });
  const technical = candidate({
    id: "technical:Q987767",
    kind: "technical-concept",
    headword: "container",
    partOfSpeech: null,
    translations: [],
    domains: ["software"],
    typeLabels: ["operating-system-level virtualization"],
    provenance: { packId: "technical-wikidata-en-zh", packVersion: "2026-09" }
  });

  const card = model.buildLocalResult({
    decision: {
      topCandidateId: technical.id,
      candidates: [technical, core]
    }
  });

  assert.equal(card.dictionaryEntries.length, 2);
  assert.equal(card.dictionaryEntries[0].kind, "technical-concept");
  assert.equal(card.dictionaryEntries[0].provenanceLabel, "技术词条");
  assert.deepEqual([...card.dictionaryEntries[0].typeLabels], ["operating-system-level virtualization"]);
  assert.equal(card.dictionaryEntries[1].kind, "lexical");
  assert.equal(card.dictionaryEntries[1].provenanceLabel, "本地词典");
  assert.deepEqual([...card.dictionaryEntries[1].translations], ["容器"]);
});

test("structured result bounds candidate display without changing ranked order", async () => {
  const model = await loadResultModel();
  const candidates = Array.from({ length: 7 }, (_, index) => candidate({
    id: `core:term:${index + 1}`,
    headword: index === 6 ? "alternate-term" : "term",
    partOfSpeech: index % 2 ? "noun" : "adjective",
    translations: [`释义 ${index + 1}`]
  }));

  const card = model.buildLocalResult({
    decision: {
      topCandidateId: candidates[6].id,
      candidates
    }
  });

  assert.equal(card.dictionaryEntries.length, 5);
  assert.equal(card.moreEntryCount, 2);
  assert.deepEqual(
    [...card.dictionaryEntries].map((entry) => entry.id),
    [candidates[6].id, candidates[0].id, candidates[1].id, candidates[2].id, candidates[3].id]
  );
  assert.match(model.copyTextForCard(card), /还有 2 个候选/);
});
