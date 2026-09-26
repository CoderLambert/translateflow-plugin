import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { LEXICAL_RESULT_STATUS } from "../src/shared/lexical.js";
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

test("alias lookup returns one or many attributable candidates instead of choosing a winner", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });

  const single = await gateway.lookup({ text: "term mux" });
  assert.equal(single.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(single.matchedBy, "exact");
  assert.equal(single.candidates.length, 1);
  assert.equal(single.candidates[0].matchedBy, "alias");
  assert.equal(single.candidates[0].headword, "terminal multiplexer");

  const ambiguous = await gateway.lookup({ text: "stateful" });
  assert.equal(ambiguous.status, LEXICAL_RESULT_STATUS.CANDIDATES);
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

test("irregular lemma lookup precedes conservative suffix morphology", async () => {
  const gateway = createLexicalGateway({ packReaders: [coreReader()] });

  const went = await gateway.lookup({ text: "went" });
  assert.equal(went.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(went.matchedBy, "lemma");
  assert.equal(went.resolvedForm, "go");

  const running = await gateway.lookup({ text: "running" });
  assert.equal(running.status, LEXICAL_RESULT_STATUS.CANDIDATES);
  assert.equal(running.matchedBy, "morphology");
  assert.equal(running.resolvedForm, "run");
  assert.ok(conservativeMorphologyForms("running").includes("run"));
  assert.deepEqual(conservativeMorphologyForms("uses"), ["use"]);
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
