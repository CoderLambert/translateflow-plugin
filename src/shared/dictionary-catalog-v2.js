import {
  DICTIONARY_CATALOG_ARTIFACT_KINDS,
  DICTIONARY_CATALOG_IMPORTER_ADAPTERS,
  DICTIONARY_CATALOG_ROLES,
  DICTIONARY_CATALOG_SCHEMA_VERSION,
  DICTIONARY_CATALOG_TRUST_CLASSES,
  DICTIONARY_RUNTIME_CAPABILITIES,
  SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES,
  validateDictionaryCatalogEntry
} from "./dictionary-catalog-v2-schema.js";
import {
  catalogError,
  deepFreeze,
  requireExactKeys,
  requireHttpsUrl,
  sameJsonValue
} from "./dictionary-catalog-v2-utils.js";

export {
  DICTIONARY_CATALOG_ARTIFACT_KINDS,
  DICTIONARY_CATALOG_IMPORTER_ADAPTERS,
  DICTIONARY_CATALOG_ROLES,
  DICTIONARY_CATALOG_SCHEMA_VERSION,
  DICTIONARY_CATALOG_TRUST_CLASSES,
  DICTIONARY_RUNTIME_CAPABILITIES,
  SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES,
  validateDictionaryCatalogEntry
};

import { CURATED_DICTIONARIES } from "./curated-dictionaries.js";
import {
  makeEcdictCsvEntry,
  makeEcdictMdxEntry
} from "./dictionary-catalog-v2-entries.js";

const CSV_RECIPE_ID = "ecdict-en-zh-curated";
const MDX_RECIPE_ID = "ecdict-en-zh-mdx-curated";

const recipesById = new Map(CURATED_DICTIONARIES.map((recipe) => [recipe.id, recipe]));

const entries = [
  makeEcdictCsvEntry(recipesById.get(CSV_RECIPE_ID)),
  makeEcdictMdxEntry(recipesById.get(MDX_RECIPE_ID))
].map((entry) => deepFreeze(validateDictionaryCatalogEntry(entry)));

export const DICTIONARY_CATALOG_V2 = Object.freeze(entries);

const entriesById = new Map(DICTIONARY_CATALOG_V2.map((entry) => [entry.id, entry]));
const entriesByRecipeId = new Map(
  DICTIONARY_CATALOG_V2.map((entry) => [entry.importer.recipeId, entry])
);

export function getDictionaryCatalogEntry(id) {
  return entriesById.get(String(id || "")) || null;
}

export function getDictionaryCatalogEntryForRecipe(recipeId) {
  return entriesByRecipeId.get(String(recipeId || "")) || null;
}

export function assertDeclaredDictionaryCatalogEntry(entryOrId) {
  const id = typeof entryOrId === "string" ? entryOrId : entryOrId?.id;
  const declared = getDictionaryCatalogEntry(id);
  if (!declared || (typeof entryOrId === "object" && entryOrId !== declared)) {
    throw new Error("Dictionary catalog entry is not declared by this extension.");
  }
  return declared;
}

export function getMissingRequiredCapabilities(entryOrId, capabilities = SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES) {
  const entry = typeof entryOrId === "string"
    ? assertDeclaredDictionaryCatalogEntry(entryOrId)
    : validateDictionaryCatalogEntry(entryOrId);
  const available = new Set(Array.isArray(capabilities) ? capabilities : []);
  return entry.requiredCapabilities.filter((id) => !available.has(id));
}

export function assertRequiredCapabilities(entryOrId, capabilities = SHIPPED_DICTIONARY_RUNTIME_CAPABILITIES) {
  const missing = getMissingRequiredCapabilities(entryOrId, capabilities);
  if (missing.length) {
    const error = catalogError(
      "CATALOG_CAPABILITY_MISSING",
      "This dictionary requires unsupported runtime capabilities: " + missing.join(", ")
    );
    error.details = { missingCapabilities: missing };
    throw error;
  }
  return true;
}

export function getCatalogPermissionOrigins(entryOrRecipe) {
  const entry = resolveCatalogEntry(entryOrRecipe);
  assertRequiredCapabilities(entry);
  const origins = new Set();
  for (const artifact of entry.artifacts) {
    for (const origin of artifact.allowedOrigins) origins.add(origin + "/*");
  }
  return [...origins];
}

export function getCatalogArtifactForRecipe(recipeOrId, artifactId) {
  const entry = resolveCatalogEntry(recipeOrId);
  const artifact = artifactId
    ? entry.artifacts.find((item) => item.id === artifactId)
    : entry.artifacts[0];
  if (!artifact) throw catalogError("CATALOG_ARTIFACT", "Dictionary recipe has no matching catalog artifact.");
  return artifact;
}

/**
 * Fetch exposes only the final response URL for followed redirects in this
 * extension context; it does not expose hop count or each intermediate URL.
 * The contract therefore makes no per-recipe hop-count claim. The browser's
 * finite redirect ceiling applies, while the extension grants only declared
 * origins and accepts bytes only from the declared final origin.
 */
export function assertCatalogArtifactResponseUrl(recipeOrId, responseUrl, { redirected = false, artifactId } = {}) {
  if (!artifactId) {
    throw catalogError("CATALOG_ARTIFACT", "Catalog response validation requires an explicit artifact id.");
  }
  const entry = resolveCatalogEntry(recipeOrId);
  const artifact = getCatalogArtifactForRecipe(entry.id, artifactId);
  const url = requireHttpsUrl(responseUrl || artifact.downloadUrl, "final artifact URL");
  const origin = url.origin;
  if (!redirected && url.href !== artifact.downloadUrl) {
    throw catalogError("CATALOG_REDIRECT_ORIGIN", "Curated dictionary download did not remain on the locked artifact URL.");
  }
  if (!artifact.allowedOrigins.includes(origin)) {
    throw catalogError("CATALOG_REDIRECT_ORIGIN", "Curated dictionary download did not remain on the locked artifact URL or declared redirect origins.");
  }
  if (redirected && !artifact.redirectOrigins.includes(origin)) {
    throw catalogError("CATALOG_REDIRECT_ORIGIN", "Dictionary download redirect was not declared for this artifact.");
  }
  if (redirected && artifact.redirectPolicy !== "browser-limited-final-origin") {
    throw catalogError("CATALOG_REDIRECT_LIMIT", "Dictionary artifact does not permit redirects.");
  }
  return true;
}

export function makeInstalledCatalogMetadata(entryOrRecipe, { installedVersion } = {}) {
  const entry = resolveCatalogEntry(entryOrRecipe);
  const knownVersion = knownInstalledVersion(entry);
  const actualInstalledVersion = String(installedVersion || knownVersion || "");
  if (knownVersion && actualInstalledVersion !== knownVersion) {
    throw catalogError("CATALOG_INSTALLED_METADATA", "Installed dictionary version does not match the extension-owned reviewed recipe.");
  }
  if (!actualInstalledVersion || actualInstalledVersion.length > 120 || /[\u0000-\u001f\u007f]/u.test(actualInstalledVersion)) {
    throw catalogError("CATALOG_INSTALLED_METADATA", "Installed dictionary version must be recorded separately from its upstream source version.");
  }
  return Object.freeze({
    schemaVersion: DICTIONARY_CATALOG_SCHEMA_VERSION,
    entryId: entry.id,
    role: entry.role,
    language: {
      sourceLanguage: entry.language.sourceLanguage,
      targetLanguages: [...entry.language.targetLanguages],
      directionLabel: entry.language.directionLabel,
      locale: entry.language.locale,
      script: entry.language.script
    },
    trustClass: entry.trustClass,
    installedVersion: actualInstalledVersion,
    sourceVersion: entry.version.sourceVersion,
    releaseDate: entry.version.releaseDate,
    contentDate: entry.version.contentDate,
    reviewedAt: entry.version.reviewedAt,
    compatibility: {
      status: entry.compatibility.status,
      contractVersion: entry.compatibility.contractVersion
    },
    licenseLabel: entry.source.licenseLabel,
    redistributionMode: entry.source.redistributionMode
  });
}

export function validateInstalledCatalogMetadata(value, { entryId, installedVersion } = {}) {
  requireExactKeys(value, [
    "schemaVersion", "entryId", "role", "language", "trustClass", "installedVersion", "sourceVersion",
    "releaseDate", "contentDate", "reviewedAt", "compatibility", "licenseLabel",
    "redistributionMode"
  ], "installed catalog metadata");
  const entry = assertDeclaredDictionaryCatalogEntry(entryId || value.entryId);
  const expected = makeInstalledCatalogMetadata(entry, {
    installedVersion: installedVersion || value.installedVersion
  });
  if (!sameJsonValue(value, expected)) {
    throw catalogError("CATALOG_INSTALLED_METADATA", "Installed dictionary catalog metadata does not match the extension-owned catalog entry.");
  }
  return expected;
}

/**
 * Non-destructive v1 migration. Old installs remain usable and keep their
 * active pack and preference IDs; callers may add the returned metadata to a
 * public projection without rewriting OPFS or requesting a download.
 */
export function migrateCuratedRecipeV1State(value, { recipeId, installedVersion } = {}) {
  const id = String(recipeId || value?.recipeId || value?.catalog?.recipeId || "");
  const entry = getDictionaryCatalogEntryForRecipe(id);
  if (!entry) return { migrated: false, value };
  const actualVersion = installedVersion || value?.installedVersion || value?.packVersion;
  let catalog;
  try {
    catalog = makeInstalledCatalogMetadata(entry, { installedVersion: actualVersion });
  } catch {
    return { migrated: false, value, reason: "installed-version-unavailable" };
  }
  return {
    migrated: true,
    catalog,
    value
  };
}

export function migrateLegacyCuratedDisplayMetadata(value, { installedVersion } = {}) {
  if (!value || value.kind !== "curated-upstream" || value.format !== "ecdict-csv") return null;
  const entry = getDictionaryCatalogEntryForRecipe(CSV_RECIPE_ID);
  return entry ? makeInstalledCatalogMetadata(entry, { installedVersion }) : null;
}

function resolveCatalogEntry(entryOrRecipe) {
  if (typeof entryOrRecipe === "string") {
    const byId = getDictionaryCatalogEntry(entryOrRecipe);
    const byRecipe = getDictionaryCatalogEntryForRecipe(entryOrRecipe);
    if (byId || byRecipe) return byId || byRecipe;
  }
  const id = entryOrRecipe?.id;
  const declaredRecipe = recipesById.get(String(id || ""));
  if (declaredRecipe && declaredRecipe === entryOrRecipe) {
    return assertDeclaredDictionaryCatalogEntry(getDictionaryCatalogEntryForRecipe(declaredRecipe.id));
  }
  if (entriesById.get(String(id || "")) === entryOrRecipe) {
    return entryOrRecipe;
  }
  throw new Error("Dictionary catalog source is not extension-declared.");
}

function knownInstalledVersion(entry) {
  const recipe = recipesById.get(entry.importer.recipeId);
  return recipe?.output?.packVersion || "";
}
