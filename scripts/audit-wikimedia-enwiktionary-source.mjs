#!/usr/bin/env node
import {
  readFile,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveWikimediaSourceLock,
  verifyWikimediaSourceBytes
} from "./wikimedia-enwiktionary-lock.mjs";

async function main() {
  const { mode, values } =
    parseCliArgs(process.argv.slice(2));
  const candidate = JSON.parse(
    await readFile(
      requiredPath(values.candidate, "--candidate"),
      "utf8"
    )
  );
  const common = {
    sourcePath: values.source,
    sha1sumsPath: values.sha1sums,
    md5sumsPath: values.md5sums
  };

  if (mode === "--derive-lock") {
    const lock = await deriveWikimediaSourceLock({
      candidate,
      ...common
    });
    const outPath = requiredPath(values.out, "--out");
    await writeFile(
      outPath,
      JSON.stringify(lock, null, 2) + "\n",
      "utf8"
    );
    process.stdout.write(
      "[WIKIMEDIA_SOURCE_LOCK] " +
      JSON.stringify(lock) + "\n"
    );
    return;
  }

  const lock = JSON.parse(
    await readFile(
      requiredPath(values.lock, "--lock"),
      "utf8"
    )
  );
  const verified =
    await verifyWikimediaSourceBytes({
      lock,
      ...common
    });
  process.stdout.write(
    "Wikimedia source lock verified: " +
    verified.sizeBytes +
    " bytes, sha256:" +
    verified.sha256 + "\n"
  );
}

function parseCliArgs(argv) {
  const mode = argv[0];
  if (
    !["--derive-lock", "--verify-lock"].includes(mode)
  ) {
    throw new Error(
      "usage: audit-wikimedia-enwiktionary-source.mjs " +
      "(--derive-lock|--verify-lock) --candidate PATH " +
      "--source PATH --sha1sums PATH --md5sums PATH " +
      "(--out PATH|--lock PATH)"
    );
  }
  const values = {};
  for (
    let index = 1;
    index < argv.length;
    index += 2
  ) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(
        "invalid Wikimedia source-audit CLI arguments"
      );
    }
    values[key.slice(2)] = value;
  }
  return { mode, values };
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required");
  }
  return resolve(value);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
