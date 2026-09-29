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

export const STARDICT_BILINGUAL_PROFILE =
  LOCAL_IMPORT_SEMANTIC_PROFILE;
export const STARDICT_LOCAL_IMPORT_LICENSE_ID =
  LOCAL_IMPORT_LICENSE_ID;

export function validateStarDictImportRecipe(input) {
  if (!plainObject(input)) {
    throw new Error("StarDict import recipe must be an object");
  }
  if (input.schemaVersion !== 1) {
    throw new Error(
      "StarDict import recipe schemaVersion must be 1"
    );
  }
  if (input.semanticProfile !== STARDICT_BILINGUAL_PROFILE) {
    throw new Error(
      "StarDict import recipe semanticProfile is unsupported"
    );
  }
  if (
    input.sourceLanguage !== "en" ||
    input.targetLanguage !== "zh-CN"
  ) {
    throw new Error(
      "StarDict import recipe must explicitly declare en -> zh-CN"
    );
  }
  if (
    !isSafePackIdentifier(input.packId) ||
    !String(input.packId).startsWith("local-")
  ) {
    throw new Error(
      "StarDict local import packId must be a safe local-* identifier"
    );
  }
  if (!isSafePackIdentifier(input.packVersion, 120)) {
    throw new Error(
      "StarDict local import packVersion is invalid"
    );
  }

  const dictionary = input.dictionary;
  if (!plainObject(dictionary)) {
    throw new Error(
      "StarDict import recipe dictionary metadata is required"
    );
  }
  requireText(
    dictionary.bookname,
    "StarDict recipe bookname"
  );
  if (!isSafePackIdentifier(dictionary.sourceId)) {
    throw new Error("StarDict recipe sourceId is invalid");
  }
  requireText(
    dictionary.sourceVersion,
    "StarDict recipe sourceVersion"
  );

  const assertions = input.assertions;
  if (
    !plainObject(assertions) ||
    assertions.plainTextRepresentsTargetTranslation !== true ||
    assertions.localUseOnly !== true
  ) {
    throw new Error(
      "StarDict import recipe requires explicit plain-text translation and local-use assertions"
    );
  }

  return {
    schemaVersion: 1,
    semanticProfile: STARDICT_BILINGUAL_PROFILE,
    packId: input.packId,
    packVersion: input.packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      bookname: dictionary.bookname,
      sourceId: dictionary.sourceId,
      sourceVersion: dictionary.sourceVersion
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

export function buildStarDictTflexRecords(
  entries,
  recipeInput
) {
  const recipe = validateStarDictImportRecipe(recipeInput);
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
      throw new Error("Malformed StarDict projection row");
    }

    let record = grouped.get(entry.lookupKey);
    if (!record) {
      record = {
        lookupKey: entry.lookupKey,
        exactLookupKeys: new Set(),
        displayForm: entry.displayForm,
        kind: "lexical",
        aliases: new Set(),
        senses: []
      };
      grouped.set(entry.lookupKey, record);
    }

    const exact = normalizeLexicalExactKey(entry.displayForm);
    if (exact) record.exactLookupKeys.add(exact);
    if (
      entry.aliases !== undefined &&
      !Array.isArray(entry.aliases)
    ) {
      throw new Error("Malformed StarDict projection aliases");
    }
    for (const alias of entry.aliases || []) {
      const aliasKey =
        typeof alias === "string"
          ? normalizeLexicalKey(alias)
          : "";
      if (!alias || !aliasKey) {
        throw new Error("Malformed StarDict projection alias");
      }
      if (aliasKey !== entry.lookupKey) {
        record.aliases.add(alias);
      }
    }

    record.senses.push({
      id: "stardict:" + entry.sourceRef.recordId,
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
      aliases: [...record.aliases].sort(compareText),
      senses: [...record.senses]
    }))
    .sort((a, b) => compareText(a.lookupKey, b.lookupKey));

  let previous = "";
  for (const record of records) {
    if (previous && previous >= record.lookupKey) {
      throw new Error(
        "StarDict TFLex lookup keys must be strictly ordered"
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

export function makeStarDictLocalSource(
  recipeInput,
  dictionary
) {
  const recipe = validateStarDictImportRecipe(recipeInput);
  if (
    !dictionary ||
    dictionary.bookname !== recipe.dictionary.bookname
  ) {
    throw new Error(
      "StarDict recipe bookname mismatch: expected " +
        recipe.dictionary.bookname +
        ", got " +
        String(dictionary?.bookname || "")
    );
  }
  return {
    id: recipe.dictionary.sourceId,
    version: recipe.dictionary.sourceVersion,
    provenance: [
      "User-selected StarDict: " + dictionary.bookname,
      "StarDict format " + dictionary.version,
      "semantic profile explicitly declared by local import recipe"
    ].join("; "),
    semanticProfile: recipe.semanticProfile,
    license: {
      id: STARDICT_LOCAL_IMPORT_LICENSE_ID,
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
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(label + " is required");
  }
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}
