import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveKaikkiSourceLock,
  validateKaikkiCandidate,
  validateKaikkiSourceLock,
  verifyKaikkiSourceBytes
} from "../scripts/lock-kaikki-source.mjs";

const candidateUrl = new URL(
  "../lexicon/source-candidates/kaikki-enwiktionary-2026-09-25.json",
  import.meta.url
);

async function officialCandidate() {
  return JSON.parse(await readFile(candidateUrl, "utf8"));
}

async function fixture(bytes = Buffer.from("kaikki source lock fixture\n", "utf8")) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-kaikki-lock-"));
  const path = join(root, "raw-wiktextract-data.jsonl.gz");
  await writeFile(path, bytes);
  return { root, path, bytes };
}

test("Kaikki candidate records the reviewed moving snapshot without pretending it is locked", async () => {
  const candidate = validateKaikkiCandidate(await officialCandidate());

  assert.equal(candidate.status, "candidate-unlocked");
  assert.equal(candidate.dumpDate, "2026-09-02");
  assert.equal(candidate.extractedAt, "2026-09-25");
  assert.equal(candidate.rawDataUrl, "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz");
  assert.equal(candidate.rawDataUrlMutable, true);
  assert.equal(
    candidate.extractor.wiktextractCommit,
    "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
  );
  assert.equal(
    candidate.extractor.wikitextprocessorCommit,
    "e3d6d4edb77618f4d6680edc66e3f774bea59820"
  );
  assert.deepEqual(candidate.license.sourceLicenses, ["CC-BY-SA-4.0", "GFDL-1.1-or-later"]);
  assert.equal(candidate.license.legalReviewStatus, "pending-field-projection-audit");
  assert.equal(candidate.packaging.rawInputRole, "build-only");
  assert.equal(candidate.packaging.productionExtensionEligible, false);
  assert.equal(candidate.packaging.downloadablePackDecision, "pending-poc");
  assert.equal("artifact" in candidate, false);
});

test("Kaikki lock is derived from exact local artifact bytes and remains product-neutral", async () => {
  const candidate = await officialCandidate();
  const { root, path, bytes } = await fixture();
  try {
    const lock = await deriveKaikkiSourceLock({ candidate, sourcePath: path });
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

    assert.equal(lock.status, "locked");
    assert.equal(lock.artifact.filename, "raw-wiktextract-data.jsonl.gz");
    assert.equal(lock.artifact.sizeBytes, bytes.byteLength);
    assert.equal(lock.artifact.sha256, expectedSha256);
    assert.equal(lock.source.urlMutable, true);
    assert.equal(lock.packaging.productionExtensionEligible, false);
    assert.equal(lock.packaging.downloadablePackDecision, "pending-poc");
    assert.equal("approvedForOfficialPack" in lock, false);
    assert.equal("qualityDecision" in lock, false);
    assert.equal("goNoGo" in lock, false);
    assert.deepEqual(validateKaikkiSourceLock(lock), lock);
    assert.deepEqual(
      await verifyKaikkiSourceBytes(lock, path),
      { sha256: expectedSha256, sizeBytes: bytes.byteLength }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Kaikki verification fails closed on independent size and checksum drift", async () => {
  const candidate = await officialCandidate();
  const { root, path, bytes } = await fixture();
  try {
    const lock = await deriveKaikkiSourceLock({ candidate, sourcePath: path });

    await writeFile(path, Buffer.concat([bytes, Buffer.from("x")]));
    await assert.rejects(
      verifyKaikkiSourceBytes(lock, path),
      /size mismatch/
    );

    const changed = Buffer.from(bytes);
    changed[0] = changed[0] === 0x6b ? 0x4b : 0x6b;
    await writeFile(path, changed);
    await assert.rejects(
      verifyKaikkiSourceBytes(lock, path),
      /SHA-256 mismatch/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Kaikki candidate rejects short revisions and production-extension eligibility", async () => {
  const candidate = await officialCandidate();

  const shortRevision = structuredClone(candidate);
  shortRevision.extractor.wiktextractCommit = "1a05e46";
  assert.throws(
    () => validateKaikkiCandidate(shortRevision),
    /full Git commit SHA/
  );

  const productionRawSource = structuredClone(candidate);
  productionRawSource.packaging.productionExtensionEligible = true;
  assert.throws(
    () => validateKaikkiCandidate(productionRawSource),
    /packaging boundary is incompatible/
  );
});

test("Kaikki source lock cannot be replaced by mutable URL metadata alone", async () => {
  const candidate = await officialCandidate();
  assert.throws(
    () => validateKaikkiSourceLock(candidate),
    /status must be locked|unsupported Kaikki source lock field/
  );
});
