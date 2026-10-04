import { READING_PROTOCOL_VERSION, READING_METHOD, READING_ERROR, READING_INVALIDATION_PORT, READING_LIMITS } from "../shared/reading/constants.js";
import { validateReadingRequest } from "../shared/reading/dto.js";
import { validateReadingResponse } from "../shared/reading/response.js";
import { validateReadingInvalidation } from "../shared/reading/invalidations.js";
import { validateResultArtifact } from "../shared/reading/artifact.js";
import { sameProvenLocation } from "../shared/reading/identity.js";

const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
if (app && !app.modules.readingContract) app.modules.readingContract = Object.freeze({
  READING_PROTOCOL_VERSION, READING_METHOD, READING_ERROR, READING_INVALIDATION_PORT, READING_LIMITS,
  validateReadingRequest, validateReadingResponse, validateReadingInvalidation, validateResultArtifact, sameProvenLocation
});
