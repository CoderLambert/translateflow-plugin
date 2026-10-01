import test from "node:test";
import assert from "node:assert/strict";
import { selectionContentOwnerKey } from "../src/background/router.js";

test("content owner token stays stable across same-document URL changes without documentId", () => {
  const ownerToken = "0123456789abcdef0123456789abcdef";
  const beforeRoute = {
    id: "extension-id",
    tab: { id: 7 },
    frameId: 0,
    url: "https://example.test/article/one"
  };
  const afterRoute = { ...beforeRoute, url: "https://example.test/article/two" };

  assert.equal(
    selectionContentOwnerKey(beforeRoute, { ownerToken }),
    selectionContentOwnerKey(afterRoute, { ownerToken }),
    "Chrome 102–105 sender URLs can change during a same-document SPA route"
  );
  assert.notEqual(
    selectionContentOwnerKey(afterRoute, { ownerToken }),
    selectionContentOwnerKey(afterRoute, { ownerToken: "fedcba9876543210fedcba9876543210" }),
    "a newly loaded content document receives a distinct owner token"
  );
});

test("invalid fallback owner token is rejected while Chrome documentId remains authoritative", () => {
  const sender = {
    tab: { id: 7 },
    frameId: 0,
    url: "https://example.test/article",
    documentId: "chrome-document-id"
  };

  assert.equal(
    selectionContentOwnerKey(sender, { ownerToken: "invalid" }),
    "selection:7:0:document:chrome-document-id"
  );
  assert.throws(
    () => selectionContentOwnerKey({ ...sender, documentId: undefined }, { ownerToken: "invalid" }),
    (error) => error?.code === "RICH_MDICT_CONTENT_ONLY"
  );
});
