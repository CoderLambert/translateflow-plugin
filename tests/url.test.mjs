import test from "node:test";
import assert from "node:assert/strict";
import { getOriginMatchPattern, normalizeOrigin, normalizeUrl } from "../src/shared/url.js";

test("normalizeUrl removes tracking params but preserves business params", () => {
  assert.equal(
    normalizeUrl("https://example.com/a?utm_source=x&id=7&gclid=abc"),
    "https://example.com/a?id=7"
  );
});

test("normalizeUrl sorts query params", () => {
  assert.equal(normalizeUrl("https://example.com/a?z=2&a=1"), "https://example.com/a?a=1&z=2");
});

test("normal hash anchors are ignored while SPA routes are retained", () => {
  assert.equal(normalizeUrl("https://example.com/a#section"), "https://example.com/a");
  assert.equal(normalizeUrl("https://example.com/a#/docs"), "https://example.com/a#/docs");
  assert.equal(normalizeUrl("https://example.com/a#!/docs"), "https://example.com/a#!/docs");
});

test("site scope intentionally ignores port for Chrome match-pattern compatibility", () => {
  assert.equal(normalizeOrigin("https://example.com:8443/path"), "https://example.com");
  assert.equal(getOriginMatchPattern("https://example.com"), "https://example.com/*");
});
