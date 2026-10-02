import { READING_PROTOCOL_VERSION as V } from "./constants.js";
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
