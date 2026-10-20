import test from "node:test";
import assert from "node:assert/strict";
import { runSubtitleTranslationBatch } from "../src/background/subtitle-requests.js";
import { cancelTranslationRequest, cancelTextTranslations } from "../src/background/translation-requests.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { resolve, promise }; }
const input = id => ({ requestId: id, pageUrl: "https://www.youtube.com/watch?v=fixture", units: [{ id: "a", text: "A", mediaId: "youtube:fixture", cue: { startTime: 1, endTime: 2 } }] });
function deps() { const calls = { provider: 0, store: 0 }; return { calls,
  getEffectiveConfig: async () => ({ provider: "openai", model: "m", targetLanguage: "zh" }),
  lookupTranslations: async () => ({ hits: [], writeTokens: [] }),
  runTranslationRequest: async () => { calls.provider++; return [{ id: "a", text: "译文" }]; },
  storeTranslations: async () => { calls.store++; return { stored: 1 }; }
}; }
for (const phase of ["config", "cache", "provider"]) test("cancellation during subtitle " + phase + " prevents subsequent work", async () => {
  const d = deps(), held = deferred();
  if (phase === "config") d.getEffectiveConfig = () => held.promise;
  if (phase === "cache") d.lookupTranslations = () => held.promise;
  if (phase === "provider") d.runTranslationRequest = () => { d.calls.provider++; return held.promise; };
  const running = runSubtitleTranslationBatch(input(phase), d); const result = running.catch(error => error);
  await tick(); assert.equal(cancelTranslationRequest(phase).cancelled, true);
  held.resolve(phase === "config" ? { provider: "openai" } : phase === "cache" ? { hits: [], writeTokens: [] } : [{ id: "a", text: "译文" }]);
  assert.equal((await result).code, "CANCELLED");
  assert.equal(d.calls.provider, phase === "provider" ? 1 : 0); assert.equal(d.calls.store, 0);
});
test("configuration-wide cancellation includes subtitle cache preparation", async () => {
  const d = deps(), held = deferred(); d.lookupTranslations = () => held.promise;
  const result = runSubtitleTranslationBatch(input("settings"), d).catch(error => error);
  await tick(); cancelTextTranslations(); held.resolve({ hits: [], writeTokens: [] });
  assert.equal((await result).code, "CANCELLED"); assert.equal(d.calls.provider, 0);
});
test("configuration revision change during cache read rejects the old plan before Provider", async () => {
  const d = deps(), held = deferred(); let revision = "one";
  d.getConfigRevision = () => revision; d.lookupTranslations = () => held.promise;
  const result = runSubtitleTranslationBatch(input("revision"), d).catch(error => error);
  await tick(); revision = "two"; held.resolve({ hits: [], writeTokens: [] });
  assert.equal((await result).code, "CONFIG_SNAPSHOT_EXPIRED"); assert.equal(d.calls.provider, 0);
});
test("cancelled cached subtitle does not deliver an old hit", async () => {
  const d = deps(), held = deferred(); d.lookupTranslations = () => held.promise;
  const result = runSubtitleTranslationBatch(input("hit"), d).catch(error => error);
  await tick(); cancelTranslationRequest("hit"); held.resolve({ hits: [{ id: "a", text: "cached" }] });
  assert.equal((await result).code, "CANCELLED"); assert.equal(d.calls.provider, 0);
});

test("malformed page-cache clear cannot become an all-cache clear", async () => {
  const { handleCacheMessage } = await import("../src/background/cache/message-handler.js");
  for (const pageUrl of [undefined, null, "", "   "]) {
    await assert.rejects(handleCacheMessage({ type: "CACHE_CLEAR_PAGE", pageUrl }), { code: "CACHE_INVALID_INPUT" });
  }
});
