import {
  normalizeLexicalExactKey,
  normalizeLexicalKey
} from "../../../shared/lexical.js";
import { isSafePackIdentifier } from "../../../shared/pack-manager.js";
import { validateTflexRecord } from "../../lexical/tflex-integrity.js";
import {
  LOCAL_IMPORT_LICENSE_ID,
  LOCAL_IMPORT_SEMANTIC_PROFILE,
  LOCAL_IMPORT_SOURCE_ID
} from "../local-import.js";

export const MDICT_BILINGUAL_PROFILE =
  LOCAL_IMPORT_SEMANTIC_PROFILE;

export function validateMdictImportRecipe(input) {
  if (!plainObject(input)) {
    throw new Error("MDict import recipe must be an object");
  }
  if (input.schemaVersion !== 1) {
    throw new Error("MDict import recipe schemaVersion must be 1");
  }
  if (input.semanticProfile !== MDICT_BILINGUAL_PROFILE) {
    throw new Error(
      "MDict import recipe semanticProfile is unsupported"
    );
  }
  if (
    input.sourceLanguage !== "en" ||
    input.targetLanguage !== "zh-CN"
  ) {
    throw new Error(
      "MDict import recipe must explicitly declare en -> zh-CN"
    );
  }
  if (
    !isSafePackIdentifier(input.packId) ||
    !String(input.packId).startsWith("local-")
  ) {
    throw new Error(
      "MDict local import packId must be a safe local-* identifier"
    );
  }
  if (!isSafePackIdentifier(input.packVersion, 120)) {
    throw new Error("MDict local import packVersion is invalid");
  }

  const dictionary = input.dictionary;
  if (!plainObject(dictionary)) {
    throw new Error(
      "MDict import recipe dictionary metadata is required"
    );
  }
  requireText(dictionary.title, "MDict recipe title");
  if (!isSafePackIdentifier(dictionary.sourceId)) {
    throw new Error("MDict recipe sourceId is invalid");
  }
  requireText(
    dictionary.sourceVersion,
    "MDict recipe sourceVersion"
  );

  const assertions = input.assertions;
  if (
    !plainObject(assertions) ||
    assertions.plainTextRepresentsTargetTranslation !== true ||
    assertions.localUseOnly !== true
  ) {
    throw new Error(
      "MDict import requires explicit plain-text translation and local-use assertions"
    );
  }

  return {
    schemaVersion: 1,
    semanticProfile: MDICT_BILINGUAL_PROFILE,
    packId: input.packId,
    packVersion: input.packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      title: dictionary.title,
      sourceId: dictionary.sourceId,
      sourceVersion: dictionary.sourceVersion
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

export function buildMdictTflexRecords(
  entries,
  recipeInput
) {
  const recipe = validateMdictImportRecipe(recipeInput);
  const grouped = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (
      !entry ||
      typeof entry.lookupKey !== "string" ||
      normalizeLexicalKey(entry.lookupKey) !== entry.lookupKey ||
      typeof entry.displayForm !== "string" ||
      !entry.displayForm ||
      typeof entry.plainText !== "string" ||
      !entry.plainText ||
      entry.sourceRef?.sourceId !== recipe.dictionary.sourceId ||
      typeof entry.sourceRef?.recordId !== "string" ||
      !entry.sourceRef.recordId
    ) {
      throw new Error("Malformed MDict projection row");
    }

    let record = grouped.get(entry.lookupKey);
    if (!record) {
      record = {
        lookupKey: entry.lookupKey,
        exactLookupKeys: new Set(),
        displayForm: entry.displayForm,
        kind: "lexical",
        aliases: [],
        senses: []
      };
      grouped.set(entry.lookupKey, record);
    }

    const exact =
      entry.exactLookupKey ||
      normalizeLexicalExactKey(entry.displayForm);
    if (exact) record.exactLookupKeys.add(exact);
    record.senses.push({
      id: "mdict:" + entry.sourceRef.recordId,
      translations: [entry.plainText],
      domains: [],
      sourceRefs: [{ ...entry.sourceRef }]
    });
  }

  const records = [...grouped.values()]
    .map((record) => ({
      ...record,
      exactLookupKeys: [...record.exactLookupKeys]
        .sort(compareText),
      senses: [...record.senses]
    }))
    .sort((a, b) => compareText(a.lookupKey, b.lookupKey));

  let previous = "";
  for (const record of records) {
    if (previous && previous >= record.lookupKey) {
      throw new Error(
        "MDict TFLex lookup keys must be strictly ordered"
      );
    }
    validateTflexRecord(
      record,
      recipe.packId,
      "entries.dat"
    );
    previous = record.lookupKey;
  }
  return records;
}

export async function makeMdictLocalSource(
  recipeInput,
  dictionary,
  mdxBytes,
  cryptoProvider = globalThis.crypto
) {
  const recipe = validateMdictImportRecipe(recipeInput);
  if (
    !dictionary ||
    dictionary.title !== recipe.dictionary.title
  ) {
    throw new Error(
      "MDict recipe title mismatch: expected " +
        recipe.dictionary.title +
        ", got " +
        String(dictionary?.title || "")
    );
  }
  const digest = await cryptoProvider.subtle.digest(
    "SHA-256",
    mdxBytes
  );
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return {
    id: recipe.dictionary.sourceId,
    version: recipe.dictionary.sourceVersion,
    sourceFileSha256: sha256,
    provenance: [
      "User-selected MDict: " + dictionary.title,
      "MDX engine " + dictionary.generatedByEngineVersion,
      "encoding " + dictionary.encoding,
      "semantic profile explicitly confirmed by local import"
    ].join("; "),
    semanticProfile: recipe.semanticProfile,
    license: {
      id: LOCAL_IMPORT_LICENSE_ID,
      name:
        "User-provided dictionary; redistribution rights are not verified",
      source: LOCAL_IMPORT_SOURCE_ID
    }
  };
}

function plainObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + " is required");
  }
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
