import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  StarDictImportError,
  decodeStarDictUtf8,
  requireStarDictAtMost,
  starDictBytes,
  starDictFail,
  starDictUtf8Bytes
} from "./stardict-contract.js";
import {
  parseStarDictDictzipHeader,
  parseStarDictIndex,
  parseStarDictSynonyms
} from "./stardict-binary.js";

const IFO_HEADER = "StarDict's dict ifo file";
const SUPPORTED_VERSIONS = new Set(["2.4.2", "3.0.0"]);
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]*>/i;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export {
  STARDICT_IMPORT_ERROR,
  STARDICT_IMPORT_LIMITS,
  StarDictImportError,
  parseStarDictDictzipHeader,
  parseStarDictIndex,
  parseStarDictSynonyms
};

export function projectStarDictPlainText({
  ifoText,
  idxBytes,
  dictBytes,
  synBytes,
  sourceId = "user-stardict",
  sourceVersion = "local-import",
  limits = STARDICT_IMPORT_LIMITS
} = {}) {
  requireSafeSourceId(sourceId);
  requireText(sourceVersion, "sourceVersion");
  const dictionary = parseStarDictIfo(ifoText, limits);
  const idx = starDictBytes(idxBytes, "IDX");
  const dict = starDictBytes(dictBytes, "DICT");
  requireStarDictAtMost(idx.byteLength, limits.idxBytes, "IDX bytes");
  requireStarDictAtMost(dict.byteLength, limits.dictBytes, "DICT bytes");

  if (dictionary.idxfilesize !== idx.byteLength) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict idxfilesize does not match the selected .idx bytes.",
      {
        expected: dictionary.idxfilesize,
        actual: idx.byteLength
      }
    );
  }

  const index = parseStarDictIndex(idx, {
    wordCount: dictionary.wordcount,
    dictBytes: dict.byteLength,
    limits
  });
  const aliases = parseStarDictSynonyms(synBytes, {
    synonymCount: dictionary.synwordcount,
    wordCount: dictionary.wordcount,
    limits
  });
  const aliasesByTarget = new Map();
  for (const alias of aliases) {
    const list = aliasesByTarget.get(alias.targetIndex) || [];
    list.push(alias.word);
    aliasesByTarget.set(alias.targetIndex, list);
  }

  const entries = index.map((item, indexPosition) => {
    const payload = dict.subarray(item.offset, item.offset + item.size);
    const plainText = sanitizePlainText(
      decodeStarDictUtf8(payload, "dictionary entry"),
      limits,
      item.word
    );
    const entryAliases = aliasesByTarget.get(indexPosition) || [];
    return {
      lookupKey: normalizeLexicalKey(item.word),
      exactLookupKey: normalizeLexicalExactKey(item.word),
      displayForm: item.word,
      plainText,
      ...(entryAliases.length ? { aliases: [...entryAliases] } : {}),
      sourceRef: {
        sourceId,
        recordId: "idx:" + (indexPosition + 1)
      }
    };
  });

  return {
    dictionary: {
      bookname: dictionary.bookname,
      version: dictionary.version,
      wordcount: dictionary.wordcount,
      idxfilesize: dictionary.idxfilesize,
      synwordcount: dictionary.synwordcount,
      sametypesequence: dictionary.sametypesequence
    },
    entries,
    policy: {
      semanticStatus: "unclassified-plain-text",
      runtimeStatus: "build-test-only",
      contentMode: "text-only",
      richMarkup: "rejected",
      networkResources: "never-rendered",
      tflexMapping: "not-yet-approved"
    },
    unsupportedFeatures: [
      "64-bit index offsets",
      "rich StarDict field types",
      "embedded/renderable markup",
      "resource bundles"
    ]
  };
}

export function parseStarDictIfo(
  input,
  limits = STARDICT_IMPORT_LIMITS
) {
  const source = String(input || "");
  requireStarDictAtMost(
    starDictUtf8Bytes(source),
    limits.ifoBytes,
    "IFO bytes"
  );
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.shift() !== IFO_HEADER) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict .ifo header is missing or invalid."
    );
  }

  const fields = Object.create(null);
  for (const raw of lines) {
    if (!raw) continue;
    const equal = raw.indexOf("=");
    if (equal <= 0) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "Malformed StarDict .ifo field."
      );
    }
    const key = raw.slice(0, equal).trim();
    const value = raw.slice(equal + 1);
    if (
      !/^[a-z][a-z0-9_]*$/i.test(key) ||
      Object.hasOwn(fields, key)
    ) {
      starDictFail(
        STARDICT_IMPORT_ERROR.CORRUPT,
        "Duplicate or invalid StarDict .ifo key.",
        { key }
      );
    }
    fields[key] = value;
  }

  if (!SUPPORTED_VERSIONS.has(fields.version)) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Unsupported StarDict format version.",
      { version: fields.version || null }
    );
  }
  requireText(fields.bookname, "StarDict bookname");
  const wordcount = positiveInteger(
    fields.wordcount,
    "StarDict wordcount"
  );
  const idxfilesize = positiveInteger(
    fields.idxfilesize,
    "StarDict idxfilesize"
  );
  requireStarDictAtMost(
    wordcount,
    limits.entryCount,
    "StarDict wordcount"
  );
  requireStarDictAtMost(
    idxfilesize,
    limits.idxBytes,
    "StarDict idxfilesize"
  );

  if (
    fields.idxoffsetbits !== undefined &&
    fields.idxoffsetbits !== "32"
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "64-bit StarDict index offsets are not supported by this POC."
    );
  }
  const synwordcount = fields.synwordcount === undefined
    ? 0
    : nonNegativeInteger(
      fields.synwordcount,
      "StarDict synwordcount"
    );
  requireStarDictAtMost(
    synwordcount,
    limits.synonymCount,
    "StarDict synwordcount"
  );
  if (fields.sametypesequence !== "m") {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSUPPORTED,
      "Only UTF-8 plain-text StarDict sametypesequence=m is supported.",
      { sametypesequence: fields.sametypesequence || null }
    );
  }

  return {
    version: fields.version,
    bookname: fields.bookname,
    wordcount,
    idxfilesize,
    synwordcount,
    sametypesequence: fields.sametypesequence
  };
}

export function sanitizePlainText(
  value,
  limits = STARDICT_IMPORT_LIMITS,
  headword = ""
) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "StarDict entry is empty.",
      { headword }
    );
  }
  if (CONTROL.test(text)) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "StarDict entry contains unsafe control characters.",
      { headword }
    );
  }
  if (HTML_LIKE.test(text)) {
    starDictFail(
      STARDICT_IMPORT_ERROR.UNSAFE_CONTENT,
      "Renderable markup is rejected by the StarDict POC.",
      { headword }
    );
  }
  requireStarDictAtMost(
    starDictUtf8Bytes(text),
    limits.entryBytes,
    "StarDict sanitized entry bytes"
  );
  return text;
}

function requireSafeSourceId(value) {
  const text = String(value || "");
  if (
    !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/i.test(text)
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      "sourceId is invalid."
    );
  }
}

function requireText(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " is required."
    );
  }
  return value;
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(String(value || ""))) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " must be a positive integer."
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " must be a positive safe integer."
    );
  }
  return number;
}

function nonNegativeInteger(value, label) {
  if (!/^\d+$/.test(String(value ?? ""))) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " must be a non-negative integer."
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    starDictFail(
      STARDICT_IMPORT_ERROR.CORRUPT,
      label + " must be a non-negative safe integer."
    );
  }
  return number;
}
