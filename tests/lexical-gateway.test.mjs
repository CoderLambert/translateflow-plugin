import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import {
  LEXICAL_RESULT_STATUS,
  normalizeLexicalLookupForm
} from "../src/shared/lexical.js";
import {
  conservativeMorphologyForms,
  createLexicalGateway
} from "../src/background/lexical/gateway.js";
import { createTflexReader } from "../src/background/lexical/tflex-reader.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/tflex-runtime-pack/", import.meta.url));

function coreReader() {
  return createTflexReader({
    packBasePath: "fixture",
    cryptoProvider: webcrypto,
    readBytes: async (path) => new Uint8Array(
      await readFile(join(fixtureRoot, path.replace(/^fixture\//, "")))
    )
  });
}


function normalizationReader() {
  const translations = new Map([
    ["persistent", ["持久的"]],
    ["developer", ["开发者"]],
    ["user", ["用户"]],
    ["run-time system", ["运行时系统"]],
    ["descendant combinator", ["后代组合器"]],
    ["node.js", ["Node.js"]],
    ["c++", ["C++"]],
    ["c#", ["C#"]],
    ["build", ["构建"]],
    ["write", ["写"]],
    ["good", ["好的"]],
    ["bad", ["坏的"]]
  ]);
  return {
    async lookup(text) {
      const key = String(text || "").toLowerCase();
      const values = translations.get(key);
      if (!values) return null;
      return {
        exactCaseMatch: String(text) === key,
        pack: {
          packId: "normalization-fixture",
          packVersion: "1",
          fingerprint: "sha256:normalization",
          sourceLanguage: "en",
          targetLanguage: "zh-CN"
        },
        record: {
          lookupKey: key,
          displayForm: text,
          kind: "lexical",
          aliases: [],
          senses: [{
            id: "fixture:" + key,
            partOfSpeech: "noun",
            senseNumber: 1,
            tagCount: 7,
            translations: values,
            sourceRefs: [{ sourceId: "fixture", recordId: key }]
          }],
          sourceRefs: [{ sourceId: "fixture", recordId: key }]
        }
      };
    }
  };
}

function technicalSessionReader() {
  return {
    async lookup(text) {
      if (String(text).toLowerCase() !== "session") return null;
      return {
        exactCaseMatch: true,
        pack: {
          packId: "technical-fixture",
          packVersion: "1",
          fingerprint: "sha256:technical",
          sourceLanguage: "en",
          targetLanguage: "zh-CN"
        },
        record: {
          lookupKey: "session",
          displayForm: "session",
          kind: "technical-concept",
          aliases: [],
          entityId: "fixture:session",
          translations: ["会话（计算机）"],
          typeLabels: ["computing concept"],
          sourceRefs: [{ sourceId: "technical-fixture", recordId: "session" }]
        }
      };
    },
    stats() {
      return { cache: { entries: 0, bytes: 0, maxEntries: 0, maxBytes: 0 } };
    }
  };
}

test("Lexical Gateway returns separate attributable senses and aggregates non-user sources", async () => {
  const gateway = createLexicalGateway({
    packReaders: [coreReader(), technicalSessionReader()]
  });
  const persistent = await gateway.lookup({ text: "persistent" });
  assert.equal(persistent.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(persistent.candidates.length, 2);
  assert.notEqual(persistent.candidates[0].senseId, persistent.candidates[1].senseId);
  assert.ok(persistent.candidates.every((candidate) => candidate.provenance.packId));

  const session = await gateway.lookup({ text: "session" });
  assert.equal(session.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.deepEqual(
    session.candidates.map((candidate) => candidate.provenance.packId),
    ["core-semantic-en-zh-runtime-fixture", "technical-fixture"]
  );
});

test("Lexical Gateway preserves optional source-locked sense priors", async () => {
  const gateway = createLexicalGateway({ packReaders: [normalizationReader()] });
  const result = await gateway.lookup({ text: "persistent" });
  assert.equal(result.candidates[0].senseNumber, 1);
  assert.equal(result.candidates[0].tagCount, 7);
});

test("Lexical Gateway preserves source-provided Technical sense metadata without flattening provenance", async () => {
  const reader = {
    async lookupAll() {
      return [{
        pack: { packId: "technical", packVersion: "1", fingerprint: "sha256:technical" },
        record: {
          lookupKey: "session",
          displayForm: "session",
          kind: "technical-concept",
          aliases: [],
          senses: [{
            id: "source-fixture:session.computing",
            translations: ["会话"],
            domains: ["protocol", "terminal"],
            typeLabels: ["computing session"],
            sourceRefs: [{ sourceId: "technical-source-fixture", recordId: "session.computing" }]
          }]
        },
        exactCaseMatch: true
      }];
    }
  };
  const result = await createLexicalGateway({ packReaders: [reader] }).lookup({ text: "session" });
  assert.deepEqual(result.candidates[0].typeLabels, ["computing session"]);
  assert.deepEqual(result.candidates[0].provenance.sourceRefs, [{
    sourceId: "technical-source-fixture",
    recordId: "session.computing"
  }]);
});

test("exact phrase wins while phrase misses expose evidence without token concatenation", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });
  const exact = await gateway.lookup({ text: "terminal multiplexer" });
  assert.equal(exact.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(exact.matchedBy, "exact");
  assert.deepEqual(exact.candidates[0].translations, ["终端复用器"]);

  const miss = await gateway.lookup({ text: "persistent session" });
  assert.equal(miss.status, LEXICAL_RESULT_STATUS.NO_HIT);
  assert.equal("candidates" in miss, false);
  assert.deepEqual(miss.evidence.map((item) => item.token), ["persistent", "session"]);
  assert.ok(miss.evidence.every((item) => item.candidates.length > 0));
});

test("CSS descendant selection resolves the exact local context phrase before word ranking", async () => {
  const gateway = createLexicalGateway({ packReaders: [normalizationReader()] });
  const result = await gateway.lookup({
    text: "descendant",
    contextText: "The nested rule will by default be related to the outer rule as a descendant combinator."
  });

  assert.equal(result.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(result.matchedBy, "context-phrase");
  assert.equal(result.resolvedForm, "descendant combinator");
  assert.equal(result.contextPhrase.provenance, "bounded-contiguous-context");
  assert.deepEqual(result.candidates[0].translations, ["后代组合器"]);
});

test("alias lookup returns one or many attributable candidates instead of choosing a winner", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });

  const single = await gateway.lookup({ text: "term mux" });
  assert.equal(single.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(single.matchedBy, "alias");
  assert.equal(single.candidates.length, 1);
  assert.equal(single.candidates[0].matchedBy, "alias");
  assert.equal(single.candidates[0].headword, "terminal multiplexer");

  const ambiguous = await gateway.lookup({ text: "stateful" });
  assert.equal(ambiguous.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(ambiguous.matchedBy, "alias");
  assert.deepEqual(
    [...new Set(ambiguous.candidates.map((candidate) => candidate.headword))],
    ["persistent", "session"]
  );
  assert.equal(ambiguous.candidates.length, 3);
  assert.ok(ambiguous.candidates.every((candidate) => candidate.matchedBy === "alias"));
});

test("glossary override short-circuits local pack candidates", async () => {
  let packCalls = 0;
  const reader = {
    async lookup() {
      packCalls += 1;
      return null;
    }
  };
  const gateway = createLexicalGateway({
    packReaders: [reader],
    resolveGlossary: async () => [{
      id: "persistent-override",
      source: "persistent",
      target: "持久连接",
      caseSensitive: false,
      enabled: true
    }]
  });
  const result = await gateway.lookup({ text: "Persistent", pageUrl: "https://example.test/" });
  assert.equal(result.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(result.override, true);
  assert.deepEqual(result.candidates[0].translations, ["持久连接"]);
  assert.equal(packCalls, 0);
});

test("Lexical Gateway has no Provider/network dependency", async () => {
  const source = await readFile(new URL("../src/background/lexical/gateway.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /providers\/|runTranslationRequest|\bfetch\s*\(/);
});

test("gateway uses generic morphology without a hand-authored irregular vocabulary", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });

  const went = await gateway.lookup({ text: "went" });
  assert.equal(went.status, LEXICAL_RESULT_STATUS.NO_HIT);

  const running = await gateway.lookup({ text: "running" });
  assert.equal(running.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(running.matchedBy, "morphology");
  assert.equal(running.resolvedForm, "run");
  assert.ok(conservativeMorphologyForms("running").includes("run"));
  assert.deepEqual(conservativeMorphologyForms("uses"), ["use"]);

  const source = await readFile(
    new URL("../src/background/lexical/gateway.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /DEFAULT_IRREGULAR_LEMMAS|irregularLemmas|explicitLemmaForms/);
});


test("safe lexical normalization recovers copied prose artifacts without rewriting code-like tokens", () => {
  const recovered = new Map([
    ["persistent,", "persistent"],
    ["persistent.", "persistent"],
    ["persistent:", "persistent"],
    ["session)", "session"],
    ["“persistent”", "persistent"],
    ["developer’s", "developer's"],
    ["per\u00adsistent", "persistent"],
    ["run‑time system", "run-time system"]
  ]);
  for (const [input, expected] of recovered) {
    assert.equal(normalizeLexicalLookupForm(input), expected, input);
  }

  for (const value of ["Node.js", "C++", "C#", "foo.bar()", "alpha::beta"]) {
    assert.equal(normalizeLexicalLookupForm(value), value, value);
  }
});

test("normalized lookup keeps explicit provenance and remains conservative for code identifiers", async () => {
  const gateway = createLexicalGateway({ packReaders: [normalizationReader()] });

  for (const [input, expected] of [
    ["persistent,", "persistent"],
    ["“persistent”", "persistent"],
    ["per\u00adsistent", "persistent"],
    ["run‑time system", "run-time system"]
  ]) {
    const result = await gateway.lookup({ text: input });
    assert.equal(result.status, LEXICAL_RESULT_STATUS.CANDIDATES, input);
    assert.equal(result.matchedBy, "normalized", input);
    assert.equal(result.resolvedForm, expected, input);
    assert.equal(result.normalizedForm, expected, input);
    assert.ok(result.candidates.every((candidate) => candidate.matchedBy === "normalized"), input);
  }

  for (const possessive of ["developer’s", "users'"]) {
    const result = await gateway.lookup({ text: possessive });
    assert.equal(result.status, LEXICAL_RESULT_STATUS.NO_HIT, possessive);
  }
  assert.deepEqual(conservativeMorphologyForms("developer's"), []);
  assert.deepEqual(conservativeMorphologyForms("users'"), []);

  for (const exact of ["Node.js", "C++", "C#"]) {
    const result = await gateway.lookup({ text: exact });
    assert.equal(result.status, LEXICAL_RESULT_STATUS.CANDIDATES);
    assert.equal(result.matchedBy, "exact");
  }

  for (const unsafe of ["foo.bar()", "alpha::beta"]) {
    const result = await gateway.lookup({ text: unsafe });
    assert.equal(result.status, LEXICAL_RESULT_STATUS.NO_HIT, unsafe);
  }
});

test("irregular forms remain source gaps until an attributable morphology source provides them", async () => {
  const gateway = createLexicalGateway({ packReaders: [normalizationReader()] });
  for (const input of ["built", "written", "better", "best", "worse", "worst"]) {
    const result = await gateway.lookup({ text: input });
    assert.equal(result.status, LEXICAL_RESULT_STATUS.NO_HIT, input);
  }

  assert.ok(conservativeMorphologyForms("configured").includes("configure"));
  assert.ok(conservativeMorphologyForms("dependencies").includes("dependency"));
  assert.ok(conservativeMorphologyForms("repositories").includes("repository"));
});

test("unsupported and no-hit are distinct typed outcomes", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });
  const unsupported = await gateway.lookup({
    text: "persistent",
    sourceLanguage: "ja",
    targetLanguage: "zh-CN"
  });
  assert.equal(unsupported.status, LEXICAL_RESULT_STATUS.UNSUPPORTED);

  const miss = await gateway.lookup({ text: "TFNoSuchLexeme" });
  assert.equal(miss.status, LEXICAL_RESULT_STATUS.NO_HIT);
});

test("typed reader corruption is returned as a lexical error result", async () => {
  const gateway = createLexicalGateway({
    packReaders: [{
      async lookup() {
        const error = new Error("bad shard");
        error.code = "LEXICON_CORRUPT";
        error.packId = "broken-pack";
        error.path = "shards/0001.jsonl";
        throw error;
      }
    }]
  });
  const result = await gateway.lookup({ text: "persistent" });
  assert.equal(result.status, LEXICAL_RESULT_STATUS.ERROR);
  assert.equal(result.error.code, "LEXICON_CORRUPT");
  assert.equal(result.error.packId, "broken-pack");
});
