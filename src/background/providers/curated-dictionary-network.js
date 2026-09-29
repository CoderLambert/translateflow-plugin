export async function fetchCuratedDictionarySource(
  source,
  { signal } = {}
) {
  if (
    !source ||
    typeof source.downloadUrl !== "string" ||
    !source.downloadUrl.startsWith(
      "https://raw.githubusercontent.com/"
    )
  ) {
    throw new Error(
      "Curated dictionary source URL is not an approved HTTPS upstream."
    );
  }

  return fetch(source.downloadUrl, {
    method: "GET",
    cache: "no-store",
    redirect: "error",
    signal
  });
}
