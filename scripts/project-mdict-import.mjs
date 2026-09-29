#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  stat,
  readFile,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictImportError,
  adler32,
  mdictFail,
  requireMdictAtMost,
  sanitizeMdictRecord
} from "../src/background/packs/importers/mdict-contract.js";
import {
  projectMdictV2PlainText
} from "../src/background/packs/importers/mdict-core.js";

export const MDICT_POC_LIMITS = MDICT_IMPORT_LIMITS;
export {
  MDICT_IMPORT_ERROR,
  MDictImportError,
  adler32,
  projectMdictV2PlainText,
  sanitizeMdictRecord
};

export async function projectMdictPoc({
  mdxPath,
  outPath,
  reportPath,
  sourceId = "user-mdict",
  sourceVersion = "local-import",
  limits = MDICT_POC_LIMITS
} = {}) {
  const path = requiredPath(mdxPath, "mdxPath");
  if (!/\.mdx$/iu.test(path)) {
    mdictFail(
      MDICT_IMPORT_ERROR.UNSUPPORTED,
      "MDict POC accepts .mdx dictionary files only."
    );
  }

  const inputBytes = await checkedFileSize(
    path,
    limits.fileBytes,
    "MDX"
  );
  const bytes = await readFile(resolve(path));
  requireMdictAtMost(
    bytes.byteLength,
    limits.fileBytes,
    "MDX bytes"
  );

  const result = await projectMdictV2PlainText({
    mdxBytes: bytes,
    sourceId,
    sourceVersion,
    limits
  });
  const output =
    result.entries
      .map((entry) => stableStringify(entry))
      .join("\n") + "\n";
  const report = {
    schemaVersion: 1,
    format: "mdict-poc-report",
    sourceId,
    sourceVersion,
    input: {
      fileBytes: inputBytes,
      sha256: createHash("sha256")
        .update(bytes)
        .digest("hex")
    },
    dictionary: result.dictionary,
    blocks: result.blocks,
    output: {
      entries: result.entries.length,
      bytes: Buffer.byteLength(output)
    },
    policy: {
      ...result.policy,
      runtimeStatus: "build-test-only",
      tflexMapping: "not-yet-approved"
    },
    unsupportedFeatures: result.unsupportedFeatures
  };

  if (outPath) {
    await writeFile(resolve(outPath), output, "utf8");
  }
  if (reportPath) {
    await writeFile(
      resolve(reportPath),
      JSON.stringify(report, null, 2) + "\n",
      "utf8"
    );
  }
  return {
    ...result,
    policy: report.policy,
    report,
    output
  };
}

async function checkedFileSize(path, maximum, label) {
  const info = await stat(resolve(path));
  if (!info.isFile()) {
    mdictFail(
      MDICT_IMPORT_ERROR.CORRUPT,
      label + " path is not a file."
    );
  }
  requireMdictAtMost(
    info.size,
    maximum,
    label + " bytes"
  );
  return info.size;
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, sortJson(value[key])])
  );
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredPath(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required");
  return text;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(
        "usage: project-mdict-import.mjs --mdx PATH --out PATH --report PATH " +
        "[--source-id ID] [--source-version VERSION]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["mdx", "out", "report"]) {
    if (!args[key]) throw new Error("--" + key + " is required");
  }
  const result = await projectMdictPoc({
    mdxPath: args.mdx,
    outPath: args.out,
    reportPath: args.report,
    sourceId: args["source-id"] || "user-mdict",
    sourceVersion:
      args["source-version"] || "local-import"
  });
  process.stdout.write(
    JSON.stringify(result.report, null, 2) + "\n"
  );
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
