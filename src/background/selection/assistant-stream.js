import { getEffectiveConfig } from "../config.js";
import { completeText } from "../providers/index.js";
import { resolveSelectionRequest } from "./resolve.js";
const PORT = "selection.assistant-stream", V = 1, MAX_TEXT = 2000, MAX_DELTA = 2048, MAX_TOTAL = 24000, MAX_ACTIVE = 32;

const active = new Set();
export function handleSelectionAssistantStreamPort(port, deps = {}) {
  if (port.name !== PORT) return false;
  if (active.size >= MAX_ACTIVE || !validSender(port.sender)) { try { port.disconnect(); } catch {} return true; }
  const state = { port, tabId: port.sender.tab.id, ctl: null, id: "", started: false, closed: false, seq: 0, chars: 0 }; active.add(state);
  const close = () => { state.closed = true; state.ctl?.abort(); active.delete(state); };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener(message => {
    if (message?.type === "cancel" && message.requestId === state.id) { state.ctl?.abort(); return; }
    if (state.started || !validStart(message, port.sender)) { fail(state, "BAD_REQUEST"); return; }
    state.started = true; state.id = message.requestId; state.ctl = new AbortController(); void run(state, message, deps);
  });
  return true;
}
export function abortSelectionAssistantStreams(tabId = null) {
  for (const state of active) if (tabId === null || state.tabId === tabId) state.ctl?.abort();
}
async function run(state, input, deps) {
  const getConfig = deps.getEffectiveConfig || getEffectiveConfig, resolve = deps.resolveSelectionRequest || resolveSelectionRequest, complete = deps.completeText || completeText;
  try {
    const resolved = await resolve({ text: input.text, pageUrl: input.pageUrl, context: input.context || null, depth: input.depth, explainRequested: true });
    const config = await getConfig(input.pageUrl), mode = config.provider === "openai-compatible" && config.streaming ? "stream" : "unary";
    post(state, { type: "started", mode });
    const prompt = JSON.stringify({ text: resolved.explanationInput?.selectionText || input.text, context: resolved.explanationInput?.contextText || "" });
    const result = await complete({ systemPrompt: "Explain from context. Plain text only.", prompt }, config,
      { signal: state.ctl.signal, onDelta: delta => emitDelta(state, delta) });
    if (state.ctl.signal.aborted) throw Object.assign(new Error(), { code: "CANCELLED" });
    const text = String(result.text || "");
    if (result.mode === "unary") emitDelta(state, text);
    if (!text || text.length > MAX_TOTAL) throw Object.assign(new Error("limit"), { code: "LIMIT" });
    post(state, { type: "complete", mode: result.mode, text });
  } catch (error) { if (!state.closed) post(state, { type: "interrupted", code: state.ctl?.signal.aborted ? "CANCELLED" : String(error?.code || "FAILED"), partialChars: state.chars }); }
  finally { state.ctl = null; }
}
function emitDelta(state, raw) {
  if (state.closed || state.ctl?.signal.aborted) return;
  const text = String(raw || ""); if (!text || text.length > MAX_DELTA || state.chars + text.length > MAX_TOTAL) { state.ctl.abort(); return; }
  state.chars += text.length; post(state, { type: "delta", sequence: state.seq++, text });
}
function post(state, message) { if (!state.closed) try { state.port.postMessage({ protocolVersion: V, requestId: state.id, ...message }); } catch { state.ctl?.abort(); } }
function fail(state, code) { post(state, { type: "interrupted", code, partialChars: state.chars }); state.ctl?.abort(); }
function validSender(sender) { try { const url = new URL(String(sender?.url || "")); return sender?.id === chrome.runtime.id && sender?.frameId === 0 && Number.isInteger(sender?.tab?.id) && sender.tab.incognito === false && /^https?:$/u.test(url.protocol) && (!sender.tab.url || sender.tab.url === sender.url); } catch { return false; } }
function validStart(value, sender) { return value?.protocolVersion === V && value.type === "start" && /^[A-Za-z0-9._:-]{1,120}$/u.test(value.requestId || "") &&
  typeof value.text === "string" && value.text.trim() && value.text.length <= MAX_TEXT && typeof value.pageUrl === "string" && value.pageUrl === sender.url &&
  (value.context === null || typeof value.context === "object") && (typeof sender.documentId === "string" && sender.documentId.length > 0 || /^[a-f0-9]{32}$/iu.test(value.ownerToken || "")); }
