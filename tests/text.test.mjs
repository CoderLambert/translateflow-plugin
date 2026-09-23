import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceText } from "../src/shared/text.js";

test("normalizeSourceText makes whitespace-only DOM changes cache-stable", () => {
  assert.equal(normalizeSourceText("Hello\n   world\t!"), "Hello world !");
});
