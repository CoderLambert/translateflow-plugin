import test from "node:test";
import assert from "node:assert/strict";
import { getCuratedInstallPresentation } from "../src/options/curated-dictionary-ui.js";
import { CURATED_DICTIONARIES } from "../src/shared/curated-dictionaries.js";

// This is a pure synthetic presentation contract, moved from a browser-side
// source-module import. Production installation/display remain native E2E.
test("older reviewed curated version offers the same update presentation", () => {
  const presentation = getCuratedInstallPresentation(CURATED_DICTIONARIES[0], {
    status: "healthy", active: { packVersion: "2024-older-reviewed" }
  });
  assert.equal(presentation.status,"update-available");
  assert.equal(presentation.badgeLabel,"有已审核更新");
  assert.equal(presentation.actionLabel,"更新");
});
