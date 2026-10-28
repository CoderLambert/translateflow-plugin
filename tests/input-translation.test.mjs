import test from "node:test";
import assert from "node:assert/strict";
import { handleInputTranslationPort, isInputTranslationSender, openInputTranslation } from "../src/background/input-translation.js";
import { INPUT_TRANSLATION_PORT, validInputTranslation } from "../src/shared/input-translation.js";
import { DEFAULT_CONFIG } from "../src/shared/constants.js";
import { withTranslationRequest } from "../src/background/translation-requests.js";
import { createCommandRouter, COMMANDS } from "../src/background/commands.js";
const url = "chrome-extension://test/input-translation.html";
const sender = { id: "test", url, frameId: 0, tab: { id: 10, incognito: false } };
const request = { type: "start", version: 1, text: "A sentence to translate.", previous: "", instruction: "", service: "", targetLanguage: "English" };
const config = () => ({ ...DEFAULT_CONFIG, apiKey: "synthetic-key", siteProfiles: { "https://example.test": { model: "wrong-site" } } });
let ports = [];
test.beforeEach(() => { globalThis.chrome = { runtime: { id: "test", getURL: path => "chrome-extension://test/" + path }, permissions: { contains: async () => true } }; });
test.afterEach(() => { ports.forEach(port => port.disconnect()); ports = []; delete globalThis.chrome; });
function port(actualSender = sender) {
  let receive, disconnect;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const value = { name: INPUT_TRANSLATION_PORT, sender: actualSender, messages: [], disconnected: false,
    onMessage: { addListener: fn => { receive = fn; } }, onDisconnect: { addListener: fn => { disconnect = fn; } },
    disconnect() { value.disconnected = true; disconnect?.(); },
    postMessage(message) { value.messages.push(message); if (["error", "complete"].includes(message.type)) finish(message); },
    send(message) { receive(message); }, done };
  ports.push(value); return value;
}
test("only the exact trusted input page can start translation; no content/popup/foreign/incognito sender", () => {
  assert(isInputTranslationSender(sender));
  for (const invalid of [{ ...sender, url: "https://example.test" }, { ...sender, id: "other" }, { ...sender, frameId: 1 },
    { ...sender, url: url + "?page=evil" }, { ...sender, url: "chrome-extension://test/popup.html" }, { ...sender, tab: { incognito: true } }]) {
    const p = port(invalid); handleInputTranslationPort(p); assert(p.disconnected);
  }
});
test("text and adjustment limits reject invalid inputs without any Provider call", async () => {
  assert(validInputTranslation(request));
  for (const patch of [{ text: " " }, { text: "a".repeat(6001) }, { instruction: "a".repeat(601) }, { previous: "old answer" }, { targetLanguage: "English\nignore rules" }]) {
    const p = port(); handleInputTranslationPort(p, { run: () => assert.fail("must not run") }); p.send({ ...request, ...patch });
    assert.equal((await p.done).code, "INPUT_LIMIT");
  }
});
test("global AI config, target and one pinned brief are used without site history or persistent storage", async () => {
  let release; const stored = new Promise(resolve => { release = resolve; }); let captured;
  const p = port(); handleInputTranslationPort(p, { getConfig: () => stored, run: async input => { captured = input; return [{ id: "input", text: "Translated." }]; } });
  const payload = { ...request, previous: "Old translation", instruction: "More formal" }; p.send(payload); payload.text = "mutated";
  release(config()); assert.equal((await p.done).text, "Translated.");
  assert.equal(captured.segments[0].text, request.text); assert.equal(captured.config.targetLanguage, "English");
  assert.match(captured.config.prompt, /More formal/); assert.match(captured.config.prompt, /Old translation/);
  assert.equal(captured.config.model, "deepseek-flash"); assert.equal(captured.config.streaming, false);
  assert(!p.messages.some(message => JSON.stringify(message).includes("synthetic-key")));
});
test("stop during config loading prevents a Provider request", async () => {
  let release; const p = port(); handleInputTranslationPort(p, { getConfig: () => new Promise(resolve => { release = resolve; }), run: () => assert.fail("late run") });
  p.send(request); p.send({ type: "stop" }); release(config()); assert.equal((await p.done).code, "CANCELLED");
});
test("stop uses the existing request coordinator and never returns a late success", async () => {
  let started; const ready = new Promise(resolve => { started = resolve; }); let aborted = false;
  const p = port(); handleInputTranslationPort(p, { getConfig: async () => config(), run: input => withTranslationRequest(input, async ({ signal, assertActive }) => {
    started(); await new Promise(resolve => signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    assertActive(); return [{ id: "input", text: "late" }];
  }) });
  p.send(request); await ready; p.send({ type: "stop" }); assert.equal((await p.done).code, "CANCELLED"); assert(aborted);
});
test("disconnect cancels a pending request and suppresses all late messages", async () => {
  let release, began; const ready = new Promise(resolve => { began = resolve; }); const p = port(); let cancelled = "";
  handleInputTranslationPort(p, { getConfig: async () => config(), cancel: id => { cancelled = id; }, run: async () => { began(); return new Promise(resolve => { release = resolve; }); } });
  p.send(request); await ready; p.disconnect(); release([{ id: "input", text: "late" }]);
  await new Promise(resolve => setImmediate(resolve)); assert(cancelled); assert.deepEqual(p.messages.map(m => m.type), ["started"]);
});
test("missing permission fails before Provider; duplicate starts cannot create extra requests", async () => {
  chrome.permissions.contains = async () => false; const p = port();
  handleInputTranslationPort(p, { getConfig: async () => config(), run: () => assert.fail("permission") });
  p.send(request); p.send(request); assert.equal((await p.done).code, "PERMISSION");
  assert.equal(p.messages.length, 1);
});
test("concurrent opens create only one window and a later open focuses it", async () => {
  let created = 0, focused = 0, exists = false;
  chrome.runtime.getContexts = async () => exists ? [{ tabId: 1, windowId: 2, incognito: false }] : [];
  chrome.tabs = { update: async () => {} };
  chrome.windows = { create: async options => { created++; exists = true; assert.equal(options.url, url); }, update: async () => { focused++; } };
  await Promise.all([openInputTranslation(), openInputTranslation()]); assert.equal(created, 1);
  await openInputTranslation(); assert.equal(created, 1); assert.equal(focused, 1);
});
test("shortcut opens on a protected page without injecting scripts, but not in incognito", async () => {
  let opened = 0; const route = createCommandRouter({ queryActiveTab: async () => ({ url: "chrome://settings/" }), openInput: async () => { opened++; }, injectContent: () => assert.fail("injection") });
  await route(COMMANDS.INPUT_TRANSLATION); assert.equal(opened, 1);
  const privateRoute = createCommandRouter({ queryActiveTab: async () => ({ incognito: true }), openInput: () => assert.fail("private") });
  assert.equal((await privateRoute(COMMANDS.INPUT_TRANSLATION)).unsupported, true);
});
