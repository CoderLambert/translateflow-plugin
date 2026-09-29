import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";
import {
  IMPORT_QUARANTINE_FILES,
  IMPORT_QUARANTINE_RANGE_BYTES,
  assertImportQuarantineTotalBytes
} from "../../shared/import-quarantine-contract.js";

const READ_ORDER = Object.freeze([
  "manifest.json",
  "index.dat",
  "entries.dat"
]);

export async function readImportQuarantineSnapshot({
  quarantine,
  token,
  signal,
  assertActive
} = {}) {
  if (!quarantine) {
    throw new Error(
      "Import quarantine snapshot requires a quarantine store."
    );
  }
  if (typeof assertActive !== "function") {
    throw new Error(
      "Import quarantine snapshot requires an activity assertion."
    );
  }

  assertActive(signal);
  const listed = await quarantine.listFiles(token);
  assertActive(signal);

  const filesByPath = validateExactFiles(listed);
  const totalBytes = READ_ORDER.reduce(
    (sum, path) =>
      sum + filesByPath.get(path).size,
    0
  );
  assertImportQuarantineTotalBytes(totalBytes);

  const files = {};
  for (const path of READ_ORDER) {
    assertActive(signal);
    files[path] = await readWholeFile({
      quarantine,
      token,
      path,
      size: filesByPath.get(path).size,
      signal,
      assertActive
    });
  }

  return {
    files,
    totalBytes
  };
}

function validateExactFiles(listed) {
  if (!Array.isArray(listed)) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Import quarantine file listing is invalid."
    );
  }

  const sorted = [...listed].sort(
    (left, right) =>
      compareText(left?.path, right?.path)
  );
  const expected = [...IMPORT_QUARANTINE_FILES]
    .sort(compareText);
  if (
    sorted.length !== expected.length ||
    sorted.some(
      (item, index) =>
        item?.path !== expected[index] ||
        !Number.isSafeInteger(item?.size) ||
        item.size <= 0
    )
  ) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Import quarantine must contain exactly the three TFLex files."
    );
  }

  return new Map(
    sorted.map((item) => [
      item.path,
      {
        path: item.path,
        size: item.size
      }
    ])
  );
}

async function readWholeFile({
  quarantine,
  token,
  path,
  size,
  signal,
  assertActive
}) {
  const output = new Uint8Array(size);
  let offset = 0;

  while (offset < size) {
    assertActive(signal);
    const length = Math.min(
      IMPORT_QUARANTINE_RANGE_BYTES,
      size - offset
    );
    const chunk = await quarantine.readFileRange(
      token,
      path,
      offset,
      length
    );
    assertActive(signal);

    if (
      !(chunk instanceof Uint8Array) ||
      chunk.byteLength !== length
    ) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Import quarantine range read returned unexpected bytes.",
        {
          token,
          path,
          offset,
          expectedBytes: length,
          actualBytes:
            chunk instanceof Uint8Array
              ? chunk.byteLength
              : null
        }
      );
    }

    output.set(chunk, offset);
    offset += length;
  }

  return output;
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}
