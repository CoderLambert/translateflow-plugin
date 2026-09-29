import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS,
  MDictCursor,
  mdictBytes,
  mdictFail,
  requireMdictAtMost,
  requireMdictSafeSourceId,
  requireMdictText
} from "./mdict-contract.js";
import {
  decodeMdictText,
  parseMdictHeader,
  sanitizeMdictRecord
} from "./mdict-metadata.js";
import {
  readMdictKeySection
} from "./mdict-key-section.js";
import {
  readMdictRecordSection
} from "./mdict-record-section.js";

export {
  MDICT_IMPORT_ERROR,
  MDICT_IMPORT_LIMITS
} from "./mdict-contract.js";

export async function projectMdictV2PlainText({
  mdxBytes,
  sourceId = "user-mdict",
  sourceVersion = "local-import",
  limits = MDICT_IMPORT_LIMITS,
  decompressionStreamFactory
} = {}) {
  requireMdictSafeSourceId(sourceId);
  requireMdictText(sourceVersion, "sourceVersion");

  const file = mdictBytes(mdxBytes, "MDX");
  requireMdictAtMost(
    file.byteLength,
    limits.fileBytes,
    "MDX bytes"
  );
  const cursor = new MDictCursor(file);
  const header = parseMdictHeader(cursor, limits);

  const keySection = await readMdictKeySection({
    cursor,
    header,
    limits,
    ...(decompressionStreamFactory
      ? { decompressionStreamFactory }
      : {})
  });
  const recordSection = await readMdictRecordSection({
    cursor,
    numEntries: keySection.numEntries,
    limits,
    ...(decompressionStreamFactory
      ? { decompressionStreamFactory }
      : {})
  });

  const entries = keySection.keys.map((item, index) => {
    const start = item.recordOffset;
    const end = index + 1 < keySection.keys.length
      ? keySection.keys[index + 1].recordOffset
      : recordSection.recordBytes.byteLength;

    if (
      start < 0 ||
      start > end ||
      end > recordSection.recordBytes.byteLength
    ) {
      mdictFail(
        MDICT_IMPORT_ERROR.CORRUPT,
        "MDict key points outside the record stream.",
        {
          headword: item.displayForm,
          start,
          end,
          recordBytes:
            recordSection.recordBytes.byteLength
        }
      );
    }
    requireMdictAtMost(
      end - start,
      limits.entryBytes,
      "MDict record bytes"
    );

    const plainText = sanitizeMdictRecord(
      decodeMdictRecord(
        recordSection.recordBytes.subarray(start, end),
        header.encoding
      ),
      item.displayForm,
      limits
    );
    return {
      lookupKey: normalizeLexicalKey(item.displayForm),
      exactLookupKey:
        normalizeLexicalExactKey(item.displayForm),
      displayForm: item.displayForm,
      plainText,
      sourceRef: {
        sourceId,
        recordId: "entry:" + (index + 1)
      }
    };
  });

  return {
    dictionary: {
      title: header.title,
      generatedByEngineVersion:
        header.generatedByEngineVersion,
      requiredEngineVersion:
        header.requiredEngineVersion,
      encoding: header.encoding.name,
      format: header.format,
      entryCount: keySection.numEntries
    },
    entries,
    blocks: {
      keyBlocks: keySection.numKeyBlocks,
      recordBlocks: recordSection.numRecordBlocks,
      keyCompression: keySection.compression,
      recordCompression: recordSection.compression,
      decompressedRecordBytes:
        recordSection.recordBytes.byteLength
    },
    policy: {
      semanticStatus: "unclassified-plain-text",
      runtimeStatus: "local-import-candidate",
      contentMode: "text-only",
      htmlRendering: "rejected",
      compactStyles: "rejected",
      mddResources: "not-loaded",
      networkResources: "never-rendered",
      tflexMapping: "explicit-recipe-only"
    },
    unsupportedFeatures: [
      "MDX 1.x and 3.x",
      "encrypted MDX",
      "LZO-compressed blocks",
      "GBK/Big5 text encodings",
      "Compact/StyleSheet presentation transforms",
      "HTML/renderable record markup",
      "MDX @@@LINK redirects",
      ".mdd resources"
    ]
  };
}

function decodeMdictRecord(input, encoding) {
  let bytes = mdictBytes(input, "MDict record");
  while (bytes.byteLength >= encoding.unitBytes) {
    const tail = bytes.subarray(
      bytes.byteLength - encoding.unitBytes
    );
    if (![...tail].every((value) => value === 0)) break;
    bytes = bytes.subarray(
      0,
      bytes.byteLength - encoding.unitBytes
    );
  }
  return decodeMdictText(
    bytes,
    encoding,
    "MDict record"
  );
}
