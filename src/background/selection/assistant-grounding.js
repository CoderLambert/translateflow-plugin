import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { validateRecordDetail } from "../../shared/reading/record.js";
import { choice, fail, id, integer, recordId, text } from "../../shared/reading/validation.js";

export const ASSISTANT_ROOT_QUESTIONS = Object.freeze({
  understand: "这里是什么意思？",
  analyze: "拆解这里的表达。",
  usage: "这里的用法是什么？"
});

export function groundLearningAssistant(detailValue, input, randomId = () => crypto.randomUUID()) {
  const detail = validateRecordDetail(detailValue), expectedId = recordId(input.recordId, "assistant.recordId");
  const expectedRevision = integer(input.recordRevision, 1, Number.MAX_SAFE_INTEGER, "assistant.recordRevision");
  const sourceSnapshotId = id(input.sourceSnapshotId, "assistant.sourceSnapshotId");
  const targetTurnId = id(input.targetTurnId, "assistant.targetTurnId");
  const historyAction = choice(input.historyAction, ["follow-up", "regenerate"], "assistant.historyAction");
  if (detail.record.recordId !== expectedId || detail.record.revision !== expectedRevision) fail(E.REVISION_CONFLICT, "assistant.record");
  const turns = new Map(detail.artifacts.filter(value => value.kind === "assistant" && value.payload.completionStatus === "completed")
    .map(value => [value.payload.turnId, value]));
  const target = turns.get(targetTurnId);
  if (!target || target.sourceSnapshotId !== sourceSnapshotId || !detail.snapshots.some(value => value.sourceSnapshotId === sourceSnapshotId)) {
    fail(E.STALE_OPERATION, "assistant.target");
  }
  let question, action, parentTurnId, branchId, regenerationOf, history = [];
  if (historyAction === "follow-up") {
    question = text(input.question, L.questionChars, "assistant.question"); action = "follow-up";
    parentTurnId = target.payload.turnId; branchId = target.payload.branchId; regenerationOf = null;
    let current = target;
    while (current && history.length < 6) {
      history.unshift({ turnId: current.payload.turnId, question: current.payload.userQuestion, answer: current.payload.assistantAnswer });
      current = current.payload.parentTurnId ? turns.get(current.payload.parentTurnId) : null;
    }
  } else {
    if (target.payload.parentTurnId !== null || !Object.hasOwn(ASSISTANT_ROOT_QUESTIONS, target.payload.action)) fail(E.BAD_DTO, "assistant.regeneration");
    question = ASSISTANT_ROOT_QUESTIONS[target.payload.action]; action = target.payload.action;
    parentTurnId = null; regenerationOf = target.payload.turnId;
    branchId = unique("branch", new Set([...turns.values()].map(value => value.payload.branchId)), randomId);
  }
  const turnId = unique("turn", new Set(turns.keys()), randomId);
  return { sourceSnapshotId, history, question,
    turn: { userQuestion: question, action, threadId: target.payload.threadId, turnId, parentTurnId, branchId, regenerationOf } };
}

function unique(prefix, used, randomId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const value = `${prefix}-${randomId()}`;
    if (!used.has(value)) return id(value, `assistant.${prefix}Id`);
  }
  fail(E.CAPACITY, `assistant.${prefix}Id`);
}
