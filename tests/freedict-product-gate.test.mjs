import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { OPTIONAL_PACK_SOURCES } from "../src/shared/pack-sources.js";

const lock = JSON.parse(await readFile(
  new URL("../lexicon/source-locks/freedict-eng-zho.json", import.meta.url),
  "utf8"
));
const decision = JSON.parse(await readFile(
  new URL("../lexicon/quality-decisions/freedict-eng-zho-2025.11.23.json", import.meta.url),
  "utf8"
));

test("FreeDict no-ship quality decision prevents production source registration", () => {
  assert.equal(decision.status, "no-ship");
  assert.equal(decision.approvedForProductDistribution, false);
  assert.equal(decision.qualityRole, "research-only-no-ship");
  assert.equal(decision.packId, lock.packId);
  assert.equal(decision.packVersion, lock.packVersion);
  assert.equal(
    OPTIONAL_PACK_SOURCES.some((source) =>
      source.packs?.some((pack) => pack.packId === decision.packId)
    ),
    false
  );
});

test("FreeDict legal redistribution approval does not imply product approval", () => {
  assert.equal(lock.license.licenseGatePassed, true);
  assert.equal(lock.license.id, "CC-BY-SA-3.0");
  assert.equal("approvedForOfficialPack" in lock.license, false);
  assert.equal(decision.approvedForProductDistribution, false);
});

test("FreeDict quality evidence records complementary coverage and release blockers", () => {
  assert.ok(decision.positiveCoverage.some((item) => item.term === "dependency"));
  assert.ok(decision.misleadingOrWrong.some((item) => item.term === "portable"));
  assert.ok(decision.misleadingOrWrong.some((item) => item.term === "repository"));
  assert.ok(decision.absentTechnical.includes("tmux"));
});
