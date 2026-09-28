import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildReviewedTechnicalRecords,
  deriveReviewedTechnicalSourceLock,
  validateReviewedTechnicalExtract,
  validateReviewedTechnicalSourceLock,
  verifyReviewedLockedExtract,
  verifyReviewedTechnicalSourceLockBytes
} from "../scripts/reviewed-tech-terms.mjs";
import { buildTechnicalAliasIndex } from "../scripts/build-tflex-technical.mjs";

const sourceUrl = new URL("../lexicon/sources/reviewed-tech-terms.json", import.meta.url);
const lockUrl = new URL("../lexicon/source-locks/technical-reviewed-terms.json", import.meta.url);
const wikidataLockUrl = new URL("../lexicon/source-locks/technical-wikidata.json", import.meta.url);

async function official() {
  const [bytes, lockText, wikidataLockText] = await Promise.all([
    readFile(sourceUrl),
    readFile(lockUrl, "utf8"),
    readFile(wikidataLockUrl, "utf8")
  ]);
  return {
    bytes,
    extract: JSON.parse(bytes.toString("utf8")),
    lock: JSON.parse(lockText),
    wikidataPolicy: JSON.parse(wikidataLockText).policy
  };
}

test("reviewed source lock is deterministically derived from the exact source bytes", async () => {
  const { bytes, lock } = await official();
  assert.equal(bytes.byteLength, 7820);
  assert.deepEqual(deriveReviewedTechnicalSourceLock(bytes, lock), lock);
  assert.equal(verifyReviewedTechnicalSourceLockBytes(lock, bytes), true);
  assert.equal(
    verifyReviewedLockedExtract(lock, bytes),
    "6369403c442183a746a76be06cfbd8a1b3cebdc3a69f00a6179a0a13199a4eb0"
  );
});

test("reviewed source lock rejects independent size and hash drift", async () => {
  const { bytes, lock } = await official();
  const wrongSize = structuredClone(lock);
  wrongSize.source.extractSize += 1;
  assert.throws(() => verifyReviewedLockedExtract(wrongSize, bytes), /size mismatch/);

  const wrongHash = structuredClone(lock);
  wrongHash.source.extractSha256 = "0".repeat(64);
  assert.throws(() => verifyReviewedLockedExtract(wrongHash, bytes), /SHA-256 mismatch/);
});

test("reviewed source lock fails closed on term ID and snapshot drift", async () => {
  const { extract, lock } = await official();
  const reordered = structuredClone(extract);
  [reordered.terms[0], reordered.terms[1]] = [reordered.terms[1], reordered.terms[0]];
  assert.throws(
    () => validateReviewedTechnicalExtract(reordered, lock),
    /term ids do not match/
  );

  const changedSnapshot = structuredClone(extract);
  changedSnapshot.snapshot.version = "unlocked";
  assert.throws(
    () => validateReviewedTechnicalExtract(changedSnapshot, lock),
    /snapshot mismatch/
  );
});

test("reviewed terms reject executable data and normalized alias collisions", async () => {
  const { extract, lock } = await official();
  const markup = structuredClone(extract);
  markup.terms[0].aliases = ["<img src=x>"];
  assert.throws(
    () => validateReviewedTechnicalExtract(markup, lock),
    /HTML-like markup/
  );

  const headwordCollision = structuredClone(extract);
  headwordCollision.terms[0].aliases = [headwordCollision.terms[1].headword];
  assert.throws(
    () => validateReviewedTechnicalExtract(headwordCollision, lock),
    /alias collides with a headword/
  );

  const aliasCollision = structuredClone(extract);
  aliasCollision.terms.find((term) => term.id === "repository.git").aliases.push("message loop");
  assert.throws(
    () => validateReviewedTechnicalExtract(aliasCollision, lock),
    /alias collides across terms/
  );
});

test("reviewed alias policy independently enforces blocked and exact-case aliases", async () => {
  const { extract, lock, wikidataPolicy } = await official();
  const changedExtract = structuredClone(extract);
  changedExtract.terms.find((term) => term.id === "branch.git").aliases = ["run"];
  changedExtract.terms.find((term) => term.id === "repository.git").aliases = ["Repo"];
  const changedLock = structuredClone(lock);
  changedLock.policy.caseSensitiveAliases = ["Repo"];
  validateReviewedTechnicalSourceLock(changedLock);

  const records = buildReviewedTechnicalRecords(changedExtract, changedLock);
  assert.deepEqual(records.find((record) => record.lookupKey === "branch").aliases, []);
  const aliases = buildTechnicalAliasIndex(records, wikidataPolicy, changedLock.policy);
  const repo = aliases.find((entry) => entry.key === "repo");
  assert.deepEqual(repo, {
    key: "repo",
    caseSensitive: true,
    exactLookupKeys: ["Repo"],
    targets: ["repository"]
  });
});

test("reviewed collision policy rejects aliases crossing either source boundary", async () => {
  const { lock, wikidataPolicy } = await official();
  const wikidata = {
    lookupKey: "base-tool",
    aliases: ["reviewed tool"],
    entityId: "Q1",
    sourceRefs: [{ sourceId: "wikidata", recordId: "Q1@1" }]
  };
  const reviewed = {
    lookupKey: "reviewed tool",
    aliases: [],
    entityId: "reviewed:tool.test",
    sourceRefs: [{
      sourceId: "translateflow-reviewed-technical-terms",
      recordId: "tool.test"
    }]
  };
  assert.throws(
    () => buildTechnicalAliasIndex([wikidata, reviewed], wikidataPolicy, lock.policy),
    /reviewed alias collides with a technical headword/
  );
});

test("reviewed policy rejects undeclared fields and unsafe collision-policy drift", async () => {
  const { lock } = await official();
  const unknown = structuredClone(lock);
  unknown.policy.remoteScript = "https://example.test/script.js";
  assert.throws(
    () => validateReviewedTechnicalSourceLock(unknown),
    /unsupported reviewed technical policy field/
  );

  const widened = structuredClone(lock);
  widened.policy.collisionPolicy.headwordToHeadword = "merge";
  assert.throws(
    () => validateReviewedTechnicalSourceLock(widened),
    /collision policy is incompatible/
  );
});
