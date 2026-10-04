import { getEffectiveConfig } from "../config.js";
import { completeText } from "../providers/index.js";
import { commitLearningAssistantTurn, cancelLearningAssistantTurn, prepareLearningAssistantTurn } from "../reading-record/runtime.js";
import { readingTranslationResult } from "./reading-result.js";
import { resolveSelectionRequest } from "./resolve.js";
import { ASSISTANT_ROOT_QUESTIONS as QUESTIONS, groundLearningAssistant } from "./assistant-grounding.js";

const PORT = "selection.assistant-stream", V = 1, MAX_TEXT = 2000, MAX_DELTA = 2048, MAX_TOTAL = 24000, MAX_ACTIVE = 32;
const active = new Set();

export function handleSelectionAssistantStreamPort(port, deps = {}) {
  if (port.name !== PORT) return false;
  const scope = senderScope(port.sender);
  if (active.size >= MAX_ACTIVE || !scope) { try { port.disconnect(); } catch {} return true; }
  const state = { port, scope, tabId: port.sender.tab?.id ?? null, ctl: null, id: "", started: false, closed: false, seq: 0, chars: 0 };
  active.add(state);
  const close = () => { state.closed = true; state.ctl?.abort(); active.delete(state); };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener(message => {
    if (message?.type === "cancel" && message.requestId === state.id) { state.ctl?.abort(); return; }
    if (state.started || !validStart(message, port.sender, scope)) { fail(state, "BAD_REQUEST"); return; }
    state.started = true; state.id = message.requestId; state.ctl = new AbortController(); void run(state, message, deps);
  });
  return true;
}

export function abortSelectionAssistantStreams(tabId = null) {
  for (const state of active) if (tabId === null || state.tabId === tabId) state.ctl?.abort();
}

async function run(state, request, deps) {
  const getConfig = deps.getEffectiveConfig || getEffectiveConfig, resolve = deps.resolveSelectionRequest || resolveSelectionRequest;
  const complete = deps.completeText || completeText, provenance = deps.readingTranslationResult || readingTranslationResult;
  const prepareHistory = deps.prepareLearningAssistantTurn || prepareLearningAssistantTurn;
  const commitHistory = deps.commitLearningAssistantTurn || commitLearningAssistantTurn;
  const cancelHistory = deps.cancelLearningAssistantTurn || cancelLearningAssistantTurn;
  let historySession = null;
  try {
    let pageUrl, sourceLanguage, selectedText, contextText, candidates, history, question, turn;
    if (state.scope === "history") {
      const prepared = await prepareHistory(state.port.sender, request,
        detail => (deps.groundLearningAssistant || groundLearningAssistant)(detail, request, deps.randomId));
      historySession = prepared.session;
      ({ history, question, turn } = prepared.grounded);
      selectedText = prepared.sourceSnapshot.selectedText;
      contextText = prepared.sourceSnapshot.contextMode === "bounded-context" ? prepared.sourceSnapshot.contextText : "";
      candidates = []; pageUrl = prepared.record.safeReturnUrl || ""; sourceLanguage = prepared.record.sourceLanguage;
    } else {
      const resolved = await resolve({ text: request.text, pageUrl: request.pageUrl, context: request.context || null,
        depth: request.depth, explainRequested: true });
      pageUrl = request.pageUrl; sourceLanguage = resolved.intent?.sourceLanguage || "unknown";
      selectedText = resolved.explanationInput?.selectionText || request.text;
      contextText = resolved.explanationInput?.contextText || "";
      candidates = resolved.explanationInput?.candidates || []; history = request.history || [];
      question = request.action === "follow-up" ? request.question : QUESTIONS[request.action];
      turn = { userQuestion: question, action: request.action, threadId: request.threadId, turnId: request.turnId,
        parentTurnId: request.parentTurnId, branchId: request.branchId, regenerationOf: request.regenerationOf };
    }
    if (state.ctl.signal.aborted) throw cancelled();
    const config = await getConfig(pageUrl), mode = config.provider === "openai-compatible" && config.streaming ? "stream" : "unary";
    post(state, { type: "started", mode });
    const prompt = JSON.stringify({ question, text: selectedText, context: contextText, candidates, history });
    const result = await complete({ systemPrompt: "Explain from context. Plain text only.", prompt }, config,
      { signal: state.ctl.signal, onDelta: delta => emitDelta(state, delta) });
    if (state.ctl.signal.aborted) throw cancelled();
    const text = String(result.text || "");
    if (result.mode === "unary") emitDelta(state, text);
    if (!text || text.length > MAX_TOTAL) throw Object.assign(new Error("limit"), { code: "LIMIT" });
    const completedTurn = { ...turn, assistantAnswer: text, completionStatus: "completed" };
    const readingResult = await provenance(pageUrl, config);
    readingResult.provenance.promptVersion = "selection-assistant-v1";
    if (historySession) {
      const committed = await commitHistory(historySession, { schemaVersion: 1, artifactId: crypto.randomUUID(),
        kind: "assistant", targetLanguage: readingResult.targetLanguage, createdAt: Date.now(), payload: completedTurn,
        provenance: readingResult.provenance });
      historySession = null;
      post(state, { type: "complete", mode: result.mode, text, turn: completedTurn, saved: committed.saved });
    } else {
      post(state, { type: "complete", mode: result.mode, text, turn: completedTurn,
        readingResult: { ...readingResult, sourceLanguage } });
    }
  } catch (error) {
    if (!state.closed) post(state, { type: "interrupted", code: state.ctl?.signal.aborted ? "CANCELLED" : String(error?.code || "FAILED"), partialChars: state.chars });
  } finally {
    if (historySession) try { await cancelHistory(historySession); } catch {}
    state.ctl = null; active.delete(state);
  }
}

function emitDelta(state, raw) {
  if (state.closed || state.ctl?.signal.aborted) return;
  const text = String(raw || "");
  if (!text || text.length > MAX_DELTA || state.chars + text.length > MAX_TOTAL) { state.ctl.abort(); return; }
  state.chars += text.length; post(state, { type: "delta", sequence: state.seq++, text });
}
function post(state, message) { if (!state.closed) try { state.port.postMessage({ protocolVersion: V, requestId: state.id, ...message }); } catch { state.ctl?.abort(); } }
function fail(state, code) { post(state, { type: "interrupted", code, partialChars: state.chars }); state.ctl?.abort(); }
function cancelled() { return Object.assign(new Error("cancelled"), { code: "CANCELLED" }); }
function senderScope(sender) {
  try {
    const url = new URL(String(sender?.url || ""));
    if (sender?.id !== chrome.runtime.id || sender?.frameId !== 0 || sender?.tab?.incognito !== false) return null;
    if (/^https?:$/u.test(url.protocol) && Number.isInteger(sender.tab.id) && (!sender.tab.url || sender.tab.url === sender.url)) return "content";
    if (url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id && url.pathname === "/learning-center.html" && !url.search && typeof sender.documentId === "string") return "history";
  } catch {}
  return null;
}
function validStart(value, sender, scope) {
  if (value?.protocolVersion !== V || value.type !== "start" || !validId(value.requestId)) return false;
  if (scope === "history") return exact(value, ["protocolVersion", "type", "requestId", "recordId", "recordRevision", "sourceSnapshotId", "targetTurnId", "historyAction", ...(value.historyAction === "follow-up" ? ["question"] : [])]) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.recordId || "") && Number.isSafeInteger(value.recordRevision) && value.recordRevision > 0 &&
    validId(value.sourceSnapshotId) && validId(value.targetTurnId) && ["follow-up", "regenerate"].includes(value.historyAction) &&
    (value.historyAction !== "follow-up" || typeof value.question === "string" && value.question.trim() && value.question.length <= 2000);
  return typeof value.text === "string" && value.text.trim() && value.text.length <= MAX_TEXT && typeof value.pageUrl === "string" && value.pageUrl === sender.url &&
    (value.context === null || typeof value.context === "object") && validTurn(value) &&
    (typeof sender.documentId === "string" && sender.documentId.length > 0 || /^[a-f0-9]{32}$/iu.test(value.ownerToken || ""));
}
function validTurn(value) {
  const root = Object.hasOwn(QUESTIONS, value.action);
  if (!validId(value.threadId) || !validId(value.turnId) || !validId(value.branchId) || value.parentTurnId !== null && !validId(value.parentTurnId) || value.regenerationOf !== null && !validId(value.regenerationOf)) return false;
  if (root ? value.parentTurnId !== null || value.question !== undefined : value.action !== "follow-up" || !value.parentTurnId || value.regenerationOf !== null || typeof value.question !== "string" || !value.question.trim() || value.question.length > 2000) return false;
  if (value.regenerationOf && (value.regenerationOf === value.turnId || value.parentTurnId !== null)) return false;
  return value.history === undefined || Array.isArray(value.history) && value.history.length <= 6 && value.history.every(turn => validId(turn?.turnId) && typeof turn.question === "string" && turn.question.length <= 2000 && typeof turn.answer === "string" && turn.answer.length <= MAX_TOTAL);
}
function validId(value) { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value || ""); }
function exact(value, keys) { return value && typeof value === "object" && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
