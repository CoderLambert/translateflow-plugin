import test from "node:test";
import assert from "node:assert/strict";
import { createTranslationIdentity } from "../src/shared/translation-cache-identity.js";
import { CACHE_RECORD_VERSION } from "../src/shared/cache/record.js";
import { DEFAULT_MACHINE_TRANSLATION, MACHINE_ENGINE, createMachineConfig, machineLanguage,
  normalizeMachineTranslation, rawTranslationSite, resolveMachineTranslation } from "../src/shared/machine-translation.js";
import { buildMachineRequest, parseMachineResponse, requestMachineTexts } from "../src/background/providers/machine-translation-transport.js";
import { splitMachineText, translateMachineBatch } from "../src/background/providers/machine-translation.js";
import { getConfigHash, translationSourceHash } from "../src/background/cache-db.js";
import { buildTranslationRequestKey, cancelMachineTranslations, runTranslationRequest } from "../src/background/translation-requests.js";
import { translationConfig, translationEngineSettings } from "../src/background/browser-translation.js";
import { getEffectiveConfig } from "../src/background/config.js";
import { resolveSelectionRequest } from "../src/background/selection/resolve.js";
import { readingTranslationResult } from "../src/background/selection/reading-result.js";
import { validateResultArtifact } from "../src/shared/reading/artifact.js";
import { createEffectiveConfigSnapshot, invalidateMachineSnapshots, resolveEffectiveConfigSnapshot } from "../src/background/effective-config-snapshots.js";
import { handleMachineSettingsMessage, saveMachineTranslationSettings, testMachineTranslationSettings } from "../src/background/machine-translation-settings.js";
import { normalizeProviderConnection } from "../src/shared/provider-connections.js";
import { BACKGROUND_MESSAGES as M } from "../src/shared/constants.js";

const originalFetch = globalThis.fetch, originalChrome = globalThis.chrome;
const settings = (providerId = "mt-microsoft-web", sourceLanguage = "auto") => ({ ...DEFAULT_MACHINE_TRANSLATION, mode: "free-online", providerId, sourceLanguage });
const config = (provider = "mt-microsoft-web") => createMachineConfig(settings(provider), "zh-CN");
const page = "https://fixture.invalid/article";
const sender = { id: "test-extension", tab: { id: 1 }, frameId: 0, documentId: "document-1", url: page };
const ok = texts => Response.json(texts.map(text => ({ translations: [{ text }] })));
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function storage(patch = {}) {
  const memory = { targetLanguage: "Simplified Chinese", machineTranslation: settings(), dictionaryEnabled: false, ...patch };
  const writes = [];
  globalThis.chrome = { runtime: { id: sender.id, getURL: path => `chrome-extension://${sender.id}/${path}` },
    permissions: { contains: async () => true }, storage: { local: {
      get: async keys => keys === null ? { ...memory } : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => Object.hasOwn(memory, key)).map(key => [key, memory[key]])),
      set: async patch => { writes.push(structuredClone(patch)); Object.assign(memory, patch); }
    } } };
  return { memory, writes };
}
test.afterEach(() => { cancelMachineTranslations(); invalidateMachineSnapshots(); globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; });

test("MT is opt-in; invalid settings fail rather than becoming a paid default", () => {
  assert.equal(normalizeMachineTranslation(undefined).mode, "legacy");
  assert.equal(resolveMachineTranslation({}), null);
  for (const value of [null, false, {}, { ...settings(), providerId: "unknown" }, { ...settings(), version: 2 }, { ...settings(), apiKey: "not-allowed" }]) {
    assert.throws(() => normalizeMachineTranslation(value), { code: "MT_CONFIG" });
  }
});

test("site AI choices and subtitle/assistant routes keep their existing behavior", () => {
  const stored = { machineTranslation: settings(), targetLanguage: "Chinese" };
  assert.equal(resolveMachineTranslation(stored, { serviceRef: { kind: "chatgpt-plan" } }), null);
  for (const surface of ["subtitle", "assistant", "selection-ai"]) assert.equal(resolveMachineTranslation(stored, null, surface), null);
  assert.equal(resolveMachineTranslation(stored, { provider: "broken", machineTranslation: settings("mt-tencent-transmart") }).provider, "mt-tencent-transmart");
});

test("site overrides use the existing port-normalized site identity", () => {
  const site = { machineTranslation: settings() };
  assert.equal(rawTranslationSite({ siteProfiles: { "http://localhost": site } }, "http://localhost:3210/page"), site);
});

test("Chinese variants and auto source are mapped independently for each service", () => {
  assert.equal(machineLanguage("mt-microsoft-web", "auto"), "");
  assert.equal(machineLanguage("mt-microsoft-web", "zh-CN", true), "zh-Hans");
  assert.equal(machineLanguage("mt-microsoft-web", "zh-TW", true), "zh-Hant");
  assert.equal(machineLanguage("mt-tencent-transmart", "auto"), "auto");
  assert.equal(machineLanguage("mt-tencent-transmart", "zh-TW", true), "zh-tw");
  assert.throws(() => machineLanguage("mt-microsoft-web", "auto", true), { code: "MT_LANGUAGE" });
  assert.throws(() => createMachineConfig(settings(), "a custom AI style"), { code: "MT_LANGUAGE" });
});

test("fixed endpoints escape literal HTML, and do not accept a custom destination", async () => {
  const req = buildMachineRequest("mt-microsoft-web", ["<script>&lt;</script>"], "", "zh-Hans");
  assert.equal(new URL(req.url).origin, "https://edge.microsoft.com");
  assert.deepEqual(req.body, ["&lt;script&gt;&amp;lt;&lt;/script&gt;"]);
  const tx = buildMachineRequest("mt-tencent-transmart", ["hello"], "auto", "zh");
  assert.equal(tx.url, "https://transmart.qq.com/api/imt");
  assert.deepEqual(tx.body.source, { text_list: ["hello"], lang: "auto" });
  await assert.rejects(requestMachineTexts({ ...config(), apiBaseUrl: "https://untrusted.invalid/" }, ["hello"]), { code: "MT_CONFIG" });
});

test("HTTP success cannot conceal missing, extra, malformed or translated-away literal entities", () => {
  for (const data of [[], [{ translations: [] }], [{ translations: [{ text: "" }] }], [{ translations: [{ text: "valid" }] }, { translations: [{ text: "extra" }] }]]) {
    assert.throws(() => parseMachineResponse("mt-microsoft-web", data, ["hello"]), { code: "MT_RESPONSE" });
  }
  assert.throws(() => parseMachineResponse("mt-microsoft-web", [{ translations: [{ text: "<code>" }] }], ["&lt;code&gt;"]), { code: "MT_RESPONSE" });
  assert.deepEqual(parseMachineResponse("mt-microsoft-web", [{ translations: [{ text: "&amp;lt;code&amp;gt;" }] }], ["&lt;code&gt;"]), ["&lt;code&gt;"]);
  assert.throws(() => parseMachineResponse("mt-tencent-transmart", { header: { ret_code: "Auth-Failed" } }, ["hello"]), { code: "MT_BLOCKED" });
  assert.throws(() => parseMachineResponse("mt-tencent-transmart", { header: { ret_code: "succ" }, auto_translation: [] }, ["hello"]), { code: "MT_RESPONSE" });
  assert.deepEqual(parseMachineResponse("mt-tencent-transmart", { header: { ret_code: "succ" }, auto_translation: ["你好"] }, ["hello"]), ["你好"]);
});

test("long chunks preserve all Unicode and whitespace; invalid chunk limits are refused", () => {
  const source = "Text with emoji 👩‍💻.\n".repeat(200) + "结束";
  const chunks = splitMachineText(source);
  assert.equal(chunks.join(""), source); assert.ok(chunks.every(chunk => [...chunk].length <= 1000));
  const emoji = "👩‍💻".repeat(500);
  const safe = splitMachineText(emoji, 101);
  assert.equal(safe.join(""), emoji);
  assert.ok(safe.every(chunk => [...chunk].length <= 101 && chunk.split("👩‍💻").join("") === ""));
  assert.throws(() => splitMachineText("👩‍💻", 2), { code: "MT_INPUT" });
  for (const size of [0, -1, Infinity, 1.5]) assert.throws(() => splitMachineText(source, size), { code: "MT_INPUT" });
});

test("formatting markers and protected code never leave the extension", async () => {
  storage(); const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return ok(JSON.parse(init.body).map(text => `译:${text}`)); };
  const text = "Read ⟦TF:0:S⟧secretCode()⟦TF:0:E⟧ with ⟦TF:1:S⟧care⟦TF:1:E⟧.";
  const result = await translateMachineBatch([{ id: "a", text, format: "tf-markers", protectedIds: [0] }], config());
  assert.equal(result[0].id, "a"); assert.match(result[0].text, /⟦TF:0:S⟧secretCode\(\)⟦TF:0:E⟧/u);
  assert.ok(result[0].text.includes("⟦TF:1:S⟧译:care⟦TF:1:E⟧"));
  assert.equal(requests.length, 1); assert.doesNotMatch(requests[0].init.body, /TF:|secretCode/);
  assert.equal(requests[0].init.credentials, "omit"); assert.equal(requests[0].init.redirect, "error");
  assert.deepEqual(requests[0].init.headers, { "Content-Type": "application/json" });
});

test("malformed structure is refused before any request", async () => {
  let calls = 0; globalThis.fetch = () => { calls++; throw new Error("must not call"); };
  for (const segment of [{ id: "a", text: "broken ⟦TF:0:S⟧text" }, { id: "a", text: "plain", protectedIds: [2] }, { id: "a", text: "plain", protectedIds: [-1] }]) {
    await assert.rejects(translateMachineBatch([segment], config()), { code: "MT_STRUCTURE" });
  }
  assert.equal(calls, 0);
});

test("marker-looking user text cannot be silently treated as trusted DOM structure", async () => {
  let calls = 0; globalThis.fetch = () => { calls++; throw new Error("must not call"); };
  const literal = "A literal ⟦TF:0:S⟧user word⟦TF:0:E⟧ inside a selection.";
  for (const segment of [
    { id: "a", text: literal, format: "plain" },
    { id: "a", text: literal },
    { id: "a", text: "plain", format: "tf-markers" },
    { id: "a", text: "plain", format: "plain", protectedIds: [0] }
  ]) {
    await assert.rejects(translateMachineBatch([segment], config()), { code: "MT_STRUCTURE" });
  }
  assert.equal(calls, 0);
});

test("explicit same-language and empty batches make no network calls", async () => {
  let calls = 0; globalThis.fetch = () => { calls++; throw new Error("must not call"); };
  const segments = [{ id: "a", text: "同语言保留原文" }];
  assert.deepEqual(await translateMachineBatch(segments, { ...config(), sourceLanguage: "zh" }), segments);
  assert.deepEqual(await translateMachineBatch([], config()), []); assert.equal(calls, 0);
});

test("MT connection test and normal translation never use saved AI keys", async () => {
  storage({ apiKey: "synthetic-must-not-leave", providerCredentials: { cloud: "synthetic-must-not-leave" } });
  const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return ok(["测试译文"]); };
  const result = await runTranslationRequest({ requestId: "mt-protocol", segments: [{ id: "s", text: "hello" }], config: config() });
  assert.equal(result[0].text, "测试译文"); assert.doesNotMatch(JSON.stringify(calls), /synthetic-must-not-leave|Authorization|Cookie/);
});

test("missing and broken AI configurations do not prevent explicit free translation or dictionary routing", async () => {
  storage({ defaultService: { kind: "api-key", connectionId: "missing" }, aiServiceConfigured: true,
    providerConnections: { existing: normalizeProviderConnection({ id: "existing", protocol: "openai-chat", baseUrl: "https://example.invalid/v1", defaultModel: "test", settings: {} }) } });
  assert.equal((await translationConfig(page)).engine, MACHINE_ENGINE);
  const selection = await resolveSelectionRequest({ text: "a sentence for translation", pageUrl: page });
  assert.equal(selection.route, "translation");
  await assert.rejects(getEffectiveConfig(page), { code: "CONNECTION_MISSING" });
  await assert.rejects(translationEngineSettings(page, { surface: "selection-ai" }), { code: "CONNECTION_MISSING" });
});

test("global save changes only the new field; site save preserves AI and appearance overrides", async () => {
  const ai = { defaultService: { kind: "chatgpt-plan" }, providerCredentials: { cloud: "synthetic" }, siteProfiles: { "https://fixture.invalid": { model: "old-model", appearance: "compact", serviceRef: { kind: "chatgpt-plan" } } } };
  const { memory, writes } = storage(ai);
  await saveMachineTranslationSettings({ scope: "global", config: settings(), consent: true });
  assert.deepEqual(Object.keys(writes[0]), ["machineTranslation"]);
  await saveMachineTranslationSettings({ scope: "site", pageUrl: page, config: settings("mt-tencent-transmart"), consent: true });
  assert.equal(memory.siteProfiles["https://fixture.invalid"].model, "old-model");
  assert.equal(memory.siteProfiles["https://fixture.invalid"].appearance, "compact");
  await saveMachineTranslationSettings({ scope: "site", pageUrl: page, inherit: true });
  assert.deepEqual(memory.siteProfiles, ai.siteProfiles); assert.deepEqual(memory.providerCredentials, ai.providerCredentials);
});

test("free mode requires consent and permission; settings/test messages reject page content", async () => {
  storage();
  await assert.rejects(saveMachineTranslationSettings({ scope: "global", config: settings() }), { code: "MT_CONSENT" });
  await assert.rejects(testMachineTranslationSettings({ providerId: "mt-microsoft-web", requestId: "no-consent" }), { code: "MT_CONSENT" });
  chrome.permissions.contains = async () => false;
  await assert.rejects(testMachineTranslationSettings({ providerId: "mt-microsoft-web", consent: true, requestId: "no-access" }), { code: "MT_PERMISSION" });
  await assert.rejects(saveMachineTranslationSettings({ scope: "global", config: settings(), consent: true }), { code: "MT_PERMISSION" });
  await assert.rejects(requestMachineTexts(config(), ["hello"]), { code: "MT_PERMISSION" });
  assert.throws(() => handleMachineSettingsMessage({ type: M.MACHINE_TRANSLATION_TEST }, sender), { code: "MT_PERMISSION" });
});

test("MT snapshots bind tab, document, URL and expire without a paid fallback", async () => {
  storage();
  const snapshot = await createEffectiveConfigSnapshot(page, {}, sender);
  assert.match(snapshot.id, /^mt:/); assert.equal((await resolveEffectiveConfigSnapshot(snapshot.id, page, sender)).provider, "mt-microsoft-web");
  for (const owner of [{ ...sender, tab: { id: 2 } }, { ...sender, documentId: "next" }, { ...sender, url: "https://other.invalid/" }, null]) {
    await assert.rejects(resolveEffectiveConfigSnapshot(snapshot.id, page, owner), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  }
  await assert.rejects(resolveEffectiveConfigSnapshot("", page, sender), { code: "CONFIG_SNAPSHOT_EXPIRED" });
  invalidateMachineSnapshots();
  await assert.rejects(resolveEffectiveConfigSnapshot(snapshot.id, page, sender), { code: "CONFIG_SNAPSHOT_EXPIRED" });
});

test("DB4 identities isolate MT service, language, endpoint, format and protected code", async () => {
  const value = config(), hash = await getConfigHash(value);
  for (const patch of [{ provider: "mt-tencent-transmart" }, { sourceLanguage: "en" },
    { targetLanguage: "ja" }, { apiBaseUrl: "https://example.invalid" }, { inputVersion: "mt-slots-v2" }])
    assert.notEqual(await getConfigHash({ ...value, ...patch }), hash);
  assert.equal(await getConfigHash({ ...value, apiKey: "ignored", prompt: "AI prompt ignored" }), hash);
  const rich = "same ⟦TF:0:S⟧text⟦TF:0:E⟧";
  const plain = await createTranslationIdentity(value, { text: rich, format: "tf-markers", protectedIds: [] }, "page");
  const guarded = await createTranslationIdentity(value, { text: rich, format: "tf-markers", protectedIds: [0] }, "page");
  assert.notEqual(plain.key, guarded.key);
  assert.notEqual(buildTranslationRequestKey([{ id: "a", text: rich, format: "tf-markers", protectedIds: [] }], value),
    buildTranslationRequestKey([{ id: "a", text: rich, format: "tf-markers", protectedIds: [0] }], value));
  assert.notEqual(await translationSourceHash("Hello world", value), await translationSourceHash("Other text", value));
});

test("MT request identity evolves separately from the DB4 record envelope", async () => {
  assert.equal(CACHE_RECORD_VERSION, 1);
  const value = config(), base = await getConfigHash(value);
  assert.equal(await getConfigHash({ ...value, cacheSchema: 999, cacheDatabaseVersion: 2 }), base);
  assert.notEqual(await getConfigHash({ ...value, translationStrategyVersion: "new-input-v2" }), base);
  const ai = { provider: "deepseek", model: "test", targetLanguage: "Chinese", prompt: "Translate" };
  assert.notEqual(await getConfigHash(ai), await getConfigHash({ ...ai, prompt: "Different prompt" }));
});

test("MT results validate against existing Reading schema, without assistant or dictionary mutation", async () => {
  const result = await readingTranslationResult(config());
  const artifact = { schemaVersion: 1, artifactId: "mt-result", recordId: crypto.randomUUID(), operationId: "operation", sourceSnapshotId: "source",
    kind: "translation", targetLanguage: result.targetLanguage, createdAt: 1, payload: { text: "译文" }, provenance: result.provenance };
  assert.equal(validateResultArtifact(artifact).kind, "translation");
  assert.equal(artifact.provenance.promptVersion, "mt-adapter-v1"); assert.equal(artifact.provenance.model, "not-disclosed");
});

test("queued cancellation sends no second request and one consumer cannot cancel another tab", async () => {
  storage(); const started = defer(), finish = defer(); let count = 0;
  globalThis.fetch = async () => { count++; started.resolve(); await finish.promise; return ok(["译文"]); };
  const first = runTranslationRequest({ requestId: "first-tab", ownerTabId: 1, segments: [{ id: "s", text: "hello" }], config: config() });
  const second = runTranslationRequest({ requestId: "second-tab", ownerTabId: 2, segments: [{ id: "s", text: "hello" }], config: config() });
  await started.promise; const cancelled = assert.rejects(first, { code: "CANCELLED" }); cancelMachineTranslations(1);
  finish.resolve(); await cancelled; assert.equal((await second)[0].text, "译文"); assert.equal(count, 1);
});

test("active HTTP ownership includes body read and queued cancellation does not leak slots", async () => {
  storage(); const started = defer(), finish = defer(), abort = new AbortController(); let count = 0;
  globalThis.fetch = async () => { count++; started.resolve(); await finish.promise; return ok(["译文"]); };
  const first = requestMachineTexts(config(), ["first"]); await started.promise;
  const second = requestMachineTexts(config(), ["queued"], { signal: abort.signal });
  const rejected = assert.rejects(second, { code: "CANCELLED" }); abort.abort(); await rejected;
  finish.resolve(); await first; assert.equal(count, 1);
  assert.deepEqual(await requestMachineTexts(config(), ["next"]), ["译文"]); assert.equal(count, 2);
});

test("timeout also cancels a stalled response body, and the next request works", async () => {
  storage(); let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(requestMachineTexts(config(), ["hello"], { timeoutMs: 15 }), { code: "MT_TIMEOUT" });
  assert.equal(cancelled, true); globalThis.fetch = async () => ok(["恢复"]);
  assert.deepEqual(await requestMachineTexts(config(), ["next"]), ["恢复"]);
});

test("oversized and non-JSON responses are refused rather than displayed or persisted", async () => {
  storage(); globalThis.fetch = async () => new Response("<html>blocked</html>");
  await assert.rejects(requestMachineTexts(config(), ["hello"]), { code: "MT_RESPONSE" });
  globalThis.fetch = async () => new Response("x".repeat(512 * 1024 + 1));
  await assert.rejects(requestMachineTexts(config(), ["hello"]), { code: "MT_RESPONSE" });
});

test("rate-limit cooldown survives a new request and never falls back to Tencent or paid AI", async () => {
  const { memory } = storage(); let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("limited", { status: 429, headers: { "Retry-After": "120" } }); };
  await assert.rejects(requestMachineTexts(config(), ["hello"]), { code: "MT_RATE_LIMIT" });
  assert.ok(memory["tfMtCooldown:mt-microsoft-web"].until >= Date.now() + 110000);
  await assert.rejects(requestMachineTexts(config(), ["again"]), { code: "MT_RATE_LIMIT" }); assert.equal(calls, 1);
});
