import test from "node:test";
import assert from "node:assert/strict";
import { createActiveOpfsPackReader } from "../src/background/lexical/active-opfs-reader.js";
import { createLexicalGateway } from "../src/background/lexical/gateway.js";
import { LEXICAL_ERROR_CODES } from "../src/shared/lexical.js";

test("active OPFS reader follows healthy active state without worker restart", async () => {
  let state = packState({
    alpha: activeEntry("alpha", "v1", "a")
  });
  const created = [];
  const reader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory({ snapshot }) {
      created.push(snapshotKey(snapshot));
      return fixtureReader(snapshot, {
        alpha: { v1: "甲-v1", v2: "甲-v2" }
      });
    },
    cryptoProvider: fakeCrypto()
  });

  let hits = await reader.lookupAll("alpha");
  assert.deepEqual(hits.map((hit) => hit.record.senses[0].translations[0]), ["甲-v1"]);
  assert.deepEqual(created, ["alpha@v1@sha256:a"]);

  state = packState({
    alpha: activeEntry("alpha", "v2", "b")
  });
  hits = await reader.lookupAll("alpha");
  assert.deepEqual(hits.map((hit) => hit.record.senses[0].translations[0]), ["甲-v2"]);
  assert.deepEqual(created, [
    "alpha@v1@sha256:a",
    "alpha@v2@sha256:b"
  ]);
  assert.equal(reader.stats().readerCount, 1, "stale active-version reader should be pruned");
});

test("active OPFS reader uses deterministic packId order and ignores non-healthy entries", async () => {
  const state = packState({
    zeta: activeEntry("zeta", "v1", "z"),
    ignored: { ...activeEntry("ignored", "v1", "i"), status: "needs-reinstall" },
    alpha: activeEntry("alpha", "v1", "a")
  });
  const reader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory({ snapshot }) {
      return fixtureReader(snapshot, {
        alpha: { v1: "甲" },
        zeta: { v1: "泽塔" },
        ignored: { v1: "不应出现" }
      });
    },
    cryptoProvider: fakeCrypto()
  });

  const hits = await reader.lookupAll("word");
  assert.deepEqual(hits.map((hit) => hit.pack.packId), ["alpha", "zeta"]);
  assert.deepEqual(
    hits.map((hit) => hit.record.senses[0].translations[0]),
    ["甲", "泽塔"]
  );
});

test("corrupt optional pack is isolated and cannot suppress bundled lexical candidates", async () => {
  const state = packState({
    broken: activeEntry("broken", "v1", "b"),
    healthy: activeEntry("healthy", "v1", "h")
  });
  const optionalReader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory({ snapshot }) {
      if (snapshot.packId === "broken") {
        return {
          async lookupAll() {
            const error = new Error("corrupt optional fixture");
            error.code = LEXICAL_ERROR_CODES.CORRUPT;
            error.packId = "broken";
            error.path = "entries.dat";
            throw error;
          },
          stats() {
            return {};
          }
        };
      }
      return fixtureReader(snapshot, {
        healthy: { v1: "可选词典" }
      });
    },
    cryptoProvider: fakeCrypto()
  });

  const bundledReader = fixtureReader(
    snapshot("core", "bundled", "core"),
    { core: { bundled: "内置词典" } }
  );
  const gateway = createLexicalGateway({
    packReaders: [bundledReader, optionalReader]
  });

  const result = await gateway.lookup({
    text: "word",
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  });
  assert.equal(result.status, "candidates");
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.translations[0]),
    ["内置词典", "可选词典"]
  );
  assert.deepEqual(
    optionalReader.stats().errors.map((item) => [item.packId, item.code]),
    [["broken", LEXICAL_ERROR_CODES.CORRUPT]]
  );
});

test("healthy state with malformed active snapshot is isolated and diagnosed as corrupt", async () => {
  const state = packState({
    malformed: {
      sourceId: "fixture-source",
      status: "healthy",
      active: {
        packId: "different-pack",
        packVersion: "v1",
        fingerprint: "sha256:x",
        files: []
      },
      fallback: null
    }
  });
  const reader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory() {
      throw new Error("malformed snapshot must not reach reader factory");
    },
    cryptoProvider: fakeCrypto()
  });

  assert.deepEqual(await reader.lookupAll("word"), []);
  assert.deepEqual(
    reader.stats().errors.map((item) => [item.packId, item.code]),
    [["malformed", LEXICAL_ERROR_CODES.CORRUPT]]
  );
});

test("optional state-store failure degrades to bundled-only lookup instead of lexical ERROR", async () => {
  const optionalReader = createActiveOpfsPackReader({
    stateStore: {
      async read() {
        throw new Error("chrome.storage fixture unavailable");
      }
    },
    store: fakeStore(),
    readerFactory() {
      throw new Error("reader factory must not run");
    },
    cryptoProvider: fakeCrypto()
  });
  const bundledReader = fixtureReader(
    snapshot("core", "bundled", "core"),
    { core: { bundled: "内置词典" } }
  );
  const gateway = createLexicalGateway({
    packReaders: [bundledReader, optionalReader]
  });

  const result = await gateway.lookup({
    text: "word",
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  });
  assert.equal(result.status, "candidates");
  assert.deepEqual(result.candidates.map((candidate) => candidate.translations[0]), ["内置词典"]);
  assert.equal(optionalReader.stats().stateError.code, LEXICAL_ERROR_CODES.STORAGE);
});

test("unexpected optional reader bugs are not silently swallowed", async () => {
  const state = packState({
    broken: activeEntry("broken", "v1", "b")
  });
  const reader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory() {
      return {
        async lookupAll() {
          throw new TypeError("fixture programmer error");
        }
      };
    },
    cryptoProvider: fakeCrypto()
  });

  await assert.rejects(
    reader.lookupAll("word"),
    /fixture programmer error/
  );
});

test("removing an active pack clears its cached reader and diagnostic state", async () => {
  let state = packState({
    broken: activeEntry("broken", "v1", "b")
  });
  const reader = createActiveOpfsPackReader({
    stateStore: memoryStateStore(() => state),
    store: fakeStore(),
    readerFactory() {
      return {
        async lookupAll() {
          const error = new Error("missing");
          error.code = LEXICAL_ERROR_CODES.STORAGE;
          throw error;
        },
        clearCache() {},
        stats() {
          return {};
        }
      };
    },
    cryptoProvider: fakeCrypto()
  });

  await reader.lookupAll("word");
  assert.equal(reader.stats().readerCount, 1);
  assert.equal(reader.stats().errors.length, 1);

  state = packState({});
  assert.deepEqual(await reader.lookupAll("word"), []);
  assert.equal(reader.stats().readerCount, 0);
  assert.equal(reader.stats().errors.length, 0);
});

function fixtureReader(packSnapshot, translations) {
  return {
    async lookupAll() {
      const translation = translations?.[packSnapshot.packId]?.[packSnapshot.packVersion];
      if (!translation) return [];
      return [{
        record: {
          lookupKey: "word",
          exactLookupKeys: ["word"],
          displayForm: "word",
          kind: "lexical",
          aliases: [],
          senses: [{
            id: "sense:1",
            translations: [translation],
            domains: [],
            sourceRefs: [{
              sourceId: "fixture-" + packSnapshot.packId,
              recordId: "1"
            }]
          }]
        },
        exactCaseMatch: true,
        matchedAlias: false,
        aliasKey: "",
        pack: {
          packId: packSnapshot.packId,
          packVersion: packSnapshot.packVersion,
          fingerprint: packSnapshot.fingerprint,
          sourceLanguage: "en",
          targetLanguage: "zh-CN"
        }
      }];
    },
    async lookup(text) {
      return (await this.lookupAll(text))[0] || null;
    },
    async inspect() {
      return {
        packId: packSnapshot.packId,
        packVersion: packSnapshot.packVersion,
        fingerprint: packSnapshot.fingerprint,
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
        recordCount: 1,
        sources: []
      };
    },
    clearCache() {},
    stats() {
      return { fixture: true };
    }
  };
}

function activeEntry(packId, packVersion, fingerprintSuffix) {
  return {
    sourceId: "fixture-source",
    status: "healthy",
    active: snapshot(packId, packVersion, fingerprintSuffix),
    fallback: null,
    recoveryReason: null,
    lastError: null
  };
}

function snapshot(packId, packVersion, fingerprintSuffix) {
  return {
    packId,
    packVersion,
    fingerprint: "sha256:" + fingerprintSuffix,
    totalBytes: 3,
    files: [
      { role: "manifest", path: "manifest.json", size: 1, sha256: "a".repeat(64) },
      { role: "lookup-index", path: "index.dat", size: 1, sha256: "b".repeat(64) },
      { role: "lexical-data", path: "entries.dat", size: 1, sha256: "c".repeat(64) }
    ]
  };
}

function snapshotKey(value) {
  return [value.packId, value.packVersion, value.fingerprint].join("@");
}

function packState(packs) {
  return {
    version: 1,
    catalogSequences: {},
    packs
  };
}

function memoryStateStore(read) {
  return {
    async read() {
      return structuredClone(read());
    }
  };
}

function fakeStore() {
  return {
    async readFile() {
      return new Uint8Array();
    },
    async readFileRange() {
      return new Uint8Array();
    }
  };
}

function fakeCrypto() {
  return {
    subtle: {}
  };
}
