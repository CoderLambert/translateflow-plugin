import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  WIKIMEDIA_SOURCE,
  validateWikimediaCandidate,
  validateWikimediaSourceLock
} from "./wikimedia-enwiktionary-contract.mjs";

export async function deriveWikimediaSourceLock({
  candidate,
  sourcePath,
  sha1sumsPath,
  md5sumsPath
}) {
  const reviewed =
    validateWikimediaCandidate(candidate);
  const evidence = await collectEvidence({
    sourcePath,
    sha1sumsPath,
    md5sumsPath
  });

  return validateWikimediaSourceLock({
    schemaVersion: 1,
    status: "locked",
    sourceId: reviewed.sourceId,
    role: reviewed.role,
    edition: reviewed.edition,
    dumpDate: reviewed.dumpDate,
    source: structuredClone(reviewed.source),
    extractor: structuredClone(reviewed.extractor),
    artifact: {
      filename: WIKIMEDIA_SOURCE.artifactFilename,
      sizeBytes: evidence.sizeBytes,
      sha256: evidence.sha256,
      publishedSha1: evidence.publishedSha1,
      publishedMd5: evidence.publishedMd5
    },
    evidence: structuredClone(reviewed.evidence),
    license: structuredClone(reviewed.license),
    packaging: structuredClone(reviewed.packaging)
  });
}

export async function verifyWikimediaSourceBytes({
  lock,
  sourcePath,
  sha1sumsPath,
  md5sumsPath
}) {
  const reviewed =
    validateWikimediaSourceLock(lock);
  const actual = await collectEvidence({
    sourcePath,
    sha1sumsPath,
    md5sumsPath
  });

  if (
    actual.sizeBytes !== reviewed.artifact.sizeBytes
  ) {
    throw new Error(
      "Wikimedia source size mismatch: expected " +
      reviewed.artifact.sizeBytes +
      ", got " + actual.sizeBytes
    );
  }
  if (
    actual.sha256 !==
      reviewed.artifact.sha256.toLowerCase()
  ) {
    throw new Error("Wikimedia source SHA-256 mismatch");
  }
  if (
    actual.publishedSha1 !==
      reviewed.artifact.publishedSha1.toLowerCase() ||
    actual.publishedMd5 !==
      reviewed.artifact.publishedMd5.toLowerCase()
  ) {
    throw new Error(
      "Wikimedia published checksum metadata drifted"
    );
  }
  return actual;
}

async function collectEvidence({
  sourcePath,
  sha1sumsPath,
  md5sumsPath
}) {
  const [actual, sha1Text, md5Text] =
    await Promise.all([
      digestFile(requiredPath(sourcePath, "sourcePath")),
      readFile(
        requiredPath(sha1sumsPath, "sha1sumsPath"),
        "utf8"
      ),
      readFile(
        requiredPath(md5sumsPath, "md5sumsPath"),
        "utf8"
      )
    ]);
  const publishedSha1 = checksumForFile(
    sha1Text,
    WIKIMEDIA_SOURCE.artifactFilename,
    40,
    "SHA-1"
  );
  const publishedMd5 = checksumForFile(
    md5Text,
    WIKIMEDIA_SOURCE.artifactFilename,
    32,
    "MD5"
  );
  if (actual.sha1 !== publishedSha1) {
    throw new Error(
      "Wikimedia source does not match published SHA-1"
    );
  }
  if (actual.md5 !== publishedMd5) {
    throw new Error(
      "Wikimedia source does not match published MD5"
    );
  }
  return {
    ...actual,
    publishedSha1,
    publishedMd5
  };
}

async function digestFile(path) {
  const hashes = {
    md5: createHash("md5"),
    sha1: createHash("sha1"),
    sha256: createHash("sha256")
  };
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.byteLength;
    for (const hash of Object.values(hashes)) {
      hash.update(chunk);
    }
  }
  if (!sizeBytes) {
    throw new Error(
      "Wikimedia source artifact must not be empty"
    );
  }
  return {
    sizeBytes,
    md5: hashes.md5.digest("hex"),
    sha1: hashes.sha1.digest("hex"),
    sha256: hashes.sha256.digest("hex")
  };
}

function checksumForFile(
  text,
  filename,
  hexLength,
  label
) {
  for (const rawLine of String(text || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match =
      /^([a-f0-9]+)\s+[*]?(.+)$/iu.exec(line);
    if (
      match &&
      match[1].length === hexLength &&
      match[2] === filename
    ) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(
    "Wikimedia " + label +
    " manifest does not contain the locked artifact"
  );
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required");
  }
  return resolve(value);
}
