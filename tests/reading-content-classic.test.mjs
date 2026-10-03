import test from "node:test";
import assert from "node:assert/strict";
import { checkReadingContentClassic } from "../scripts/reading-content-classic.mjs";
import { CONTENT_SCRIPT_FILES } from "../src/shared/constants.js";

test("Reading classic runtime projections are current single-source minified bundles", async () => {
  await checkReadingContentClassic();
  for (const file of ["src/content/reading-source.js", "src/content/reading-record.js"]) assert(CONTENT_SCRIPT_FILES.includes(file));
  for (const source of ["src/content/selection/source-snapshot.js", "src/content/reading-anchor-resolver.js", "src/content/selection/record-access.js",
    "src/content/selection/record-client.js", "src/content/selection/handoff-client.js", "src/content/reading-return-card.js"]) assert(!CONTENT_SCRIPT_FILES.includes(source));
});
