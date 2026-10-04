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
const input = { protocolVersion: 1, type: "start", requestId: "stream-1", text: "session", pageUrl: "https://example.test/article", context: null, depth: "standard" };
const deps = { resolveSelectionRequest: async () => ({ explanationInput: { selectionText: "session", contextText: "", candidates: [] } }),
  getEffectiveConfig: async () => ({ provider: "openai-compatible", streaming: true }),
  completeText: async (_input, _config, { onDelta }) => { onDelta("hello "); onDelta("world"); return { text: "hello world", mode: "stream" }; } };

test("assistant stream port binds one sender/request and emits ordered real deltas", async () => {
  globalThis.chrome = { runtime: { id: "ext" } }; const p = port();
  assert.equal(handleSelectionAssistantStreamPort(p, deps), true); p.emit(input); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(p.sent.map(value => value.type), ["started", "delta", "delta", "complete"]);
  assert.deepEqual(p.sent.filter(value => value.type === "delta").map(value => [value.sequence, value.text]), [[0, "hello "], [1, "world"]]);
  assert.equal(p.sent.at(-1).text, "hello world"); p.emit(input);
  assert.equal(p.sent.at(-1).type, "interrupted"); assert.equal(p.sent.at(-1).code, "BAD_REQUEST");
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
