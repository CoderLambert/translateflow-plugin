import {
  LOCAL_IMPORT_SEMANTIC_PROFILE, LOCAL_IMPORT_DISTRIBUTION_STATUS,
  LOCAL_IMPORT_SOURCE_ID, LOCAL_IMPORT_LICENSE_ID
} from "./local-import.js";
import { basePreflightResult, LOCAL_DICTIONARY_PREFLIGHT_LIMITS,
  cleanDisplayText, isPreflightAbort, preflightAbortError, readPreflightBytes,
  reason } from "./local-dictionary-preflight-contract.js";

const TFLEX_FILES = new Set(["manifest.json", "index.dat", "entries.dat"]);
const TFLEX_REQUIRED_PROFILE = Object.freeze({
  format: "tflex", formatVersion: 1, readerMinVersion: 1,
  normalizationVersion: 1, profile: "opfs-indexed-v1",
  distributionStatus: LOCAL_IMPORT_DISTRIBUTION_STATUS,
  semanticProfile: LOCAL_IMPORT_SEMANTIC_PROFILE,
  sourceLanguage: "en", targetLanguage: "zh-CN"
});

export async function preflightTflexFiles({ files, sourceBytes, signal }) {
  const selected = files.filter((file) => TFLEX_FILES.has(file.name.toLocaleLowerCase("en-US")));
  if (!selected.length) return null;
  const unassociatedFiles = files.filter((file) => !selected.includes(file));
  const names = new Set(selected.map((file) => file.name.toLocaleLowerCase("en-US")));
  if (names.size !== selected.length) {
    return basePreflightResult({
      family: "tflex",
      files,
      sourceBytes,
      status: "invalid",
      reason: reason("tflex.duplicate_component")
    });
  }
  const manifestFile = selected.find((file) => file.name.toLocaleLowerCase("en-US") === "manifest.json");
  if (!manifestFile) {
    return basePreflightResult({
      family: "tflex",
      files,
      sourceBytes,
      status: "partial",
      reason: reason("tflex.manifest_missing"),
      route: { importer: "tflex", requiresSemanticConfirmation: false },
      unassociatedFiles,
      missingCompanionHints: ["manifest.json"]
    });
  }
  if (manifestFile.size > LOCAL_DICTIONARY_PREFLIGHT_LIMITS.tflexManifestBytes) {
    return basePreflightResult({
      family: "tflex",
      files,
      sourceBytes,
      status: "unsupported",
      reason: reason("tflex.manifest_too_large"),
      route: { importer: "none", requiresSemanticConfirmation: false }
    });
  }

  let manifest;
  try {
    const bytes = await readPreflightBytes(manifestFile, signal, LOCAL_DICTIONARY_PREFLIGHT_LIMITS.tflexManifestBytes);
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (isPreflightAbort(error, signal)) throw preflightAbortError();
    return basePreflightResult({
      family: "tflex",
      files,
      sourceBytes,
      status: "invalid",
      reason: reason("tflex.manifest_invalid"),
      route: { importer: "none", requiresSemanticConfirmation: false }
    });
  }
  if (!isSupportedTflexManifest(manifest)) {
    return basePreflightResult({
      family: "tflex",
      files,
      sourceBytes,
      status: "unsupported",
      displayTitle: manifest?.packId,
      reason: reason("tflex.profile_unsupported"),
      route: { importer: "none", requiresSemanticConfirmation: false }
    });
  }
  const missing = ["index.dat", "entries.dat"].filter((name) => !names.has(name));
  const identityHints = [
    {
      kind: "tflex-pack-identity",
      packId: cleanDisplayText(manifest.packId).slice(0, 120),
      packVersion: cleanDisplayText(manifest.packVersion).slice(0, 80),
      verified: false,
      verification: "unverified"
    },
    ...(typeof manifest.fingerprint === "string" && /^sha256:[a-f0-9]{64}$/iu.test(manifest.fingerprint)
      ? [{
        kind: "tflex-declared-fingerprint",
        value: manifest.fingerprint.toLowerCase(),
        verified: false,
        verification: "unverified"
      }]
      : [])
  ];
  return basePreflightResult({
    family: "tflex",
    files,
    sourceBytes,
    status: "partial",
    displayTitle: manifest.packId,
    entryCount: manifest.recordCount,
    reason: missing.length ? reason("tflex.required_files_missing") : reason("tflex.full_validation_deferred"),
    warnings: [
      ...(!missing.length ? [reason("tflex.importer_verifies_hashes_and_records")] : []),
      ...(unassociatedFiles.length ? [reason("tflex.unassociated_files")] : [])
    ],
    route: { importer: "tflex", requiresSemanticConfirmation: false },
    missingCompanionHints: missing,
    unassociatedFiles,
    identity: { hints: identityHints }
  });
}

function isSupportedTflexManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  return Object.entries(TFLEX_REQUIRED_PROFILE).every(([key, value]) => manifest[key] === value) &&
    manifest.license?.id === LOCAL_IMPORT_LICENSE_ID &&
    manifest.license?.source === LOCAL_IMPORT_SOURCE_ID &&
    typeof manifest.packId === "string" && manifest.packId.startsWith("local-") &&
    typeof manifest.packVersion === "string" && Number.isSafeInteger(manifest.recordCount) && manifest.recordCount > 0;
}
