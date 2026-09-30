import {
  assertDeclaredCuratedDictionary,
  CURATED_IMPORTER_TYPES
} from "../../shared/curated-dictionaries.js";

export async function fetchCuratedDictionarySource(
  source,
  {
    signal,
    fetchImpl = globalThis.fetch
  } = {}
) {
  const declared =
    assertDeclaredCuratedDictionary(source);
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "Curated dictionary network provider requires fetch."
    );
  }

  return fetchImpl(declared.downloadUrl, {
    method: "GET",
    cache: "no-store",
    // The reviewed ECDICT release URL redirects to GitHub's release asset
    // host. Its second exact origin is declared on that recipe and checked
    // again by the pinned ZIP extractor. Other recipes keep redirects off.
    redirect:
      declared.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1
        ? "follow"
        : "error",
    signal
  });
}
