import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/content/selection/translation-query.js", import.meta.url), "utf8");
const pageUrl = "https://fixture.invalid/article";
const codeNode = { nodeType: 1, closest(selector) { return selector.includes("code") ? this : null; } };
const linkNode = { nodeType: 1, closest(selector) { return selector.includes("a[href]") ? this : null; } };
const plainNode = { nodeType: 1, closest() { return null; }, querySelectorAll() { return []; } };
const textIn = element => ({ nodeType: 3, parentElement: element, isConnected: true });
function fakeRange({
  insideCode = false, crossingCode = false, insideLink = false, crossingLink = false,
  currentText = "Visible selection", disconnected = false
} = {}) {
  const from = textIn(insideCode ? codeNode : insideLink ? linkNode : plainNode);
  const to = textIn(plainNode);
  if (disconnected) from.isConnected = false;
  const code = { nodeType: 1 }, link = { nodeType: 1 };
  const common = { nodeType: 1, closest() { return null; },
    querySelectorAll(selector) {
      return [
        ...(crossingCode && selector.includes("code") ? [code] : []),
        ...(crossingLink && selector.includes("a[href]") ? [link] : [])
      ];
    }
  };
  return {
    startContainer: from, endContainer: to, commonAncestorContainer: common,
    toString: () => currentText,
    intersectsNode: node => node === code || node === link
  };
}
function harness(engine, range, selectedText = "Visible selection") {
  const calls = [], rendered = [], recorded = [];
  const app = { modules: {
    runtime: {
      messages: { background: { CACHE_LOOKUP: "CACHE_LOOKUP", TRANSLATE_BATCH: "TRANSLATE_BATCH", CACHE_STORE: "CACHE_STORE" } },
      sendRuntimeMessage: async request => {
        calls.push(request.type);
        if (request.type === "CACHE_LOOKUP") return { ok: true, engine, configSnapshotId: "mt:fixed",
          hits: [], writeTokens: [{ id: "selection", token: { test: true } }], skippedIds: [] };
        if (request.type === "TRANSLATE_BATCH") return { ok: true, translations: [{ id: "selection", text: "安全译文" }] };
        return { ok: true, stored: 1 };
      },
      showToast() {}
    },
    contentI18n: { t: key => key },
    tasks: { transition() {}, completeTask() {} },
    selectionPopover: { setLoadingStatus() {}, setLoadingCancelable() {} },
    selectionResultModel: {
      buildTranslationResult: text => ({ primaryMeaning: text }),
      readingTranslation: text => ({ payload: { text } })
    }
  } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, document: { title: "Test" } }, { filename: "translation-query.js" });
  const translate = app.modules.selectionTranslationQuery.create({
    assertCurrent() {}, showResult(_snapshot, card) { rendered.push(card.primaryMeaning); },
    onResult(_draft, artifact) { recorded.push(artifact); }
  });
  return { calls, rendered, recorded, run: () => translate({ text: selectedText, range, pageUrl },
    { id: "mt-privacy-test" }, 1, pageUrl) };
}
for (const [name, range] of [
  ["selected text begins inside code", fakeRange({ insideCode: true })],
  ["selected range crosses a code element", fakeRange({ crossingCode: true })],
  ["selected range cannot be verified", null]
]) test("free web MT must not upload code: " + name, async () => {
  const h = harness("machine-translation", range);
  await assert.rejects(h.run(), { code: "MT_PROTECTED_SELECTION" });
  assert.deepEqual(h.calls, ["CACHE_LOOKUP"]);
  assert.deepEqual(h.rendered, []);
});
test("ordinary text selection uses the same MT Provider and DB4 cache path", async () => {
  const h = harness("machine-translation", fakeRange());
  await h.run();
  assert.deepEqual(h.calls, ["CACHE_LOOKUP", "TRANSLATE_BATCH", "CACHE_STORE"]);
  assert.deepEqual(h.rendered, ["安全译文"]);
  assert.equal(h.recorded.length, 1);
});
test("AI translation still accepts ordinary selections without a DOM range restriction", async () => {
  const h = harness("ai", null);
  await h.run();
  assert.deepEqual(h.calls, ["CACHE_LOOKUP", "TRANSLATE_BATCH", "CACHE_STORE"]);
});

for (const [name, range] of [
  ["selection begins inside an href link", fakeRange({ insideLink: true })],
  ["selection crosses an href link", fakeRange({ crossingLink: true })],
  ["selection text changed during lookup", fakeRange({ currentText: "Changed selection" })],
  ["selection endpoints were disconnected", fakeRange({ disconnected: true })]
]) test("free web MT must not upload links or stale selections: " + name, async () => {
  const h = harness("machine-translation", range);
  await assert.rejects(h.run(), { code: "MT_PROTECTED_SELECTION" });
  assert.deepEqual(h.calls, ["CACHE_LOOKUP"]);
  assert.deepEqual(h.rendered, []);
});
for (const text of [
  "See https://example.invalid/private?token=secret",
  "Read docs.example.invalid/private",
  "Visit www.example.invalid/help",
  "Send mailto:user@example.invalid",
  "Local http://127.0.0.1:8080/secret",
  "Server 192.168.0.7:3000/internal",
  "Local localhost:3000/private?token=fixture",
  "Internal [fd00::1]:8080/private",
  "Repository git@github.com:private/repo"
]) test("free web MT must not upload visible URL text: " + text, async () => {
  const h = harness("machine-translation", fakeRange({ currentText: text }), text);
  await assert.rejects(h.run(), { code: "MT_PROTECTED_SELECTION" });
  assert.deepEqual(h.calls, ["CACHE_LOOKUP"]);
  assert.deepEqual(h.rendered, []);
});
test("ordinary URL-free text still follows the existing DB4 cache path", async () => {
  const selected = "Read the next paragraph before proceeding.";
  const h = harness("machine-translation", fakeRange({ currentText: selected }), selected);
  await h.run();
  assert.deepEqual(h.calls, ["CACHE_LOOKUP", "TRANSLATE_BATCH", "CACHE_STORE"]);
});
