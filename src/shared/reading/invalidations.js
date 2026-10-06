import { READING_PROTOCOL_VERSION as V, READING_SITE_MARKERS_INVALIDATION } from "./constants.js";
import { choice, object, protocolVersion } from "./validation.js";
import { revision } from "./list.js";

export function validateReadingInvalidation(value, scope) {
  choice(scope, ["content", "extension"], "invalidation.scope");
  const localRevision = scope === "content" ? "pageRevision" : "catalogRevision";
  object(value, ["protocolVersion", "type", localRevision, "dataGeneration", "consentGeneration"], "invalidation");
  protocolVersion(value.protocolVersion, "invalidation.protocolVersion");
  return { protocolVersion: V, type: choice(value.type, ["reading.invalidate"], "invalidation.type"),
    [localRevision]: revision(value[localRevision], `invalidation.${localRevision}`),
    dataGeneration: revision(value.dataGeneration, "invalidation.dataGeneration"),
    consentGeneration: revision(value.consentGeneration, "invalidation.consentGeneration") };
}

// Site marker consent lives in extension settings, not the reading database. Keep its
// signal separate so subscribers refresh without inventing a catalog/data revision.
export function validateReadingSiteMarkersInvalidation(value) {
  object(value, ["protocolVersion", "type"], "siteMarkersInvalidation");
  protocolVersion(value.protocolVersion, "siteMarkersInvalidation.protocolVersion");
  return { protocolVersion: V, type: choice(value.type, [READING_SITE_MARKERS_INVALIDATION], "siteMarkersInvalidation.type") };
}
