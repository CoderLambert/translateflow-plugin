import test from "node:test";
import assert from "node:assert/strict";

import {
  projectEcdictCuratedCsv
} from "../src/background/packs/importers/ecdict-csv.js";
import {
  fetchCuratedDictionarySource
} from "../src/background/providers/curated-dictionary-network.js";

const encoder = new TextEncoder();
const header =
  "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n";

function sourceFor(csv, overrides = {}) {
  return {
    trustClass: "curated-upstream",
    sourceFormat: "ECDICT CSV",
    downloadBytes: encoder.encode(csv).byteLength,
    selection: {
      maxRecords: 2,
      maxSourceBytes: 1024 * 1024,
      maxHeadwordChars: 120,
      maxTranslationChars: 16_384
    },
    output: {
      packId: "test-ecdict",
      sourceId: "ecdict",
      sourceVersion: "locked-test-revision"
    },
    ...overrides
  };
}

async function* chunksOf(csv, splitAt = 17) {
  const bytes = encoder.encode(csv);
  yield bytes.slice(0, splitAt);
  yield bytes.slice(splitAt);
}

test("ECDICT curated projection is deterministic and source-ranked rather than query-picked", async () => {
  const csv =
    header +
    "zeta,,,泽塔,,0,0,,900,900,,,\n" +
    "alpha,,,阿尔法,,4,0,,0,0,,,\n" +
    "beta,,,贝塔,,0,1,,0,0,,,\n";
  const source = sourceFor(csv);

  const first = await projectEcdictCuratedCsv({
    chunks: chunksOf(csv),
    source
  });
  const second = await projectEcdictCuratedCsv({
    chunks: chunksOf(csv, 31),
    source
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.records.map((record) => record.lookupKey),
    ["beta", "zeta"]
  );
  assert.equal(first.stats.sourceRows, 3);
  assert.equal(first.stats.retainedRecords, 2);
  assert.equal(
    first.records[0].senses[0].sourceRefs[0].sourceVersion,
    "locked-test-revision"
  );
});

test("ECDICT curated projection fails closed on byte identity mismatch", async () => {
  const csv = header + "hello,,,你好,,0,0,,1,1,,,\n";
  const source = sourceFor(csv, {
    downloadBytes: encoder.encode(csv).byteLength + 1
  });

  await assert.rejects(
    projectEcdictCuratedCsv({
      chunks: chunksOf(csv),
      source
    }),
    /source size mismatch/
  );
});

test("curated network provider rejects non-approved origins before fetch", async () => {
  await assert.rejects(
    fetchCuratedDictionarySource({
      downloadUrl: "https://example.com/ecdict.csv"
    }),
    /not an approved HTTPS upstream/
  );
});
