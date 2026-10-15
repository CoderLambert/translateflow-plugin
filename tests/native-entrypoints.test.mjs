import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const pageUrl = "https://example.test/page";

test("page processor skips target-language passages, does not render duplicate originals and passes code protection into detection", async () => {
  const calls = [], el = { hasAttribute: () => false };
  const app = { modules: {
    runtime: { constants: { TRANSLATED_ATTR: "done" }, messages: { background: { CACHE_LOOKUP: "CACHE_LOOKUP" } }, state: {},
      getPageIdentity: value => value, normalizeSourceText: value => value, sendRuntimeMessage: async payload => {
        calls.push(payload); return { ok: true, hits: [{ id: "a", text: "原文" }], skippedIds: ["a"], configSnapshotId: "browser-plan:test" };
      } },
    contentI18n: { t: key => key }, tasks: {}, batch: {},
    structured: { encodeElement: () => ({ descriptors: [{ protectedText: "code" }] }) },
    dom: { insertTranslation: () => assert.fail("same-language content must not be duplicated") }
  } };
  vm.runInNewContext(await readFile(new URL("../src/content/processor.js", import.meta.url), "utf8"),
    { __TRANSLATE_FLOW_CONTENT__: app, document: { title: "test", contains: () => true }, location: { href: pageUrl } });
  const result = await app.modules.processor.processGroupBatch([{ id: "a", text: "原文", elements: [el], normalizedText: "原文" }], { cacheOnly: false, pageUrl });
  assert.equal(calls.length, 1); assert.equal(calls[0].segments[0].protectedIds[0], 0);
  assert.equal(result.cacheHits, 0); assert.equal(result.apiTranslated, 0); assert.equal(result.missing, 0);
});
test("same-language selection shows an explanation without writing a synthetic translation record", async () => {
  let notice, finished;
  const app = { modules: {
    runtime: { messages: { background: { CACHE_LOOKUP: "CACHE_LOOKUP" } }, sendRuntimeMessage: async payload => {
      assert.equal(payload.type, "CACHE_LOOKUP"); return { ok: true, skippedIds: ["selection"], hits: [] };
    } },
    contentI18n: { t: key => key }, tasks: { transition() {}, completeTask(_task, value) { finished = value; } },
    selectionResultModel: {}, selectionPopover: { setLoadingStatus() {}, showEmpty(_snapshot, value) { notice = value; } }
  } };
  vm.runInNewContext(await readFile(new URL("../src/content/selection/translation-query.js", import.meta.url), "utf8"), { __TRANSLATE_FLOW_CONTENT__: app });
  const fn = app.modules.selectionTranslationQuery.create({ assertCurrent() {}, showResult: () => assert.fail("no generated result"), onResult: () => assert.fail("no record") });
  await fn({ pageUrl, text: "中文" }, { id: "task" }, 1, pageUrl);
  assert.equal(notice.titleKey, "content.basic.alreadyTarget"); assert.equal(finished.apiTranslated, 0);
});
