import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createContentI18nStub } from "./helpers/content-i18n-stub.mjs";

const sources = await Promise.all(["result-model.js", "translation-query.js"].map((file) =>
  readFile(new URL(`../src/content/selection/${file}`, import.meta.url), "utf8")));
const json = (value) => JSON.parse(JSON.stringify(value));
const provenance = { provider: "synthetic", model: "synthetic-model", promptVersion: "translation-prompt-v1",
  providerConfigFingerprint: "a".repeat(64) };
function harness(reply, { current = () => true } = {}) {
  const sent = [], shown = [], artifacts = [], completions = [], statuses = [];
  const app = { modules: {
    contentI18n: createContentI18nStub(),
    runtime: { messages: { background: { CACHE_LOOKUP: "lookup", TRANSLATE_BATCH: "translate", CACHE_STORE: "store" } },
      async sendRuntimeMessage(request) { sent.push(json(request)); return reply(request); } },
    tasks: { transition() {}, completeTask(_task, result) { completions.push(json(result)); },
      responseError(response, message) { return new Error(response.error || message); } },
    selectionPopover: { setLoadingStatus(message) { statuses.push(message); } }
  } };
  const realm = vm.createContext({ __TRANSLATE_FLOW_CONTENT__: app, document: { title: "Synthetic title" } });
  for (const source of sources) vm.runInContext(source, realm);
  const run = app.modules.selectionTranslationQuery.create({
    assertCurrent() { if (!current()) throw new Error("selection superseded"); },
    showResult(_snapshot, card) { shown.push(json(card)); },
    onResult(context, artifact) { artifacts.push({ context, artifact: json(artifact) }); }
  });
  return { run: () => run({ text: "synthetic source", pageUrl: "https://fixture.invalid/article" }, { id: "synthetic-task" }, 2,
    "https://fixture.invalid/article", "current-reading-card"), sent, shown, artifacts, completions, statuses };
}

test("Selection translation cache hit displays and records its actual response without Provider/store", async () => {
  const h = harness(() => ({ ok: true, hits: [{ id: "selection", text: "cached visible result" }],
    readingResult: { targetLanguage: "zh-CN", provenance } }));
  await h.run();
  assert.deepEqual(h.sent.map((item) => item.type), ["lookup"]);
  assert.equal(h.shown[0].primaryMeaning, "cached visible result");
  assert.equal(h.artifacts[0].context, "current-reading-card");
  assert.equal(h.artifacts[0].artifact.payload.text, "cached visible result");
  assert.deepEqual(h.artifacts[0].artifact.provenance, provenance);
  assert.deepEqual(h.completions, [{ done: 1, cacheHits: 1 }]);
});

test("Selection cache miss preserves lookup → Provider → committed cache → visible result ordering", async () => {
  const h = harness((request) => request.type === "lookup" ? { ok: true, hits: [] } : request.type === "translate"
    ? { ok: true, translations: [{ id: "selection", text: "fresh visible result" }], readingResult: { targetLanguage: "zh-CN", provenance } }
    : { ok: true });
  await h.run();
  assert.deepEqual(h.sent.map((item) => item.type), ["lookup", "translate", "store"]);
  assert.equal(h.sent[1].requestId, "synthetic-task");
  assert.deepEqual(h.sent[2].items, [{ sourceText: "synthetic source", translation: "fresh visible result" }]);
  assert.equal(h.shown[0].primaryMeaning, "fresh visible result");
  assert.equal(h.artifacts[0].artifact.payload.text, "fresh visible result");
  assert.deepEqual(h.completions, [{ done: 1, apiTranslated: 1 }]);
});

test("Selection supersession or failed cache commit never displays or records a completion", async () => {
  const stale = harness(() => ({ ok: true, hits: [{ id: "selection", text: "old result" }] }), { current: () => false });
  await assert.rejects(stale.run(), /selection superseded/);
  assert.equal(stale.shown.length, 0); assert.equal(stale.artifacts.length, 0);
  const failed = harness((request) => request.type === "lookup" ? { ok: true, hits: [] } : request.type === "translate"
    ? { ok: true, translations: [{ id: "selection", text: "uncommitted result" }] } : { ok: false, error: "synthetic storage failure" });
  await assert.rejects(failed.run(), /content\.selection\.cacheStoreFailed/);
  assert.equal(failed.shown.length, 0); assert.equal(failed.artifacts.length, 0); assert.equal(failed.completions.length, 0);
});
