import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "../src/shared/hash.js";
import { validateResultArtifact } from "../src/shared/reading/artifact.js";
import { createReadingService } from "../src/background/reading-record/service.js";
import { groundLearningAssistant } from "../src/background/selection/assistant-grounding.js";
import { extensionSender, nativeBrowser, repositoryDouble } from "./fixtures/reading/access.mjs";
import { artifact, record, snapshot, RECORD_ID } from "./fixtures/reading/contract.mjs";

const detail = { record: record({ revision: 2 }), snapshots: [snapshot()], artifacts: [artifact(), artifact("assistant")] };
const input = { recordId: RECORD_ID, recordRevision: 2, sourceSnapshotId: "source-1", targetTurnId: "turn-1",
  historyAction: "follow-up", question: "Why?" };
const sender = extensionSender({ tab: { id: 9, incognito: false } });

test("learning assistant operation binds the native learning-center, stored revision/source and APPEND_ASSISTANT transaction", async () => {
  let written = null; const browser = nativeBrowser();
  const repository = repositoryDouble({
    async readAssistantTarget({ assertCurrent }) { assertCurrent(); return { detail: { ...detail, record: { ...detail.record, safeReturnUrl: null } }, siteKey: "https://example.test",
      documentGeneration: "doc-1", siteExcluded: false }; },
    async mutate(context) { context.assertCurrent(); assert.equal(context.artifactDigest,
      await sha256(JSON.stringify(validateResultArtifact(context.request.artifact)))); written = context.request;
      browser.runtime.getContexts = async () => []; return { state: "saved", recordId: RECORD_ID,
      revision: 3, artifactId: context.request.artifact.artifactId, duplicate: false }; }
  });
  const service = createReadingService({ browser, repository });
  const prepared = await service.prepareAssistantTurn(sender, input, value => groundLearningAssistant(value, input, () => "next"));
  assert.deepEqual(prepared.routingIdentity, { siteKey: "https://example.test", pageKey: detail.record.pageKey });
  assert.equal(prepared.record.safeReturnUrl, null);
  const payload = { ...prepared.grounded.turn, assistantAnswer: "Grounded answer", completionStatus: "completed" };
  const result = await service.commitAssistantTurn(prepared.session, { schemaVersion: 1, artifactId: "artifact-next",
    kind: "assistant", targetLanguage: "zh-CN", createdAt: 2000, payload,
    provenance: { provider: "mock", model: "mock", promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" } });
  assert.equal(result.saved.revision, 3); assert.equal(written.method, "reading.append-assistant");
  assert.equal(written.artifact.recordId, RECORD_ID); assert.equal(written.artifact.sourceSnapshotId, "source-1");
  assert.equal(written.artifact.payload.parentTurnId, "turn-1");
});

test("stale history revision is rejected before operation preparation", async () => {
  let prepared = 0;
  const repository = repositoryDouble({
    async readAssistantTarget({ assertCurrent }) { assertCurrent(); return { detail, siteKey: "https://example.test",
      documentGeneration: "doc-1", siteExcluded: false }; },
    async prepareOperation(context) { prepared++; return repositoryDouble().prepareOperation(context); }
  });
  const service = createReadingService({ browser: nativeBrowser(), repository });
  await assert.rejects(() => service.prepareAssistantTurn(sender, { ...input, recordRevision: 1 }, value => groundLearningAssistant(value, input)), error => error.code === "READING_REVISION_CONFLICT");
  assert.equal(prepared, 0);
});

test("the in-memory signal crosses service and repository boundaries but never enters the artifact DTO", async () => {
  const browser = nativeBrowser(), seen = [];
  const repository = repositoryDouble({
    async readAssistantTarget(context) { seen.push(["read", context.signal]); context.assertCurrent(); return { detail,
      siteKey: "https://example.test", documentGeneration: "doc-1", siteExcluded: false }; },
    async prepareOperation(context) { seen.push(["prepare", context.signal]); return repositoryDouble().prepareOperation(context); },
    async mutate(context) { seen.push(["mutate", context.signal]); context.assertCurrent();
      assert.equal(Object.hasOwn(context.request, "signal"), false);
      assert.equal(Object.hasOwn(context.request.artifact, "signal"), false);
      return { state: "saved", recordId: RECORD_ID, revision: 3, artifactId: context.request.artifact.artifactId, duplicate: false }; }
  });
  const service = createReadingService({ browser, repository });
  const controller = new AbortController();
  const prepared = await service.prepareAssistantTurn(sender, input,
    value => groundLearningAssistant(value, input, () => "next"), { signal: controller.signal });
  const payload = { ...prepared.grounded.turn, assistantAnswer: "Grounded answer", completionStatus: "completed" };
  await service.commitAssistantTurn(prepared.session, { schemaVersion: 1, artifactId: "artifact-signaled", kind: "assistant",
    targetLanguage: "zh-CN", createdAt: 2000, payload,
    provenance: { provider: "mock", model: "mock", promptVersion: "selection-assistant-v1", providerConfigFingerprint: "opaque" } },
  { signal: controller.signal });
  assert.deepEqual(seen.map(([phase]) => phase), ["read", "prepare", "mutate"]);
  assert.ok(seen.every(([, signal]) => signal === controller.signal));
});
