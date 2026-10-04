import test from "node:test";
import assert from "node:assert/strict";
import { groundLearningAssistant } from "../src/background/selection/assistant-grounding.js";
import { READING_ERROR as E } from "../src/shared/reading/constants.js";
import { artifact, record, snapshot, RECORD_ID } from "./fixtures/reading/contract.mjs";

function detail() {
  const root = artifact("assistant", { artifactId: "assistant-root", createdAt: 1001 });
  const follow = artifact("assistant", { artifactId: "assistant-follow", createdAt: 1002,
    payload: { ...root.payload, userQuestion: "Why?", assistantAnswer: "Because.", action: "follow-up",
      turnId: "turn-2", parentTurnId: "turn-1" } });
  return { record: record({ revision: 3 }), snapshots: [snapshot()], artifacts: [artifact(), root, follow] };
}
const request = { recordId: RECORD_ID, recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-2",
  historyAction: "follow-up", question: "What next?" };

test("history follow-up is derived from the stored completed branch, not caller text or graph IDs", () => {
  const grounded = groundLearningAssistant(detail(), request, () => "new-id");
  assert.deepEqual(grounded.history.map(value => value.turnId), ["turn-1", "turn-2"]);
  assert.deepEqual(grounded.turn, { userQuestion: "What next?", action: "follow-up", threadId: "thread-1",
    turnId: "turn-new-id", parentTurnId: "turn-2", branchId: "branch-1", regenerationOf: null });
  assert.equal(JSON.stringify(grounded).includes("forged body"), false);
});

test("root regeneration creates a new branch while stale revision/source and follow-up regeneration fail closed", () => {
  let next = 0;
  const regenerated = groundLearningAssistant(detail(), { ...request, targetTurnId: "turn-1", historyAction: "regenerate", question: undefined },
    () => String(++next));
  assert.equal(regenerated.turn.action, "understand"); assert.equal(regenerated.turn.parentTurnId, null);
  assert.equal(regenerated.turn.regenerationOf, "turn-1"); assert.notEqual(regenerated.turn.branchId, "branch-1");
  for (const input of [{ ...request, recordRevision: 2 }, { ...request, sourceSnapshotId: "source-forged" },
    { ...request, historyAction: "regenerate" }]) {
    assert.throws(() => groundLearningAssistant(detail(), input), error => [E.REVISION_CONFLICT, E.STALE_OPERATION, E.BAD_DTO].includes(error.code));
  }
});
