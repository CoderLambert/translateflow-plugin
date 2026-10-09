import test from "node:test";
import assert from "node:assert/strict";
import { abortSelectionAssistantStreams, handleSelectionAssistantStreamPort } from "../src/background/selection/assistant-stream.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";
import { createChatGPTPlanProvider } from "../src/background/providers/chatgpt-plan.js";
import { createNativeMessagingClient } from "../src/background/providers/native-messaging.js";
const PORT = "selection.assistant-stream";

function port(overrides = {}) {
  let message, disconnect; const sent = [], sentListeners = new Set();
  return { name: PORT, sender: { id: "ext", url: "https://example.test/article", documentId: "doc-1", frameId: 0, tab: { id: 7, incognito: false }, ...overrides }, sent,
    onMessage: { addListener(fn) { message = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } },
    postMessage(value) { sent.push(value); for (const listener of sentListeners) listener(value); },
    whenSent(predicate) { const existing = sent.find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise(resolve => { const listener = value => { if (predicate(value)) { sentListeners.delete(listener); resolve(value); } }; sentListeners.add(listener); }); },
    disconnect() { disconnect?.(); }, emit(value) { message?.(value); } };
}
function historyPort() {
  return port({ url: "chrome-extension://ext/learning-center.html", documentId: "22222222-2222-4222-8222-222222222222",
    tab: { id: 9, incognito: false } });
}
const input = { protocolVersion: 1, type: "start", requestId: "stream-1", text: "session", pageUrl: "https://example.test/article", context: null, depth: "standard",
  action: "understand", threadId: "thread-1", turnId: "turn-1", parentTurnId: null, branchId: "branch-1", regenerationOf: null };
const deps = { resolveSelectionRequest: async () => ({ explanationInput: { selectionText: "session", contextText: "", candidates: [] } }),
  getEffectiveConfig: async () => ({ provider: "openai-compatible", streaming: true }),
  getEffectiveConfigForSite: async () => ({ provider: "openai-compatible", streaming: true }),
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

test("explicit CJK assistant action streams bounded page context after a local-only miss", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = port({ url: "https://example.test/article", tab: { id: 7, incognito: false } });
  const visibleContext = "記事では弁護士が地域の相談窓口を案内していた。";
  let providerPrompt;
  let providerCalls = 0;
  const config = { provider: "openai-compatible", streaming: false, targetLanguage: "Simplified Chinese" };
  const resolverDeps = {
    getConfig: async () => ({ targetLanguage: "Simplified Chinese", selectionExplanationDepth: "auto" }),
    getEffectiveConfig: async () => config,
    runLexicalLookup: async () => {
      throw new Error("CJK rich-dictionary text must not use the English lexical index");
    }
  };
  handleSelectionAssistantStreamPort(p, {
    resolveSelectionRequest: input => resolveSelectionRequest(input, resolverDeps),
    getEffectiveConfig: async () => config,
    readingTranslationResult: async () => ({ targetLanguage: "Simplified Chinese", provenance: { provider: "mock", model: "test", promptVersion: "p", providerConfigFingerprint: "f".repeat(64) } }),
    completeText: async input => {
      providerCalls += 1;
      providerPrompt = JSON.parse(input.prompt);
      return { text: "此处指律师。", mode: "unary" };
    }
  });
  p.emit({ ...input, requestId: "cjk-stream-explain", text: "弁護士", context: { text: visibleContext, source: "visible-local", sensitive: false } });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(providerCalls, 1);
  assert.equal(providerPrompt.text, "弁護士");
  assert.equal(providerPrompt.context, visibleContext);
  assert.deepEqual(providerPrompt.candidates, []);
  assert.equal(p.sent.at(-1).type, "complete");
});

test("explicit assistant stream sanitizes request context when resolver omits explanation details", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = port();
  const visibleContext = "この記事では弁護士が地域の相談窓口を案内していた。";
  let providerPrompt;
  handleSelectionAssistantStreamPort(p, {
    resolveSelectionRequest: async () => ({ intent: { sourceLanguage: "ja" }, explanationInput: null }),
    getEffectiveConfig: async () => ({ provider: "openai-compatible", streaming: false, targetLanguage: "Simplified Chinese" }),
    readingTranslationResult: async () => ({ targetLanguage: "Simplified Chinese", provenance: { provider: "mock", model: "test", promptVersion: "p", providerConfigFingerprint: "f".repeat(64) } }),
    completeText: async input => {
      providerPrompt = JSON.parse(input.prompt);
      return { text: "此处指律师。", mode: "unary" };
    }
  });
  p.emit({ ...input, requestId: "cjk-stream-context-fallback", text: "弁護士", context: { text: visibleContext, source: "visible-local", sensitive: false } });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(providerPrompt.text, "弁護士");
  assert.equal(providerPrompt.context, visibleContext);
  assert.equal(p.sent.at(-1).type, "complete");
});

test("explicit assistant stream context fallback still excludes sensitive surroundings", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = port();
  let providerPrompt;
  handleSelectionAssistantStreamPort(p, {
    resolveSelectionRequest: async () => ({ intent: { sourceLanguage: "ja" }, explanationInput: null }),
    getEffectiveConfig: async () => ({ provider: "openai-compatible", streaming: false, targetLanguage: "Simplified Chinese" }),
    readingTranslationResult: async () => ({ targetLanguage: "Simplified Chinese", provenance: { provider: "mock", model: "test", promptVersion: "p", providerConfigFingerprint: "f".repeat(64) } }),
    completeText: async input => {
      providerPrompt = JSON.parse(input.prompt);
      return { text: "回答", mode: "unary" };
    }
  });
  p.emit({ ...input, requestId: "cjk-stream-sensitive-context", text: "弁護士", context: { text: "私有フォームの内容", source: "visible-local", sensitive: true } });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(providerPrompt.text, "弁護士");
  assert.equal(providerPrompt.context, "");
  assert.equal(p.sent.at(-1).type, "complete");
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
      record: { safeReturnUrl: "https://example.test/article", sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"a".repeat(64)}` } }; },
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

test("history with a null return URL routes through the stored site profile and fingerprints the exact local config", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort(); let siteRoute = null, globalRouteCalls = 0, providerCalls = 0, fingerprintConfig = null;
  const localConfig = { provider: "openai-compatible", apiKey: "", apiBaseUrl: "http://127.0.0.1:11434/v1",
    model: "local-fixture", targetLanguage: "zh-CN", prompt: "site prompt", streaming: true };
  const history = { ...deps,
    getEffectiveConfig: async () => { globalRouteCalls++; return { provider: "mock-cloud", model: "cloud" }; },
    getEffectiveConfigForSite: async value => { siteRoute = value; return localConfig; },
    prepareLearningAssistantTurn: async () => ({ session: {},
      grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
        turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" },
      record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://local.test:8443", pageKey: `rp1:${"b".repeat(64)}` } }),
    completeText: async (_input, config) => { providerCalls++; assert.equal(config, localConfig); return { text: "local answer", mode: "stream" }; },
    readingTranslationResult: async config => { fingerprintConfig = config; return { targetLanguage: config.targetLanguage,
      provenance: { provider: config.provider, model: config.model, promptVersion: "p", providerConfigFingerprint: "f".repeat(64) } }; },
    commitLearningAssistantTurn: async (_session, artifact) => ({ saved: { state: "saved", revision: 4 }, artifact }),
    cancelLearningAssistantTurn: async () => {} };
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId: "history-null-return", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(siteRoute, "https://local.test:8443"); assert.equal(globalRouteCalls, 0); assert.equal(providerCalls, 1);
  assert.equal(fingerprintConfig, localConfig); assert.equal(p.sent.at(-1).type, "complete");
});

test("history missing its stored site identity is rejected before config lookup or Provider work", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort(); let configCalls = 0, providerCalls = 0;
  handleSelectionAssistantStreamPort(p, { ...deps,
    getEffectiveConfigForSite: async () => { configCalls++; return { provider: "mock" }; },
    prepareLearningAssistantTurn: async () => ({ session: {},
      grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1", turn: { userQuestion: "Why?" } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" },
      record: { safeReturnUrl: null, sourceLanguage: "en" } }),
    completeText: async () => { providerCalls++; return { text: "should not run", mode: "unary" }; },
    cancelLearningAssistantTurn: async () => {} });
  p.emit({ protocolVersion: 1, type: "start", requestId: "history-missing-site", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(configCalls, 0); assert.equal(providerCalls, 0);
  assert.equal(p.sent.at(-1).type, "interrupted"); assert.equal(p.sent.at(-1).code, "FORBIDDEN");
});

test("Stop during provenance leaves the prepared Reading operation uncommitted", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort(); let releaseProvenance, provenanceStarted, committed = 0, cancelled = 0;
  const started = new Promise(resolve => { provenanceStarted = resolve; });
  const barrier = new Promise(resolve => { releaseProvenance = resolve; });
  const cancellationDone = new Promise(resolve => { p.cancelled = resolve; });
  const history = { ...deps,
    prepareLearningAssistantTurn: async () => ({ session: {},
      grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
        turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" },
      record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"a".repeat(64)}` } }),
    readingTranslationResult: async config => { assert.equal(config.provider, "openai-compatible"); provenanceStarted(); await barrier;
      return { targetLanguage: "zh-CN", provenance: { provider: config.provider, model: "mock", promptVersion: "p", providerConfigFingerprint: "f".repeat(64) } }; },
    commitLearningAssistantTurn: async () => { committed++; },
    cancelLearningAssistantTurn: async () => { cancelled++; p.cancelled(); } };
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId: "history-provenance-stop", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await started;
  p.emit({ type: "cancel", requestId: "history-provenance-stop" });
  releaseProvenance();
  await cancellationDone;
  assert.equal(committed, 0); assert.equal(cancelled, 1);
  assert.equal(p.sent.at(-1).type, "interrupted"); assert.equal(p.sent.at(-1).code, "CANCELLED");
});

test("learning-center stop cancels the prepared operation and never commits partial text", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = historyPort(); let committed = 0, cancelled = 0;
  const waiting = { ...deps,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" }, record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"a".repeat(64)}` } }),
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

test("a Stop racing a failed history commit preserves the actual Reading quota error", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort(), commitEntered = new Promise(resolve => { p.commitEntered = resolve; });
  const history = { ...deps,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" }, record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"a".repeat(64)}` } }),
    commitLearningAssistantTurn: async () => {
      p.commitEntered();
      const nativeFailure = Promise.reject(Object.assign(new Error("quota"), { code: "READING_QUOTA" }));
      p.emit({ type: "cancel", requestId: "quota-race" });
      return nativeFailure;
    }, cancelLearningAssistantTurn: async () => {} };
  const terminal = p.whenSent(value => value.type === "interrupted");
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId: "quota-race", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await commitEntered; const event = await terminal;
  assert.equal(event.code, "READING_QUOTA");
});

test("Stop after the history commit point still reports the saved terminal result", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort(); let releaseAck, commitEnteredResolve;
  const ack = new Promise(resolve => { releaseAck = resolve; }), commitEntered = new Promise(resolve => { commitEnteredResolve = resolve; });
  const history = { ...deps,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" }, record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"a".repeat(64)}` } }),
    commitLearningAssistantTurn: async () => { commitEnteredResolve(); await ack; return { saved: { state: "saved", recordId: "11111111-1111-4111-8111-111111111111", revision: 4 } }; },
    cancelLearningAssistantTurn: async () => { throw new Error("a committed operation must not be cancelled"); } };
  const complete = p.whenSent(value => value.type === "complete");
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId: "post-commit-stop", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  await commitEntered; p.emit({ type: "cancel", requestId: "post-commit-stop" }); releaseAck();
  const event = await complete;
  assert.equal(event.saved.state, "saved"); assert.equal(event.saved.revision, 4);
  assert.equal(p.sent.some(value => value.type === "interrupted"), false);
});

test("ChatGPT host frames stream through a Learning Center follow-up and commit only the completed turn", async () => {
  const methods = [];
  const hostMessages = new Set(), hostDisconnects = new Set();
  const hostPort = {
    onMessage: { addListener: listener => hostMessages.add(listener) },
    onDisconnect: { addListener: listener => hostDisconnects.add(listener) },
    disconnect() { for (const listener of hostDisconnects) listener(); },
    postMessage(request) {
      methods.push(request);
      const send = frame => { for (const listener of hostMessages) listener({ requestId: request.requestId, ...frame }); };
      if (request.method === "hello") {
        send({ type: "terminal", sequence: 0, ok: true, payload: { protocolVersion: 1,
          capabilities: ["auth.status", "auth.start", "auth.select", "auth.logout", "models.list", "infer.start", "cancel"] } });
      } else if (request.method === "infer.start") {
        send({ type: "event", sequence: 0, event: "infer.delta", payload: { text: "Native " } });
        send({ type: "event", sequence: 1, event: "infer.delta", payload: { text: "answer" } });
        send({ type: "terminal", sequence: 2, ok: true, payload: { text: "Native answer" } });
      } else assert.fail(`Unexpected Native Messaging request: ${request.method}`);
    }
  };
  globalThis.chrome = { runtime: { id: "ext", getManifest: () => ({ permissions: ["nativeMessaging"] }),
    connectNative: name => { assert.equal(name, "com.coderlambert.translateflow"); return hostPort; } } };
  const nativeClient = createNativeMessagingClient({ getBrowser: () => globalThis.chrome });
  const provider = createChatGPTPlanProvider({ nativeClient });
  const config = { provider: "chatgpt-plan", model: "fixture-model", streaming: true, targetLanguage: "zh-CN" };
  const p = historyPort();
  let committed = 0;
  const history = { ...deps,
    getEffectiveConfigForSite: async () => config,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" },
      record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"c".repeat(64)}` } }),
    completeText: (input, current, options) => provider.completeText(input, current, options),
    readingTranslationResult: async () => ({ targetLanguage: "zh-CN", provenance: { provider: "chatgpt-plan", model: "fixture-model",
      promptVersion: "p", providerConfigFingerprint: "a".repeat(64) } }),
    commitLearningAssistantTurn: async (_session, artifact) => { committed += 1; return { artifact,
      saved: { state: "saved", recordId: "11111111-1111-4111-8111-111111111111", revision: 4, artifactId: artifact.artifactId, duplicate: false } }; },
    cancelLearningAssistantTurn: async () => {} };
  const complete = p.whenSent(value => value.type === "complete");
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId: "chatgpt-follow-up", recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  const result = await complete;

  assert.deepEqual(p.sent.filter(value => ["started", "delta", "complete"].includes(value.type)).map(value => value.type),
    ["started", "delta", "delta", "complete"]);
  assert.equal(result.text, "Native answer");
  assert.equal(result.saved.state, "saved");
  assert.equal(committed, 1);
  const inference = methods.find(value => value.method === "infer.start");
  assert.deepEqual(Object.keys(inference.payload).sort(), ["input", "instructions", "model"]);
  assert.equal(inference.payload.model, "fixture-model");
  assert.equal(inference.payload.input.includes("React"), true);
  assert.deepEqual(methods.map(value => value.method), ["hello", "infer.start"]);
});

test("a large ChatGPT delta is chunked for the port and cancelling mid-stream never saves partial history", async () => {
  globalThis.chrome = { runtime: { id: "ext" } };
  const p = historyPort();
  const requestId = "chatgpt-large-cancel";
  const postMessage = p.postMessage.bind(p);
  let cancelSent = false;
  p.postMessage = value => {
    postMessage(value);
    if (value.type === "delta" && !cancelSent) {
      cancelSent = true;
      p.emit({ type: "cancel", requestId });
    }
  };

  const rawDelta = "x".repeat(2049);
  const provider = createChatGPTPlanProvider({ nativeClient: {
    async infer(_input, { onDelta }) { onDelta(rawDelta); return { text: rawDelta }; }
  } });
  const config = { provider: "chatgpt-plan", model: "fixture-model", streaming: true, targetLanguage: "zh-CN" };
  let committed = 0;
  let cancelled = 0;
  const history = { ...deps,
    getEffectiveConfigForSite: async () => config,
    prepareLearningAssistantTurn: async () => ({ session: {}, grounded: { question: "Why?", history: [], sourceSnapshotId: "source-1",
      turn: { userQuestion: "Why?", action: "follow-up", threadId: "thread-1", turnId: "turn-2", parentTurnId: "turn-1", branchId: "branch-1", regenerationOf: null } },
      sourceSnapshot: { selectedText: "React", contextMode: "selection-only", contextText: "" },
      record: { safeReturnUrl: null, sourceLanguage: "en" },
      routingIdentity: { siteKey: "https://example.test", pageKey: `rp1:${"d".repeat(64)}` } }),
    completeText: (input, current, options) => provider.completeText(input, current, options),
    commitLearningAssistantTurn: async () => { committed++; return { saved: { state: "saved" } }; },
    cancelLearningAssistantTurn: async () => { cancelled++; } };

  const interrupted = p.whenSent(value => value.type === "interrupted");
  handleSelectionAssistantStreamPort(p, history);
  p.emit({ protocolVersion: 1, type: "start", requestId, recordId: "11111111-1111-4111-8111-111111111111",
    recordRevision: 3, sourceSnapshotId: "source-1", targetTurnId: "turn-1", historyAction: "follow-up", question: "Why?" });
  const terminal = await interrupted;

  assert.equal(cancelSent, true);
  assert.equal(p.sent.filter(value => value.type === "delta").length, 1);
  assert.equal(p.sent.find(value => value.type === "delta").text.length, 2048);
  assert.equal(terminal.code, "CANCELLED");
  assert.equal(terminal.partialChars, 2048);
  assert.equal(p.sent.some(value => value.type === "complete"), false);
  assert.equal(committed, 0);
  assert.equal(cancelled, 1);
});
