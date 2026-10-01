import {
  assertDeclaredCuratedDictionary
} from "../../shared/curated-dictionaries.js";
import {
  getCatalogArtifactForRecipe
} from "../../shared/dictionary-catalog-v2.js";

export async function fetchCuratedDictionarySource(
  source,
  {
    signal,
    artifactId,
    fetchImpl = globalThis.fetch
  } = {}
) {
  const declared = assertDeclaredCuratedDictionary(source);
  const artifact = getCatalogArtifactForRecipe(declared, artifactId);
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "Curated dictionary network provider requires fetch."
    );
  }

  return fetchImpl(artifact.downloadUrl, {
    method: "GET",
    cache: "no-store",
    // Redirect behavior is data from the extension-owned Catalog entry. The
    // final response URL is checked against the same closed origin policy by
    // the worker/importer before any bytes are accepted.
    redirect: artifact.redirectPolicy === "browser-limited-final-origin" ? "follow" : "error",
    signal
  });
}
