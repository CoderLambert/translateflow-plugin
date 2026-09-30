import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveWikimediaSourceLock,
  validateWikimediaCandidate,
  validateWikimediaSourceLock,
  verifyWikimediaSourceBytes
} from "../scripts/audit-wikimedia-enwiktionary-source.mjs";

const candidateUrl = new URL(
  "../lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json",
  import.meta.url
);
const filename =
  "enwiktionary-20260901-pages-articles.xml.bz2";

async function officialCandidate() {
  return JSON.parse(
    await readFile(candidateUrl, "utf8")
  );
}

async function fixture(
  bytes = Buffer.from(
    "wikimedia enwiktionary source fixture\n",
    "utf8"
  )
) {
  const root = await mkdtemp(
    join(tmpdir(), "translateflow-wikimedia-lock-")
  );
  const sourcePath = join(root, filename);
  const sha1sumsPath = join(root, "sha1sums.txt");
  const md5sumsPath = join(root, "md5sums.txt");
  await writeFile(sourcePath, bytes);
  await writeFile(
    sha1sumsPath,
    digest("sha1", bytes) + "  " + filename + "\n"
  );
  await writeFile(
    md5sumsPath,
    digest("md5", bytes) + "  " + filename + "\n"
  );
  return {
    root,
    sourcePath,
    sha1sumsPath,
    md5sumsPath,
    bytes
  };
}

test("Wikimedia candidate uses one dated official dump path and remains unlocked", async () => {
  const candidate = validateWikimediaCandidate(
    await officialCandidate()
  );

  assert.equal(
    candidate.status,
    "candidate-unlocked"
  );
  assert.equal(candidate.dumpDate, "2026-09-01");
  assert.equal(
    candidate.source.artifactUrl,
    "https://dumps.wikimedia.org/enwiktionary/20260901/" +
      filename
  );
  assert.equal(candidate.source.datedPath, true);
  assert.equal(
    candidate.extractor.wiktextractCommit,
    "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
  );
  assert.equal(
    candidate.extractor.wikitextprocessorCommit,
    "e3d6d4edb77618f4d6680edc66e3f774bea59820"
  );
  assert.equal(
    candidate.packaging.productionExtensionEligible,
    false
  );
  assert.equal("artifact" in candidate, false);
});

test("Wikimedia lock is derived only from actual bytes matching both published checksum manifests", async () => {
  const candidate = await officialCandidate();
  const env = await fixture();

  try {
    const lock = await deriveWikimediaSourceLock({
      candidate,
      sourcePath: env.sourcePath,
      sha1sumsPath: env.sha1sumsPath,
      md5sumsPath: env.md5sumsPath
    });

    assert.equal(lock.status, "locked");
    assert.equal(lock.artifact.filename, filename);
    assert.equal(
      lock.artifact.sizeBytes,
      env.bytes.byteLength
    );
    assert.equal(
      lock.artifact.sha256,
      digest("sha256", env.bytes)
    );
    assert.equal(
      lock.artifact.publishedSha1,
      digest("sha1", env.bytes)
    );
    assert.equal(
      lock.artifact.publishedMd5,
      digest("md5", env.bytes)
    );
    assert.equal(
      lock.packaging.productionExtensionEligible,
      false
    );
    assert.equal("goNoGo" in lock, false);
    assert.deepEqual(
      validateWikimediaSourceLock(lock),
      lock
    );
  } finally {
    await rm(env.root, {
      recursive: true,
      force: true
    });
  }
});

test("Wikimedia verification independently rejects source and official checksum drift", async () => {
  const candidate = await officialCandidate();
  const env = await fixture();

  try {
    const lock = await deriveWikimediaSourceLock({
      candidate,
      sourcePath: env.sourcePath,
      sha1sumsPath: env.sha1sumsPath,
      md5sumsPath: env.md5sumsPath
    });

    assert.deepEqual(
      await verifyWikimediaSourceBytes({
        lock,
        sourcePath: env.sourcePath,
        sha1sumsPath: env.sha1sumsPath,
        md5sumsPath: env.md5sumsPath
      }),
      {
        sizeBytes: env.bytes.byteLength,
        md5: digest("md5", env.bytes),
        sha1: digest("sha1", env.bytes),
        sha256: digest("sha256", env.bytes),
        publishedSha1: digest("sha1", env.bytes),
        publishedMd5: digest("md5", env.bytes)
      }
    );

    const changed = Buffer.from(env.bytes);
    changed[0] ^= 1;
    await writeFile(env.sourcePath, changed);
    await assert.rejects(
      verifyWikimediaSourceBytes({
        lock,
        sourcePath: env.sourcePath,
        sha1sumsPath: env.sha1sumsPath,
        md5sumsPath: env.md5sumsPath
      }),
      /published SHA-1|published MD5/
    );

    await writeFile(env.sourcePath, env.bytes);
    await writeFile(
      env.sha1sumsPath,
      "0".repeat(40) + "  " + filename + "\n"
    );
    await assert.rejects(
      verifyWikimediaSourceBytes({
        lock,
        sourcePath: env.sourcePath,
        sha1sumsPath: env.sha1sumsPath,
        md5sumsPath: env.md5sumsPath
      }),
      /published SHA-1/
    );
  } finally {
    await rm(env.root, {
      recursive: true,
      force: true
    });
  }
});

test("Wikimedia candidate rejects moving paths, short extractor revisions and production eligibility", async () => {
  const candidate = await officialCandidate();

  const moving = structuredClone(candidate);
  moving.source.artifactUrl =
    "https://dumps.wikimedia.org/enwiktionary/latest/" +
    filename;
  assert.throws(
    () => validateWikimediaCandidate(moving),
    /dated source configuration/
  );

  const shortRevision = structuredClone(candidate);
  shortRevision.extractor.wiktextractCommit =
    "1a05e46";
  assert.throws(
    () => validateWikimediaCandidate(shortRevision),
    /40-character hex digest/
  );

  const packaged = structuredClone(candidate);
  packaged.packaging.productionExtensionEligible =
    true;
  assert.throws(
    () => validateWikimediaCandidate(packaged),
    /packaging boundary/
  );
});

test("Wikimedia lock cannot imply projection or GO decisions", async () => {
  const candidate = await officialCandidate();
  const env = await fixture();

  try {
    const lock = await deriveWikimediaSourceLock({
      candidate,
      sourcePath: env.sourcePath,
      sha1sumsPath: env.sha1sumsPath,
      md5sumsPath: env.md5sumsPath
    });
    lock.goNoGo = "GO";
    assert.throws(
      () => validateWikimediaSourceLock(lock),
      /unsupported Wikimedia source lock field|must not imply/
    );
  } finally {
    await rm(env.root, {
      recursive: true,
      force: true
    });
  }
});

function digest(algorithm, bytes) {
  return createHash(algorithm)
    .update(bytes)
    .digest("hex");
}
