import test from "node:test";
import assert from "node:assert/strict";
import { abortSelectionAssistantStreams, handleSelectionAssistantStreamPort } from "../src/background/selection/assistant-stream.js";
const PORT = "selection.assistant-stream";

function port(overrides = {}) {
  let message, disconnect; const sent = [];
  return { name: PORT, sender: { id: "ext", url: "https://example.test/article", documentId: "doc-1", frameId: 0, tab: { id: 7, incognito: false }, ...overrides }, sent,
    onMessage: { addListener(fn) { message = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } },
    postMessage(value) { sent.push(value); }, disconnect() { disconnect?.(); }, emit(value) { message?.(value); } };
}
function historyPort() {
  return port({ url: "chrome-extension://ext/learning-center.html", documentId: "22222222-2222-4222-8222-222222222222",
    tab: { id: 9, incognito: false } });
}
const input = { protocolVersion: 1, type: "start", requestId: "stream-1", text: "session", pageUrl: "https://example.test/article", context: null, depth: "standard",
  action: "understand", threadId: "thread-1", turnId: "turn-1", parentTurnId: null, branchId: "branch-1", regenerationOf: null };
const deps = { resolveSelectionRequest: async () => ({ explanationInput: { selectionText: "session", contextText: "", candidates: [] } }),
  getEffectiveConfig: async () => ({ provider: "openai-compatible", streaming: true }),
  readingTranslationResult: async () => ({ targetLanguage: "zh-CN", provenance: { provider: "openai-compatible", model: "mock",
    promptVersion: "old", providerConfigFingerprint: "f".repeat(64) } }),
  completeText: async (_input, _config, { onDelta }) => { onDelta("hello "); onDelta("world"); return { text: "hello world", mode: "stream" }; } };

test("assistant stream port binds one sender/request and emits ordered real deltas", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = port();
  assert.equal(handleSelectionAssistantStreamPort(p, deps), true); p.emit(input); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(p.sent.map(value => value.type), ["started", "delta", "delta", "complete"]);
  assert.deepEqual(p.sent.filter(value => value.type === "delta").map(value => [value.sequence, value.text]), [[0, "hello "], [1, "world"]]);
  assert.equal(p.sent.at(-1).text, "hello world"); p.emit(input);
  assert.deepEqual(p.sent.find(value => value.type === "complete").turn, { userQuestion: "这里是什么意思？", assistantAnswer: "hello world", action: "understand",
    threadId: "thread-1", turnId: "turn-1", parentTurnId: null, branchId: "branch-1", regenerationOf: null, completionStatus: "completed" });
  assert.equal(p.sent.at(-1).type, "interrupted"); assert.equal(p.sent.at(-1).code, "BAD_REQUEST");
});

test("grounded turn shapes allow finite follow-up and root regeneration but reject graph edits", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  for (const value of [
    { ...input, requestId: "follow", action: "follow-up", question: "Why here?", turnId: "turn-2", parentTurnId: "turn-1", history: [{ turnId: "turn-1", question: "q", answer: "a" }] },
    { ...input, requestId: "regen", turnId: "turn-3", branchId: "branch-2", regenerationOf: "turn-1" }
  ]) { const p = port(); handleSelectionAssistantStreamPort(p, deps); p.emit(value); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(p.sent.at(-1).type, "complete"); }
  for (const value of [{ ...input, action: "follow-up", question: "x", parentTurnId: null }, { ...input, regenerationOf: "turn-1", parentTurnId: "turn-0" }, { ...input, action: "unknown" }]) {
    const p = port(); handleSelectionAssistantStreamPort(p, deps); p.emit(value); assert.equal(p.sent.at(-1).code, "BAD_REQUEST");
  }
});

test("explicit cancel and disconnect abort the owned completion without a late complete", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = port(); let aborted = false;
  const waiting = { ...deps, completeText: (_input, _config, { signal, onDelta }) => new Promise((resolve, reject) => {
    onDelta("partial"); signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" })); });
  }) };
  handleSelectionAssistantStreamPort(p, waiting); p.emit(input);
  while (!p.sent.some(value => value.type === "delta")) await new Promise(resolve => setTimeout(resolve, 0));
  p.emit({ type: "cancel", requestId: "stream-1" }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(aborted, true); assert.equal(p.sent.some(value => value.type === "complete"), false);
  assert.equal(p.sent.at(-1).type, "interrupted"); assert.equal(p.sent.at(-1).partialChars, 7);
});

test("invalid or non-top-level senders fail closed before Provider work", () => {
  globalThis.chrome = { runtime: { id: "ext" } }; for (const override of [{ id: "other" }, { frameId: 1 }, { tab: { id: 7, incognito: true } }, { url: "chrome-extension://ext/page" }]) {
    const p = port(override); assert.equal(handleSelectionAssistantStreamPort(p, deps), true); assert.equal(p.sent.length, 0);
  }
});

test("unary fallback is labeled and navigation aborts the tab-owned request", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const unary = port();
  handleSelectionAssistantStreamPort(unary, { ...deps, getEffectiveConfig: async () => ({ provider: "deepseek", streaming: false }),
    completeText: async () => ({ text: "one answer", mode: "unary" }) }); unary.emit(input); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(unary.sent.map(value => [value.type, value.mode]), [["started", "unary"], ["delta", undefined], ["complete", "unary"]]);
  const navigating = port(); let aborted = false;
  handleSelectionAssistantStreamPort(navigating, { ...deps, completeText: (_a, _b, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error(), { code: "CANCELLED" })); })) });
  navigating.emit({ ...input, requestId: "nav" }); while (!navigating.sent.length) await new Promise(resolve => setTimeout(resolve, 0));
  abortSelectionAssistantStreams(7); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(aborted, true); assert.equal(navigating.sent.at(-1).code, "CANCELLED");
});

test("learning-center history is repository-grounded and acknowledges only the committed complete turn", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = historyPort(); let committed = 0, groundedInput;
  const history = { ...deps,
    prepareLearningAssistantTurn: async (_sender, value) => { groundedInput = value; return { session: {},
      grounded: { question: "Why?", history: [{ turnId: "turn-1", question: "q", answer: "a" }], sourceSnapshotId: "source-1",
        turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "bounded-context", contextText: "Stored context" },
      record: { safeReturnUrl: "https://example.test/article", sourceLanguage: "en" } }; },
    commitLearningAssistantTurn: async (_session, artifact) => { committed++; return { artifact, saved: { state: "saved",
      recordId: "11111111-1111-4111-8111-111111111111", revision: 4, artifactId: artifact.artifactId, duplicate: false } }; },
    cancelLearningAssistantTurn: async () => {} };
  handleSelectionAssistantStreamPort(p, history); p.emit({ protocolVersion: 1, type: "start", requestId: "history-1",
    recordId: "11111111-1111-4111-8111-111111111111", recordRevision: 3, sourceSnapshotId: "source-1",
    targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(committed, 1); assert.equal(p.sent.at(-1).type, "complete"); assert.equal(p.sent.at(-1).saved.revision, 4);
  assert.equal(Object.hasOwn(groundedInput, "text"), false); assert.equal(Object.hasOwn(groundedInput, "history"), false);
});

test("learning-center stop cancels the prepared operation and never commits partial text", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = historyPort(); let committed = 0, cancelled = 0;
  const waiting = { ...deps,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" }, record: { safeReturnUrl: null, sourceLanguage: "en" } }),
    completeText: (_input, _config, { signal, onDelta }) => new Promise((_resolve, reject) => { onDelta("partial");
      signal.addEventListener("abort", () => reject(Object.assign(new Error(), { code: "CANCELLED" }))); }),
    commitLearningAssistantTurn: async () => { committed++; }, cancelLearningAssistantTurn: async () => { cancelled++; } };
  handleSelectionAssistantStreamPort(p, waiting); p.emit({ protocolVersion: 1, type: "start", requestId: "history-stop",
    recordId: "11111111-1111-4111-8111-111111111111", recordRevision: 3, sourceSnapshotId: "source-1",
    targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  while (!p.sent.some(value => value.type === "delta")) await new Promise(resolve => setTimeout(resolve, 0));
  p.emit({ type: "cancel", requestId: "history-stop" }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(committed, 0); assert.equal(cancelled, 1); assert.equal(p.sent.at(-1).type, "interrupted");
});
