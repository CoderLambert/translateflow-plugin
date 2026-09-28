import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(
  new URL("../lexicon/source-locks/freedict-eng-zho.json", import.meta.url),
  "utf8"
));

test("FreeDict source lock pins exact edition and audited archive evidence", () => {
  assert.equal(lock.source.dictionary, "eng-zho");
  assert.equal(lock.source.edition, "2025.11.23");
  assert.equal(lock.source.tei.headwords, 26660);
  assert.equal(lock.source.archiveSizeBytes, 1600448);
  assert.match(lock.source.archiveSha512, /^[a-f0-9]{128}$/);
  assert.match(lock.source.tei.sha256, /^[a-f0-9]{64}$/);
  assert.match(lock.source.copying.sha256, /^[a-f0-9]{64}$/);
});

test("FreeDict legal packaging gate is exact and product-neutral", () => {
  assert.equal(lock.license.id, "CC-BY-SA-3.0");
  assert.equal(lock.license.licenseGatePassed, true);
  assert.equal(lock.license.adaptationLicense, "CC-BY-SA-3.0");
  assert.equal(lock.source.tei.licenseName, "Creative Commons Attribution-ShareAlike 3.0 Unported");
  assert.equal("approvedForOfficialPack" in lock.license, false);
  assert.equal("qualityDecision" in lock, false);
  assert.equal("qualityRole" in lock, false);
});
