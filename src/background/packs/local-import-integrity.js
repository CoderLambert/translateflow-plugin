import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";
import { normalizeLexicalKey } from "../../shared/lexical.js";
import { validateTflexRecord } from "../lexical/tflex-integrity.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export async function validateLocalIndexedRecords({
  index,
  entriesBytes,
  manifest,
  cryptoProvider,
  sourceIds
} = {}) {
  const validated = new Map();
  const canonicalRanges = [];

  for (const item of index.entries) {
    for (const target of item.targets) {
      const key = [
        target.offset,
        target.length,
        target.sha256,
        target.lookupKey
      ].join(":");
      let record = validated.get(key);
      if (!record) {
        const slice = entriesBytes.subarray(
          target.offset,
          target.offset + target.length
        );
        const actual = await sha256Hex(slice, cryptoProvider);
        if (actual !== target.sha256) {
          throw packError(
            PACK_ERROR_CODES.HASH,
            "Local dictionary indexed record SHA-256 failed verification.",
            {
              lookupKey: target.lookupKey,
              offset: target.offset
            }
          );
        }
        record = parseRecord(slice);
        try {
          validateTflexRecord(record, manifest.packId, "entries.dat");
        } catch (error) {
          throw packError(
            PACK_ERROR_CODES.CORRUPT,
            error?.message || "Local dictionary record is malformed.",
            {
              lookupKey: target.lookupKey,
              cause: error
            }
          );
        }
        if (record.lookupKey !== target.lookupKey) {
          throw packError(
            PACK_ERROR_CODES.CORRUPT,
            "Local dictionary index/record key mismatch.",
            {
              indexKey: target.lookupKey,
              recordKey: record.lookupKey
            }
          );
        }
        validateLocalRecordStrings(record, sourceIds);
        validated.set(key, record);
      }

      if (target.matchedAlias) {
        if (
          item.key === target.lookupKey ||
          !Array.isArray(record.aliases) ||
          !record.aliases.some(
            (alias) => normalizeLexicalKey(alias) === item.key
          )
        ) {
          throw packError(
            PACK_ERROR_CODES.CORRUPT,
            "Local dictionary alias target is inconsistent."
          );
        }
      } else {
        canonicalRanges.push({
          lookupKey: target.lookupKey,
          offset: target.offset,
          length: target.length
        });
      }
    }
  }

  canonicalRanges.sort(
    (a, b) => a.offset - b.offset || compareText(a.lookupKey, b.lookupKey)
  );
  if (canonicalRanges.length !== manifest.recordCount) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Local dictionary canonical record count mismatch."
    );
  }

  let expectedOffset = 0;
  for (const range of canonicalRanges) {
    if (range.offset !== expectedOffset) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Local dictionary entries.dat contains gaps, overlaps or hidden trailing payload."
      );
    }
    expectedOffset += range.length;
  }
  if (expectedOffset !== entriesBytes.byteLength) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Local dictionary entries.dat contains unindexed trailing payload."
    );
  }
}

export function assertSafeLocalDataText(value, label) {
  const text = String(value || "");
  if (
    !text ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ||
    /<\/?[A-Za-z][^>]*>/u.test(text) ||
    /<!--|<!DOCTYPE\b|<\?/iu.test(text) ||
    /javascript\s*:/iu.test(text)
  ) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Local dictionary " + label +
        " contains unsafe renderable/control content."
    );
  }
}

function validateLocalRecordStrings(record, sourceIds) {
  if (record.kind !== "lexical") {
    throw packError(
      PACK_ERROR_CODES.INCOMPATIBLE,
      "Local bilingual import profile only accepts lexical records."
    );
  }
  if (!Array.isArray(record.exactLookupKeys) || !Array.isArray(record.aliases)) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Local dictionary lookup metadata is malformed."
    );
  }

  assertSafeLocalDataText(record.displayForm, "display form");
  for (const value of record.exactLookupKeys) {
    if (
      typeof value !== "string" ||
      normalizeLexicalKey(value) !== record.lookupKey
    ) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Local dictionary exact lookup key is malformed."
      );
    }
    assertSafeLocalDataText(value, "exact lookup key");
  }

  for (const alias of record.aliases) {
    if (typeof alias !== "string" || !normalizeLexicalKey(alias)) {
      throw packError(
        PACK_ERROR_CODES.CORRUPT,
        "Local dictionary alias is malformed."
      );
    }
    assertSafeLocalDataText(alias, "alias");
  }

  for (const sense of record.senses || []) {
    assertSafeLocalDataText(sense.id, "sense id");
    if (sense.partOfSpeech !== undefined && sense.partOfSpeech !== null) {
      assertSafeLocalDataText(sense.partOfSpeech, "part of speech");
    }
    for (const value of sense.translations || []) {
      assertSafeLocalDataText(value, "translation");
    }
    for (const value of sense.domains || []) {
      assertSafeLocalDataText(value, "domain");
    }
    for (const value of sense.typeLabels || []) {
      assertSafeLocalDataText(value, "type label");
    }
    for (const ref of sense.sourceRefs || []) {
      if (!sourceIds.has(ref.sourceId)) {
        throw packError(
          PACK_ERROR_CODES.CORRUPT,
          "Local dictionary sourceRef references an undeclared source."
        );
      }
      assertSafeLocalDataText(ref.sourceId, "sourceRef sourceId");
      assertSafeLocalDataText(ref.recordId, "sourceRef recordId");
    }
  }
}

function parseRecord(bytes) {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw packError(
      PACK_ERROR_CODES.CORRUPT,
      "Local dictionary entries.dat contains invalid UTF-8 JSON.",
      { path: "entries.dat", cause: error }
    );
  }
}

async function sha256Hex(bytes, cryptoProvider) {
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
