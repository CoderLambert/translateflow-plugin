#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { open, stat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { stableStringify } from "./build-tflex-core.mjs";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  StarDictImportError,
  parseStarDictDictzipHeader,
  parseStarDictIfo,
  parseStarDictIndex,
  parseStarDictSynonyms,
  projectStarDictPlainText,
  sanitizePlainText
} from "../src/background/packs/importers/stardict-core.js";
import {
  decodeStarDictUtf8,
  readStarDictUint16Le,
  requireStarDictAtMost,
  starDictFail
} from "../src/background/packs/importers/stardict-contract.js";

export const STARDICT_POC_LIMITS = STARDICT_IMPORT_LIMITS;

export {
  STARDICT_IMPORT_ERROR,
  StarDictImportError,
  parseStarDictDictzipHeader,
  parseStarDictIfo,
  parseStarDictIndex,
  parseStarDictSynonyms,
  projectStarDictPlainText,
  sanitizePlainText
};

export async function projectStarDictPoc({
  ifoPath,
  idxPath,
  dictPath,
  synPath,
  outPath,
  reportPath,
  sourceId = "user-stardict",
  sourceVersion = "local-import",
  limits = STARDICT_POC_LIMITS
} = {}) {
  const paths = {
    ifo: requiredPath(ifoPath, "ifoPath"),
    idx: requiredPath(idxPath, "idxPath"),
    dict: requiredPath(dictPath, "dictPath"),
    syn: optionalPath(synPath)
  };
  const [ifoSize, idxSize, synSize] = await Promise.all([
    checkedFileSize(paths.ifo, limits.ifoBytes, "IFO"),
    checkedFileSize(paths.idx, limits.idxBytes, "IDX"),
    paths.syn
      ? checkedFileSize(paths.syn, limits.synBytes, "SYN")
      : Promise.resolve(0)
  ]);
  const [ifoBytes, idxBytes, dictionaryFile, synBytes] = await Promise.all([
    readFile(paths.ifo),
    readFile(paths.idx),
    readStarDictDictionaryFile(paths.dict, { limits }),
    paths.syn ? readFile(paths.syn) : Promise.resolve(undefined)
  ]);
  const dictBytes = dictionaryFile.bytes;
  const result = projectStarDictPlainText({
    ifoText: decodeStarDictUtf8(ifoBytes, "IFO"),
    idxBytes,
    dictBytes,
    synBytes,
    sourceId,
    sourceVersion,
    limits
  });

  const output = result.entries
    .map((entry) => stableStringify(entry))
    .join("\n") + "\n";
  const report = {
    schemaVersion: 1,
    format: "stardict-poc-report",
    sourceId,
    sourceVersion,
    input: {
      ifoBytes: ifoSize,
      idxBytes: idxSize,
      dictFileBytes: dictionaryFile.inputBytes,
      dictBytes: dictBytes.byteLength,
      dictCompression: dictionaryFile.compression,
      dictzip: dictionaryFile.dictzip,
      synBytes: synSize
    },
    dictionary: result.dictionary,
    output: {
      entries: result.entries.length,
      bytes: Buffer.byteLength(output)
    },
    policy: result.policy,
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
  return { ...result, report, output };
}

export async function readStarDictDictionaryFile(path, {
  limits = STARDICT_POC_LIMITS
} = {}) {
  const selected = requiredPath(path, "dictPath");
  if (!/\.dict\.dz$/i.test(selected)) {
    await checkedFileSize(selected, limits.dictBytes, "DICT");
    const bytes = await readFile(resolve(selected));
    requireStarDictAtMost(
      bytes.byteLength,
      limits.dictBytes,
      "DICT bytes"
    );
    return {
      bytes,
      inputBytes: bytes.byteLength,
      compression: "none",
      dictzip: null
    };
  }

  const inputBytes = await checkedFileSize(
    selected,
    limits.dictArchiveBytes,
    "DICT.DZ"
  );
  const headerBytes = await readDictzipHeaderPrefix(
    selected,
    inputBytes
  );
  const dictzip = parseStarDictDictzipHeader(headerBytes);
  const bytes = await gunzipBounded(
    selected,
    limits.dictBytes,
    inputBytes
  );
  return {
    bytes,
    inputBytes,
    compression: "dictzip",
    dictzip
  };
}

async function readDictzipHeaderPrefix(path, fileBytes) {
  const handle = await open(resolve(path), "r");
  try {
    const fixed = Buffer.alloc(
      Math.min(fileBytes, 12)
    );
    const first = await handle.read(
      fixed,
      0,
      fixed.byteLength,
      0
    );
    if (first.bytesRead < 12) {
      return fixed.subarray(0, first.bytesRead);
    }

    const extraLength = readStarDictUint16Le(
      fixed,
      10
    );
    const headerBytes = 12 + extraLength;
    if (headerBytes > fileBytes) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .dict.dz declared extra header exceeds the file."
      );
    }

    const header = Buffer.alloc(headerBytes);
    const read = await handle.read(
      header,
      0,
      headerBytes,
      0
    );
    if (read.bytesRead !== headerBytes) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "StarDict .dict.dz gzip header is truncated."
      );
    }
    return header;
  } finally {
    await handle.close();
  }
}

async function gunzipBounded(
  path,
  maximumBytes,
  inputBytes
) {
  const source = createReadStream(resolve(path), {
    start: 0,
    end: Math.max(0, inputBytes - 1)
  });
  const gunzip = createGunzip();
  source.pipe(gunzip);

  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of gunzip) {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        source.destroy();
        gunzip.destroy();
        starDictFail(
          STARDICT_IMPORT_ERROR.LIMIT,
          "DICT decompressed bytes exceeds the POC safety limit.",
          {
            actual: total,
            maximum: maximumBytes
          }
        );
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (cause) {
    source.destroy();
    gunzip.destroy();
    if (cause instanceof StarDictImportError) {
      throw cause;
    }
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .dict.dz decompression failed.",
      { cause }
    );
  }
  return Buffer.concat(chunks, total);
}

async function checkedFileSize(
  path,
  maximum,
  label
) {
  const info = await stat(resolve(path));
  if (!info.isFile()) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " path is not a file."
    );
  }
  requireStarDictAtMost(
    info.size,
    maximum,
    label + " bytes"
  );
  return info.size;
}

function requiredPath(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(label + " is required");
  return text;
}

function optionalPath(value) {
  const text = String(value || "").trim();
  return text || "";
}

function parseArgs(argv) {
  const result = {};
  for (
    let index = 0;
    index < argv.length;
    index += 2
  ) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(
        "usage: project-stardict-import.mjs --ifo PATH --idx PATH " +
        "--dict PATH [--syn PATH] --out PATH --report PATH " +
        "[--source-id ID] [--source-version VERSION]"
      );
    }
    result[key.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const key of [
    "ifo",
    "idx",
    "dict",
    "out",
    "report"
  ]) {
    if (!args[key]) {
      throw new Error("--" + key + " is required");
    }
  }

  const result = await projectStarDictPoc({
    ifoPath: args.ifo,
    idxPath: args.idx,
    dictPath: args.dict,
    synPath: args.syn,
    outPath: args.out,
    reportPath: args.report,
    sourceId: args["source-id"] || "user-stardict",
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
