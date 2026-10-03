import { READING_PROTOCOL_VERSION, READING_METHOD, READING_ERROR, READING_INVALIDATION_PORT, READING_LIMITS } from "../src/shared/reading/constants.js";
import { validateReadingRequest } from "../src/shared/reading/dto.js";
import { validateReadingResponse } from "../src/shared/reading/response.js";
import { validateReadingInvalidation } from "../src/shared/reading/invalidations.js";
import { validateResultArtifact } from "../src/shared/reading/artifact.js";
import { sameProvenLocation } from "../src/shared/reading/identity.js";

const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
if (app && !app.modules.readingContract) app.modules.readingContract = Object.freeze({
  READING_PROTOCOL_VERSION, READING_METHOD, READING_ERROR, READING_INVALIDATION_PORT, READING_LIMITS,
  validateReadingRequest, validateReadingResponse, validateReadingInvalidation, validateResultArtifact, sameProvenLocation
});
