import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createOpfsTflexReader } from "../src/background/lexical/opfs-tflex-reader.js";
import { makeFreeDictFingerprintPayload } from "../scripts/build-tflex-freedict.mjs";
import { stableStringify } from "../scripts/build-tflex-core.mjs";
import { LEXICAL_ERROR_CODES } from "../src/shared/lexical.js";

function fixture({ corruptSlice = false } = {}) {
  const record = {
    lookupKey: "cache",
    exactLookupKeys: ["cache"],
    displayForm: "cache",
    kind: "lexical",
    aliases: ["caches"],
    senses: [{
      id: "freedict:1:1",
      partOfSpeech: "noun",
      translations: ["缓存"],
      domains: [],
      sourceRefs: [{ sourceId: "freedict-eng-zho", recordId: "entry:1:sense:1" }]
    }]
  };
  const entriesText = stableStringify(record) + "\n";
  const entriesBytes = bytes(entriesText);
  const target = {
    lookupKey: "cache",
    offset: 0,
    length: entriesBytes.byteLength,
    sha256: sha256(entriesBytes),
    matchedAlias: false
  };
  const index = {
    format: "tflex-index",
    formatVersion: 1,
    normalizationVersion: 1,
    recordCount: 1,
    entriesBytes: entriesBytes.byteLength,
    entries: [
      { key: "cache", exactLookupKeys: ["cache"], targets: [target] },
      { key: "caches", exactLookupKeys: ["caches"], targets: [{ ...target, matchedAlias: true }] }
    ]
  };
  const indexText = stableStringify(index) + "\n";
  const files = [
    descriptor("lookup-index", "index.dat", bytes(indexText)),
    descriptor("lexical-data", "entries.dat", entriesBytes),
    descriptor("notice", "THIRD_PARTY_NOTICES.txt", bytes("notice\n"))
  ].sort(compareFile);
  const sources = [{
    id: "freedict-eng-zho",
    version: "2025.11.23",
    provenance: "fixture FreeDict / WikDict",
    dataSha512: "a".repeat(128),
    teiSha256: "b".repeat(64),
    license: { id: "CC-BY-SA-3.0", name: "CC BY-SA 3.0", source: "fixture" }
  }];
  const fingerprint = "sha256:" + sha256(bytes(stableStringify(
    makeFreeDictFingerprintPayload({
      packId: "freedict-eng-zho",
      packVersion: "2025.11.23",
      sources,
      files
    })
  )));
  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    compilerVersion: 1,
    normalizationVersion: 1,
    packId: "freedict-eng-zho",
    packVersion: "2025.11.23",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    profile: "opfs-indexed-v1",
    fingerprint,
    recordCount: 1,
    sources,
    files
  };
  const manifestBytes = bytes(stableStringify(manifest) + "\n");
  const manifestDescriptor = descriptor("manifest", "manifest.json", manifestBytes);
  const snapshot = {
    packId: manifest.packId,
    packVersion: manifest.packVersion,
    fingerprint,
    files: [manifestDescriptor, ...files]
  };
  const data = new Map([
    ["manifest.json", manifestBytes],
    ["index.dat", bytes(indexText)],
    ["entries.dat", entriesBytes],
    ["THIRD_PARTY_NOTICES.txt", bytes("notice\n")]
  ]);
  let entriesFullReads = 0;
  let sliceReads = 0;
  const store = {
    async readFile(_packId, _version, path) {
      if (path === "entries.dat") entriesFullReads += 1;
      const value = data.get(path);
      if (!value) throw new Error("missing");
      return new Uint8Array(value);
    },
    async readFileSlice(_packId, _version, path, offset, length) {
      assert.equal(path, "entries.dat");
      sliceReads += 1;
      const source = data.get(path);
      const result = new Uint8Array(source.slice(offset, offset + length));
      if (corruptSlice) result[0] ^= 1;
      return result;
    }
  };
  return {
    reader: createOpfsTflexReader({ store, snapshot, cryptoProvider: webcrypto }),
    entriesFullReads: () => entriesFullReads,
    sliceReads: () => sliceReads
  };
}

test("indexed OPFS TFLex reader uses bounded record slices for exact and alias lookup", async () => {
  const env = fixture();
  const exact = await env.reader.lookup("cache");
  assert.equal(exact.record.senses[0].translations[0], "缓存");
  assert.equal(exact.matchedAlias, false);
  assert.equal(exact.exactCaseMatch, true);

  const alias = await env.reader.lookup("caches");
  assert.equal(alias.record.lookupKey, "cache");
  assert.equal(alias.matchedAlias, true);
  assert.equal(alias.aliasKey, "caches");
  assert.equal(env.entriesFullReads(), 0);
  assert.equal(env.sliceReads(), 2);
});

test("indexed OPFS TFLex reader fails closed on record-slice corruption", async () => {
  const env = fixture({ corruptSlice: true });
  await assert.rejects(
    env.reader.lookup("cache"),
    (error) => error?.code === LEXICAL_ERROR_CODES.CORRUPT && /slice hash mismatch/.test(error.message)
  );
});

function descriptor(role, path, value) {
  return { role, path, size: value.byteLength, sha256: sha256(value) };
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareFile(a, b) {
  return a.path.localeCompare(b.path) || a.role.localeCompare(b.role);
}
