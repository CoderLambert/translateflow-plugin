import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(
  new URL("../lexicon/source-locks/freedict-eng-zho.json", import.meta.url),
  "utf8"
));

test("FreeDict production source lock pins exact edition and audited archive evidence", () => {
  assert.equal(lock.source.dictionary, "eng-zho");
  assert.equal(lock.source.edition, "2025.11.23");
  assert.equal(lock.source.tei.headwords, 26660);
  assert.equal(lock.source.archiveSizeBytes, 1600448);
  assert.match(lock.source.archiveSha512, /^[a-f0-9]{128}$/);
  assert.match(lock.source.tei.sha256, /^[a-f0-9]{64}$/);
  assert.match(lock.source.copying.sha256, /^[a-f0-9]{64}$/);
});

test("FreeDict legal packaging gate is exact and separate from product distribution", () => {
  assert.equal(lock.license.id, "CC-BY-SA-3.0");
  assert.equal(lock.license.approvedForOfficialPack, true);
  assert.equal(lock.license.adaptationLicense, "CC-BY-SA-3.0");
  assert.equal(lock.source.tei.licenseName, "Creative Commons Attribution-ShareAlike 3.0 Unported");
  assert.equal(lock.qualityDecision.status, "no-ship");
  assert.equal(lock.qualityDecision.approvedForProductDistribution, false);
  assert.equal(lock.qualityRole, "research-only-no-ship");
});

test("FreeDict exact quality evidence records both complementary coverage and release blockers", () => {
  assert.ok(lock.qualityDecision.positiveCoverage.some((item) => item.term === "dependency"));
  assert.ok(lock.qualityDecision.misleadingOrWrong.some((item) => item.term === "portable"));
  assert.ok(lock.qualityDecision.misleadingOrWrong.some((item) => item.term === "repository"));
  assert.ok(lock.qualityDecision.absentTechnical.includes("tmux"));
});
