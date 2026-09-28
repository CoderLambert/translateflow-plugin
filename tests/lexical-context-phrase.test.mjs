import test from "node:test";
import assert from "node:assert/strict";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { extractContextPhraseCandidates } from "../src/background/lexical/context-phrase.js";

const REQUIRED_PHRASES = [
  ["descendant", "The rule is related as a descendant combinator.", "descendant combinator"],
  ["terminal", "tmux is a terminal multiplexer for sessions.", "terminal multiplexer"],
  ["dependency", "The framework supports dependency injection for services.", "dependency injection"],
  ["event", "The JavaScript event loop schedules callbacks.", "event loop"],
  ["garbage", "Automatic garbage collection reclaims memory.", "garbage collection"],
  ["runtime", "The runtime environment executes the application.", "runtime environment"],
  ["container", "Build the container image before deployment.", "container image"],
  ["state", "The library provides state management for components.", "state management"]
];

function lexicalRecord(displayForm, translations, {
  kind = "lexical",
  aliases = [],
  domains = [],
  typeLabels = [],
  matchedAlias = false
} = {}) {
  const key = displayForm.toLowerCase();
  return {
    matchedAlias,
    exactCaseMatch: true,
    pack: {
      packId: kind === "lexical" ? "core-fixture" : "technical-fixture",
      packVersion: "1",
      fingerprint: "sha256:fixture",
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    },
    record: kind === "lexical"
      ? {
          lookupKey: key,
          displayForm,
          kind,
          aliases,
          senses: [{
            id: "fixture:" + key,
            partOfSpeech: "noun",
            translations,
            domains,
            sourceRefs: [{ sourceId: "fixture", recordId: key }]
          }],
          sourceRefs: [{ sourceId: "fixture", recordId: key }]
        }
      : {
          lookupKey: key,
          displayForm,
          kind,
          aliases,
          entityId: "fixture:" + key,
          translations,
          domains,
          typeLabels,
          sourceRefs: [{ sourceId: "fixture", recordId: key }]
        }
  };
}

function phraseReader() {
  const exact = new Map([
    ["descendant", lexicalRecord("descendant", ["下降的"])],
    ["descendant combinator", lexicalRecord("descendant combinator", ["后代组合器"], {
      kind: "technical-concept",
      domains: ["css"],
      typeLabels: ["CSS combinator"]
    })],
    ["terminal multiplexer", lexicalRecord("terminal multiplexer", ["终端复用器"], {
      kind: "technical-concept",
      domains: ["terminal"]
    })],
    ["dependency injection", lexicalRecord("dependency injection", ["依赖注入"], {
      kind: "technical-concept",
      domains: ["software"]
    })],
    ["event loop", lexicalRecord("event loop", ["事件循环"], {
      kind: "technical-concept",
      domains: ["javascript"]
    })],
    ["garbage collection", lexicalRecord("garbage collection", ["垃圾回收"], {
      kind: "technical-concept",
      domains: ["runtime"]
    })],
    ["container image", lexicalRecord("container image", ["容器镜像"], {
      kind: "technical-concept",
      domains: ["container"]
    })],
    ["state management", lexicalRecord("state management", ["状态管理"], {
      kind: "technical-concept",
      domains: ["software"]
    })],
    ["state", lexicalRecord("state", ["国家", "状态"])]
  ]);

  return {
    async lookup(text) {
      const key = String(text || "").toLowerCase();
      if (key === "runtime environment") {
        return lexicalRecord("run-time system", [], {
          kind: "technical-concept",
          aliases: ["runtime environment", "runtime system"],
          domains: ["runtime"],
          typeLabels: ["computing platform"],
          matchedAlias: true
        });
      }
      return exact.get(key) || null;
    }
  };
}

test("bounded phrase extraction covers required 2-token technical phrases without uncontrolled concatenation", () => {
  for (const [selectionText, contextText, expectedPhrase] of REQUIRED_PHRASES) {
    const candidates = extractContextPhraseCandidates({ selectionText, contextText });
    assert.ok(candidates.some((candidate) => candidate.text.toLowerCase() === expectedPhrase), expectedPhrase);
    assert.ok(candidates.every((candidate) => candidate.tokenCount >= 2 && candidate.tokenCount <= 4));
    assert.ok(candidates.length <= 9);
  }
});

test("phrase extraction refuses ambiguous repeated selected-token occurrences", () => {
  const candidates = extractContextPhraseCandidates({
    selectionText: "state",
    contextText: "The state manager reads state changes."
  });
  assert.deepEqual(candidates, []);
});

test("local context phrase exact hit outranks an isolated wrong single-word sense", async () => {
  const gateway = createLexicalGateway({ packReaders: [phraseReader()] });
  const result = await gateway.lookup({
    text: "descendant",
    contextText: "The nested rule is related to the outer rule as a descendant combinator."
  });

  assert.equal(result.status, "candidates");
  assert.equal(result.matchedBy, "context-phrase");
  assert.equal(result.resolvedForm, "descendant combinator");
  assert.equal(result.matchedPhrase, "descendant combinator");
  assert.equal(result.contextPhrase.confidence, "high");
  assert.equal(result.contextPhrase.provenance, "bounded-contiguous-context");
  assert.equal(result.contextPhrase.matchedBy, "exact");
  assert.equal(result.contextPhrase.tokenCount, 2);
  assert.deepEqual(result.candidates[0].translations, ["后代组合器"]);
  assert.equal(result.candidates[0].headword, "descendant combinator");
});

test("context phrase can resolve an attributable local alias", async () => {
  const gateway = createLexicalGateway({ packReaders: [phraseReader()] });
  const result = await gateway.lookup({
    text: "runtime",
    contextText: "The runtime environment executes the application."
  });

  assert.equal(result.status, "candidates");
  assert.equal(result.matchedBy, "context-phrase");
  assert.equal(result.matchedPhrase, "runtime environment");
  assert.equal(result.contextPhrase.matchedBy, "alias");
  assert.equal(result.candidates[0].headword, "run-time system");
  assert.equal(result.candidates[0].matchedBy, "alias");
});

test("explicitly selected full phrase remains authoritative before context expansion", async () => {
  const gateway = createLexicalGateway({ packReaders: [phraseReader()] });
  const result = await gateway.lookup({
    text: "descendant combinator",
    contextText: "A descendant combinator is used here."
  });

  assert.equal(result.status, "candidates");
  assert.equal(result.matchedBy, "exact");
  assert.equal(result.resolvedForm, "descendant combinator");
  assert.equal("contextPhrase" in result, false);
});

test("no trusted phrase hit falls back to the selected single-word exact result", async () => {
  const gateway = createLexicalGateway({ packReaders: [phraseReader()] });
  const result = await gateway.lookup({
    text: "state",
    contextText: "The state manager stores application data."
  });

  assert.equal(result.status, "candidates");
  assert.equal(result.matchedBy, "exact");
  assert.equal(result.resolvedForm, "state");
  assert.equal("contextPhrase" in result, false);
});

test("repeated selected token disables phrase guessing and preserves exact fallback", async () => {
  const gateway = createLexicalGateway({ packReaders: [phraseReader()] });
  const result = await gateway.lookup({
    text: "state",
    contextText: "The state manager observes state changes."
  });

  assert.equal(result.status, "candidates");
  assert.equal(result.matchedBy, "exact");
  assert.equal(result.resolvedForm, "state");
});
