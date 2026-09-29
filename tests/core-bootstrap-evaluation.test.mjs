import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_TAG_COUNT_THRESHOLDS,
  deriveCommonWordSample,
  filterCoreRecordsByMinTagCount,
  projectCorePack,
  recordMaxTagCount,
  tokenizeOrdinaryBrowsingSample
} from "../scripts/evaluate-core-bootstrap.mjs";

function record(lookupKey, tagCounts) {
  return {
    lookupKey,
    exactLookupKeys: [lookupKey],
    displayForm: lookupKey,
    kind: "lexical",
    aliases: [],
    sourceForms: [lookupKey],
    senses: tagCounts.map((tagCount, index) => ({
      id: "pwn3:" + String(index + 1).padStart(8, "0") + "-n",
      partOfSpeech: "noun",
      translations: ["译" + index],
      rawTranslations: ["译" + index],
      senseNumber: index + 1,
      tagCount,
      sourceRefs: [
        { sourceId: "pwn-3.0", recordId: String(index + 1).padStart(8, "0") + "-n" },
        { sourceId: "chinese-open-wordnet", recordId: String(index + 1).padStart(8, "0") + "-n" }
      ]
    })),
    sourceRefs: [{ sourceId: "pwn-3.0", recordId: "00000001-n" }]
  };
}

function manifest() {
  return {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    compilerVersion: 1,
    normalizationVersion: 1,
    packId: "core-semantic-en-zh",
    packVersion: "fixture",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    profile: "bundled-sharded-v1",
    profileOptions: { maxShardBytes: 1500 },
    fingerprint: "sha256:" + "0".repeat(64),
    recordCount: 3,
    sources: [
      {
        id: "chinese-open-wordnet",
        version: "fixture",
        provenance: "fixture",
        dataSha256: "a".repeat(64),
        dataUrl: "fixture://cmn",
        license: { id: "fixture", name: "Fixture", source: "fixture://license" }
      },
      {
        id: "pwn-3.0",
        version: "fixture",
        provenance: "fixture",
        dataSha256: "b".repeat(64),
        dataUrl: "fixture://eng",
        license: { id: "fixture", name: "Fixture", source: "fixture://license" }
      },
      {
        id: "pwn-3.0-sense-index",
        version: "fixture",
        provenance: "fixture",
        dataSha256: "c".repeat(64),
        dataUrl: "fixture://sense",
        providesFields: ["senseNumber", "tagCount"],
        license: { id: "fixture", name: "Fixture", source: "fixture://license" }
      }
    ],
    files: [
      {
        role: "license-notice",
        path: "THIRD_PARTY_NOTICES.txt",
        size: 64,
        sha256: "d".repeat(64)
      }
    ]
  };
}

test("bootstrap policy is numeric source evidence, not a headword allowlist", () => {
  assert.deepEqual(BOOTSTRAP_TAG_COUNT_THRESHOLDS, [1, 2, 5, 10]);

  const records = [
    record("alpha", [0, 0]),
    record("beta", [1]),
    record("gamma", [2, 7]),
    {
      ...record("delta", [0]),
      senses: [{ ...record("delta", [0]).senses[0], tagCount: undefined }]
    }
  ];

  assert.equal(recordMaxTagCount(records[0]), 0);
  assert.equal(recordMaxTagCount(records[2]), 7);
  assert.equal(recordMaxTagCount(records[3]), -1);
  assert.deepEqual(
    filterCoreRecordsByMinTagCount(records, 1).map((item) => item.lookupKey),
    ["beta", "gamma"]
  );
  assert.deepEqual(
    filterCoreRecordsByMinTagCount(records, 5).map((item) => item.lookupKey),
    ["gamma"]
  );
});

test("bootstrap filtering preserves every mapped sense of a retained headword", () => {
  const polysemous = record("state", [0, 6, 0]);
  const [retained] = filterCoreRecordsByMinTagCount([polysemous], 5);
  assert.equal(retained, polysemous);
  assert.equal(retained.senses.length, 3);
});

test("projected Core pack size is deterministic and shrinks with source-derived filtering", () => {
  const records = [
    record("alpha", [0]),
    record("beta", [1]),
    record("gamma", [7])
  ];
  const full = projectCorePack({ manifest: manifest(), records });
  const tagged = projectCorePack({
    manifest: manifest(),
    records: filterCoreRecordsByMinTagCount(records, 1)
  });
  const taggedAgain = projectCorePack({
    manifest: manifest(),
    records: filterCoreRecordsByMinTagCount(records, 1)
  });

  assert.deepEqual(tagged, taggedAgain);
  assert.equal(full.manifest.recordCount, 3);
  assert.equal(tagged.manifest.recordCount, 2);
  assert.ok(tagged.totalBytes < full.totalBytes);
  assert.ok(tagged.lexicalDataBytes < full.lexicalDataBytes);
  assert.ok(tagged.shards.every((shard) => shard.size <= 1500));
  assert.equal(tagged.manifest.packId, "core-semantic-en-zh");
  assert.deepEqual(tagged.manifest.sources, manifest().sources);
  assert.match(tagged.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("bootstrap threshold validation rejects zero or non-integer gates", () => {
  const records = [record("alpha", [1])];
  assert.throws(() => filterCoreRecordsByMinTagCount(records, 0), /positive integer/);
  assert.throws(() => filterCoreRecordsByMinTagCount(records, 1.5), /positive integer/);
});


test("common-word sample is derived from locked source frequency rather than benchmark membership", () => {
  const senseIndex = [
    "common%1:00:00:: 00000001 1 12",
    "common%2:00:00:: 00000002 2 3",
    "alpha%1:00:00:: 00000003 1 7",
    "beta%1:00:00:: 00000004 1 2",
    "multi_word%1:00:00:: 00000005 1 100",
    "zero%1:00:00:: 00000006 1 0"
  ].join("\n");

  assert.deepEqual(deriveCommonWordSample(senseIndex, 3), ["common", "alpha", "beta"]);
  assert.throws(() => deriveCommonWordSample(senseIndex, 4), /smaller than requested limit/);
});

test("ordinary browsing sample tokenization is deterministic and validation-only", () => {
  const fixture = {
    schemaVersion: 1,
    source: "fixture",
    purpose: "validation only",
    paragraphs: [
      "Reliable systems keep working during ordinary browsing.",
      "Working systems should recover after temporary failures.",
      "Users read documentation before changing configuration."
    ]
  };
  assert.deepEqual(tokenizeOrdinaryBrowsingSample(fixture), [
    "after",
    "before",
    "browsing",
    "changing",
    "configuration",
    "documentation",
    "during",
    "failures",
    "keep",
    "ordinary",
    "read",
    "recover",
    "reliable",
    "should",
    "systems",
    "temporary",
    "users",
    "working"
  ]);
});
