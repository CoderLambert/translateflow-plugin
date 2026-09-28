import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPTIONAL_PACK_SOURCES } from "../src/shared/pack-sources.js";

const lock = JSON.parse(await readFile(
  new URL("../lexicon/source-locks/freedict-eng-zho.json", import.meta.url),
  "utf8"
));

test("FreeDict no-ship quality decision prevents production source registration", () => {
  assert.equal(lock.qualityDecision.status, "no-ship");
  assert.equal(lock.qualityDecision.approvedForProductDistribution, false);
  assert.equal(lock.qualityRole, "research-only-no-ship");
  assert.equal(
    OPTIONAL_PACK_SOURCES.some((source) =>
      source.packs?.some((pack) => pack.packId === lock.packId)
    ),
    false
  );
});

test("FreeDict legal approval does not imply product-distribution approval", () => {
  assert.equal(lock.license.approvedForOfficialPack, true);
  assert.equal(lock.license.id, "CC-BY-SA-3.0");
  assert.notEqual(lock.qualityDecision.approvedForProductDistribution, true);
});
