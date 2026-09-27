export const OPTIONAL_PACK_SOURCES = Object.freeze([
  // Release sources are added only after their pack-specific provenance/license gate passes.
]);

export function getOptionalPackSource(sourceId, sources = OPTIONAL_PACK_SOURCES) {
  const id = String(sourceId || "").trim();
  return (Array.isArray(sources) ? sources : []).find((source) => source?.id === id) || null;
}
