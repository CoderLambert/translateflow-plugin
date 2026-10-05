import test from "node:test";
import assert from "node:assert/strict";
import { READING_ERROR as E } from "../src/shared/reading/constants.js";
import { createReadingPreviewRegistry, READING_PREVIEW_TTL } from "../src/background/reading-record/previews.js";

const owner = { scope: "content", incognito: false, documentGeneration: "doc-generation", nativeDocumentId: "11111111-1111-4111-8111-111111111111",
  ownerKey: "content:7:11111111-1111-4111-8111-111111111111", tabId: 7, authorityGeneration: 1, navigationGeneration: 1,
  pageKey: `rp1:${"a".repeat(64)}`, siteKey: "https://example.test" };
const target = { recordId: "22222222-2222-4222-8222-222222222222", revision: 3, pageKey: owner.pageKey, siteKey: owner.siteKey,
  dataGeneration: 1, consentGeneration: 1, pageGeneration: 1, pageRevision: 4, sitePolicyRevision: 2 };
const frame = (overrides = {}) => ({ tabId: 7, frameId: 5, documentId: "33333333-3333-4333-8333-333333333333",
  documentUrl: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/reading-preview.html?previewId=preview-1", contextId: "44444444-4444-4444-8444-444444444444", ...overrides });
const rejected = (operation, code = E.FORBIDDEN) => assert.throws(operation, error => error.code === code);

test("Preview registry binds one claimed extension document to its owner and refuses copies", () => {
  let now = 1_000, ids = 0;
  const registry = createReadingPreviewRegistry({ now: () => now, randomId: () => `preview-${++ids}` });
  const created = registry.create({ access: owner, target });
  const trueFrame = frame({ documentUrl: `chrome-extension://${"a".repeat(32)}/reading-preview.html?previewId=${created.previewId}` });
  const sibling = frame({ frameId: 6, documentId: "55555555-5555-4555-8555-555555555555", contextId: "66666666-6666-4666-8666-666666666666",
    documentUrl: trueFrame.documentUrl });
  const claim = registry.claim(created.previewId, trueFrame);
  const siblingClaim = registry.claim(created.previewId, sibling);
  rejected(() => registry.forFrame(created.previewId, trueFrame));
  assert.deepEqual(registry.bind(owner, created.previewId, claim.claimId), { bound: true });
  assert.equal(registry.forFrame(created.previewId, trueFrame).recordRevision, target.revision);
  rejected(() => registry.forFrame(created.previewId, sibling));
  rejected(() => registry.bind(owner, created.previewId, siblingClaim.claimId));
  rejected(() => registry.bind(owner, created.previewId, claim.claimId));
});

test("Preview owner and frame identity, one-shot expiry, and bounded sessions are enforced", () => {
  let now = 1_000, ids = 0;
  const registry = createReadingPreviewRegistry({ now: () => now, randomId: () => `session-${++ids}` });
  const created = registry.create({ access: owner, target });
  const value = frame({ documentUrl: `chrome-extension://${"a".repeat(32)}/reading-preview.html?previewId=${created.previewId}` });
  const claim = registry.claim(created.previewId, value);
  rejected(() => registry.bind({ ...owner, tabId: 8 }, created.previewId, claim.claimId));
  rejected(() => registry.bind({ ...owner, navigationGeneration: 2 }, created.previewId, claim.claimId));
  now += READING_PREVIEW_TTL.unclaimedMs;
  assert.equal(registry.get(created.previewId), null);
  assert.equal(registry.size, 0);
});
