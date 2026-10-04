import test from "node:test";
import assert from "node:assert/strict";
import { contentSourceFiles } from "../scripts/content-runtime.mjs";
import { checkReadingContentClassic } from "../scripts/reading-content-classic.mjs";
import { CONTENT_SCRIPT_FILES } from "../src/shared/constants.js";

test("legacy Reading projections stay reproducible but WXT compiles their readable owners", async () => {
  await checkReadingContentClassic();
  const sources = contentSourceFiles();
  for (const file of ["src/content/reading-source.js", "src/content/reading-record.js"]) {
    assert(!CONTENT_SCRIPT_FILES.includes(file)); assert(!sources.includes(file));
  }
  for (const source of ["src/content/selection/source-snapshot.js", "src/content/reading-anchor-resolver.js", "src/content/selection/record-access.js",
    "src/content/selection/record-client.js", "src/content/selection/handoff-client.js", "src/content/reading-return-card.js", "src/content/reading-page-markers.js",
    "src/content/selection/record-status.js", "src/content/selection/ai-detail.js", "src/content/selection/popover.js", "src/content/selection/rich-details.js",
    "src/content/selection/controller.js", "src/content/quick-control-view.js", "src/content/quick-control.js"]) assert(sources.includes(source));
});
