import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lock = JSON.parse(await readFile(new URL("./fixtures/freedict-eng-zho-source-lock.json", import.meta.url), "utf8"));

test("FreeDict source lock pins exact edition and official source checksum", () => {
  assert.equal(lock.dictionary, "eng-zho");
  assert.equal(lock.edition, "2025.11.23");
  assert.equal(lock.headwords, 26660);
  assert.match(lock.source.sha512, /^[a-f0-9]{128}$/);
  assert.equal(lock.source.sizeBytes, 1600448);
});

test("FreeDict cannot be approved from generator-template evidence alone", () => {
  assert.equal(lock.provenance.releaseTimeTemplateLicense, "CC-BY-SA-3.0");
  assert.equal(lock.licenseAudit.exactTeiHeaderArchived, false);
  assert.equal(lock.licenseAudit.exactTeiLicense, null);
  assert.equal(lock.licenseAudit.approvedForOfficialPack, false);
});
