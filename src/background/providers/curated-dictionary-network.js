import {
  assertDeclaredCuratedDictionary
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
    redirect: "error",
    signal
  });
}
