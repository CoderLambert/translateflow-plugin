import test from "node:test";
import assert from "node:assert/strict";

import {
  DICTIONARY_CATALOG_V2,
  DICTIONARY_CATALOG_IMPORTER_ADAPTERS,
  assertCatalogArtifactResponseUrl,
  assertDeclaredDictionaryCatalogEntry,
  assertRequiredCapabilities,
  getCatalogPermissionOrigins,
  getDictionaryCatalogEntry,
  getDictionaryCatalogEntryForRecipe,
  getMissingRequiredCapabilities,
  makeInstalledCatalogMetadata,
  migrateCuratedRecipeV1State,
  migrateLegacyCuratedDisplayMetadata,
  validateDictionaryCatalogEntry,
  validateInstalledCatalogMetadata
} from "../src/shared/dictionary-catalog-v2.js";
import { getCuratedDictionary } from "../src/shared/curated-dictionaries.js";
import { fetchCuratedDictionarySource } from "../src/background/providers/curated-dictionary-network.js";
import { requestDictionaryPackOriginPermission } from "../src/options/pack-ui.js";
import {
  makeCuratedRichMdictProvenance,
  publicRichDictionary
} from "../src/background/packs/rich-mdict-contract.js";

const [csv, mdx] = DICTIONARY_CATALOG_V2;

test("Catalog v2 declares both ECDICT artifacts with separate version and content dates", () => {
  assert.equal(DICTIONARY_CATALOG_V2.length, 2);
  assert.equal(csv.schemaVersion, 2);
  assert.equal(csv.trustClass, "curated-upstream");
  assert.equal(csv.source.redistributionMode, "direct-upstream-user-triggered");
  assert.equal(csv.version.sourceVersion, "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b");
  assert.equal(csv.version.releaseDate, null);
  assert.equal(csv.version.contentDate, null);
  assert.equal(csv.version.reviewedAt, "2026-10-01");
  assert.equal(csv.artifacts[0].downloadUrl, "https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.csv");

  assert.equal(mdx.version.sourceVersion, "1.0.28");
  assert.equal(mdx.version.releaseDate, "2017-09-20");
  assert.equal(mdx.version.contentDate, "2017-06-03");
  assert.equal(mdx.version.reviewedAt, "2026-10-01");
  assert.equal(mdx.artifacts[0].expectedBytes, 97_755_340);
  assert.equal(mdx.artifacts[0].integrity.sha256, "b06a72a0cfc37485a0466ee62fb43137559ea75eea147d8b7715142faca2229f");
  assert.equal(mdx.importer.adapterId, DICTIONARY_CATALOG_IMPORTER_ADAPTERS.REVIEWED_RICH_MDX_ZIP_V1);
  assert.equal(mdx.compatibility.status, "reviewed-compatible");
  assert.equal(mdx.knownLimitations.some((item) => /2017-06-03/u.test(item.description)), true);
});

test("Catalog v2 validates exact artifact origins, redirects, sizes, hashes and archive limits", () => {
  assert.equal(validateDictionaryCatalogEntry(mdx).id, mdx.id);

  const pathOrigin = clone(mdx);
  pathOrigin.artifacts[0].allowedOrigins[0] = "https://github.com/releases";
  assert.throws(() => validateDictionaryCatalogEntry(pathOrigin), /exact HTTPS origins/u);

  const foreignRedirect = clone(mdx);
  foreignRedirect.artifacts[0].redirectOrigins.push("https://attacker.example");
  assert.throws(() => validateDictionaryCatalogEntry(foreignRedirect), /declared exact HTTPS origins/u);

  const oversized = clone(mdx);
  oversized.artifacts[0].expectedBytes = oversized.artifacts[0].maxBytes + 1;
  assert.throws(() => validateDictionaryCatalogEntry(oversized), /byte limits/u);

  const malformedHash = clone(mdx);
  malformedHash.artifacts[0].integrity.sha256 = "abc";
  assert.throws(() => validateDictionaryCatalogEntry(malformedHash), /integrity lock/u);

  const badArchive = clone(mdx);
  badArchive.artifacts[0].archiveRules.nestedArchives = 1;
  assert.throws(() => validateDictionaryCatalogEntry(badArchive), /archive limits/u);

  const unboundCompanion = clone(mdx);
  unboundCompanion.artifacts[0].associationRules = {
    companionArtifactId: "missing-mdd",
    required: true,
    filenameRule: "same-stem"
  };
  assert.throws(() => validateDictionaryCatalogEntry(unboundCompanion), /association rules are invalid/u);

  const hashLockDrift = clone(mdx);
  hashLockDrift.artifacts[0].integrity.sha256 = "a".repeat(64);
  assert.throws(() => assertDeclaredDictionaryCatalogEntry(hashLockDrift), /not declared/u);
});

test("artifact URL checks allow only its exact URL or the declared final redirect origin", () => {
  assert.equal(assertCatalogArtifactResponseUrl(mdx.id, mdx.artifacts[0].downloadUrl, { artifactId: "ecdict-mdx-zip" }), true);
  assert.equal(assertCatalogArtifactResponseUrl(mdx.id, "https://release-assets.githubusercontent.com/asset", { redirected: true, artifactId: "ecdict-mdx-zip" }), true);
  assert.throws(
    () => assertCatalogArtifactResponseUrl(mdx.id, "https://attacker.example/asset", { redirected: true, artifactId: "ecdict-mdx-zip" }),
    (error) => error.code === "CATALOG_REDIRECT_ORIGIN"
  );
  assert.throws(
    () => assertCatalogArtifactResponseUrl(csv.id, "https://raw.githubusercontent.com/skywind3000/ECDICT/other/ecdict.csv", { artifactId: "ecdict-csv-source" }),
    (error) => error.code === "CATALOG_REDIRECT_ORIGIN"
  );
  assert.throws(
    () => assertCatalogArtifactResponseUrl(mdx.id, "https://github.com/elsewhere", { redirected: true, artifactId: "ecdict-mdx-zip" }),
    (error) => error.code === "CATALOG_REDIRECT_ORIGIN"
  );
  assert.throws(
    () => assertCatalogArtifactResponseUrl(mdx.id, mdx.artifacts[0].downloadUrl),
    (error) => error.code === "CATALOG_ARTIFACT"
  );
  assert.throws(
    () => assertCatalogArtifactResponseUrl(mdx.id, mdx.artifacts[0].downloadUrl, { artifactId: "missing" }),
    (error) => error.code === "CATALOG_ARTIFACT"
  );
  assert.deepEqual(getCatalogPermissionOrigins(mdx), [
    "https://github.com/*",
    "https://release-assets.githubusercontent.com/*"
  ]);
});

test("install permission and network redirect behavior come from the catalog artifact", async () => {
  const mdxRecipe = getCuratedDictionary("ecdict-en-zh-mdx-curated");
  const permissionCalls = [];
  assert.equal(await requestDictionaryPackOriginPermission(mdxRecipe, {
    async request(value) {
      permissionCalls.push(value);
      return true;
    }
  }), true);
  assert.deepEqual(permissionCalls, [{ origins: getCatalogPermissionOrigins(mdx) }]);

  const fetchCalls = [];
  await fetchCuratedDictionarySource(mdxRecipe, {
    fetchImpl(url, options) {
      fetchCalls.push({ url, options });
      return { ok: true };
    }
  });
  assert.equal(fetchCalls[0].url, mdx.artifacts[0].downloadUrl);
  assert.equal(fetchCalls[0].options.redirect, "follow");

  const csvRecipe = getCuratedDictionary("ecdict-en-zh-curated");
  await fetchCuratedDictionarySource(csvRecipe, {
    fetchImpl(url, options) {
      fetchCalls.push({ url, options });
      return { ok: true };
    }
  });
  assert.equal(fetchCalls[1].options.redirect, "error");
});

test("required capability failure is typed and current ECDICT MDX requirements pass", () => {
  assert.equal(assertRequiredCapabilities(mdx), true);
  assert.deepEqual(getMissingRequiredCapabilities(mdx, ["mdx.engine.v2"]), [
    "mdx.encoding.utf8",
    "mdx.encryption.key-info-v2",
    "mdx.key-info.compression-zlib",
    "mdx.compression.zlib",
    "mdx.record.html",
    "mdx.style-sheet",
    "mdx.compact-records"
  ]);
  assert.throws(
    () => assertRequiredCapabilities(mdx, ["mdx.engine.v2"]),
    (error) => error.code === "CATALOG_CAPABILITY_MISSING" &&
      error.details.missingCapabilities.includes("mdx.compact-records")
  );

  const unsupported = clone(mdx);
  unsupported.requiredCapabilities.push("mdx.compression.lzo");
  assert.equal(validateDictionaryCatalogEntry(unsupported).requiredCapabilities.at(-1), "mdx.compression.lzo");
  assert.throws(
    () => assertRequiredCapabilities(unsupported),
    (error) => error.code === "CATALOG_CAPABILITY_MISSING"
  );
  assert.throws(() => validateDictionaryCatalogEntry({ ...clone(mdx), requiredCapabilities: ["mdx.remote-script"] }), /unknown or duplicate/u);
});

test("closed adapter ids, trust labels, and reviewed-version update policy fail closed", () => {
  const arbitraryAdapter = clone(csv);
  arbitraryAdapter.importer.adapterId = "https://example.test/importer.js";
  assert.throws(() => validateDictionaryCatalogEntry(arbitraryAdapter), /not extension-owned/u);

  const latestFollow = clone(csv);
  latestFollow.updatePolicy.followLatest = true;
  assert.throws(() => validateDictionaryCatalogEntry(latestFollow), /reviewed versions only/u);

  const falselyOfficial = clone(csv);
  falselyOfficial.trustClass = "official";
  assert.throws(() => validateDictionaryCatalogEntry(falselyOfficial), /approved redistribution mode/u);
  assert.equal(csv.trustClass, "curated-upstream");
  assert.notEqual(makeInstalledCatalogMetadata(csv).trustClass, "official");
  assert.equal(makeInstalledCatalogMetadata(mdx, { installedVersion: "import-mgj2xio0-12345678" }).installedVersion, "import-mgj2xio0-12345678");

  const unknownRecipe = clone(csv);
  unknownRecipe.importer.recipeId = "remote-recipe-v9";
  assert.equal(validateDictionaryCatalogEntry(unknownRecipe).importer.recipeId, "remote-recipe-v9");
  assert.throws(() => assertDeclaredDictionaryCatalogEntry(unknownRecipe), /not declared/u);
  assert.throws(() => makeInstalledCatalogMetadata("remote-recipe-v9"), /not extension-declared/u);
});

test("Catalog v2 can declare an MDX to MDD companion set as inert metadata", () => {
  const bundle = clone(mdx);
  bundle.artifacts.push({
    id: "mdx-main",
    kind: "mdx",
    downloadUrl: "https://github.com/example/dictionary.mdx",
    allowedOrigins: ["https://github.com"],
    redirectOrigins: [],
    redirectPolicy: "none",
    expectedBytes: 1024,
    maxBytes: 1024,
    integrity: null,
    filename: "dictionary.mdx",
    archiveRules: null,
    associationRules: {
      companionArtifactId: "mdd-resources",
      required: true,
      filenameRule: "same-stem"
    }
  }, {
    id: "mdd-resources",
    kind: "mdd",
    downloadUrl: "https://github.com/example/dictionary.mdd",
    allowedOrigins: ["https://github.com"],
    redirectOrigins: [],
    redirectPolicy: "none",
    expectedBytes: 2048,
    maxBytes: 2048,
    integrity: null,
    filename: "dictionary.mdd",
    archiveRules: null,
    associationRules: null
  });
  bundle.updatePolicy.reviewedVersions[0].artifactIds.push("mdx-main", "mdd-resources");
  const normalized = validateDictionaryCatalogEntry(bundle);
  assert.equal(normalized.artifacts.find((item) => item.id === "mdx-main").associationRules.companionArtifactId, "mdd-resources");
  assert.equal(normalized.artifacts.find((item) => item.id === "mdd-resources").kind, "mdd");
});

test("v1 installed state receives a deterministic v2 projection without changing installed identity", () => {
  const legacyDisplay = {
    kind: "curated-upstream",
    format: "ecdict-csv",
    sourceVersion: "bc015ed2e24a"
  };
  const migratedDisplay = migrateLegacyCuratedDisplayMetadata(legacyDisplay);
  assert.equal(migratedDisplay.entryId, csv.id);
  assert.equal(migratedDisplay.sourceVersion, csv.version.sourceVersion);
  assert.equal(migratedDisplay.installedVersion, "2025-03-28-bc015ed2");
  assert.equal(migratedDisplay.reviewedAt, "2026-10-01");
  assert.equal(validateInstalledCatalogMetadata(migratedDisplay).entryId, csv.id);

  const oldRichState = {
    recipeId: "ecdict-en-zh-mdx-curated",
    packId: "rich-mdict-18500000-0000-4000-8000-000000000028",
    packVersion: "import-mgj2xio0-12345678",
    enabled: false,
    order: 2048
  };
  const migratedRich = migrateCuratedRecipeV1State(oldRichState);
  assert.equal(migratedRich.migrated, true);
  assert.equal(migratedRich.catalog.entryId, mdx.id);
  assert.equal(migratedRich.catalog.installedVersion, oldRichState.packVersion);
  assert.equal(migratedRich.value, oldRichState);
  assert.equal(migratedRich.value.packId, oldRichState.packId);
  assert.equal(migratedRich.value.enabled, false);
  assert.equal(migratedRich.value.order, 2048);

  assert.equal(migrateCuratedRecipeV1State({ recipeId: "unknown-v1-recipe" }).migrated, false);
  assert.equal(getDictionaryCatalogEntry(csv.id), csv);
  assert.equal(getDictionaryCatalogEntryForRecipe("ecdict-en-zh-mdx-curated"), mdx);
});

test("legacy rich MDX provenance projects catalog metadata without claiming Official", () => {
  const provenance = makeCuratedRichMdictProvenance("ecdict-en-zh-mdx-curated");
  const dictionary = publicRichDictionary({
    status: "ready",
    active: {
      packId: "rich-mdict-18500000-0000-4000-8000-000000000028",
      packVersion: "import-mgj2xio0-12345678",
      curated: provenance
    }
  });
  assert.equal(dictionary.catalog.entryId, mdx.id);
  assert.equal(dictionary.catalog.contentDate, "2017-06-03");
  assert.equal(dictionary.catalog.installedVersion, "import-mgj2xio0-12345678");
  assert.equal(dictionary.catalog.trustClass, "curated-upstream");
  assert.notEqual(dictionary.catalog.trustClass, "official");
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
