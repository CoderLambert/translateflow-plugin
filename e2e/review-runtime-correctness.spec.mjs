import { test, expect } from "./support/extension-fixture.mjs";
import { BACKGROUND_MESSAGES as B } from "../src/shared/constants.js";

test.beforeEach(async ({ harness }) => { await harness.reset(); });
const send = (page, type, fields = {}) => page.evaluate(message => chrome.runtime.sendMessage(message), { type, ...fields });

test("review regression: concurrent connection edits and deletions preserve routing", async ({ harness }) => {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#provider`);
  const initial = await send(options, B.PROVIDER_CONNECTIONS_LIST);
  expect(initial.ok).toBe(true);
  const edits = await Promise.all(initial.connections.map(connection => send(options, B.PROVIDER_CONNECTION_UPSERT,
    { connection: { ...connection, name: `Updated ${connection.id}` }, expectedRevision: connection.revision })));
  expect(edits.every(response => response.ok)).toBe(true);
  const listed = await send(options, B.PROVIDER_CONNECTIONS_LIST);
  expect(listed.connections.every(connection => connection.name === `Updated ${connection.id}`)).toBe(true);
  const local = listed.connections.find(connection => connection.id === "openai-compatible");
  await send(options, B.DEFAULT_SERVICE_SET, { service: { kind: "chatgpt-plan" } });
  await harness.setStorage({ siteProfiles: { "https://private.example": { provider: "openai-compatible" } } });
  expect(await send(options, B.PROVIDER_CONNECTION_DELETE, { connectionId: local.id, expectedRevision: local.revision }))
    .toMatchObject({ ok: false, errorCode: "CONNECTION_IN_USE" });
  await harness.setStorage({ siteProfiles: {} });
  for (const connection of listed.connections) {
    expect(await send(options, B.PROVIDER_CONNECTION_DELETE, { connectionId: connection.id, expectedRevision: connection.revision })).toMatchObject({ ok: true, deleted: true });
  }
  await options.reload();
  expect(await send(options, B.PROVIDER_CONNECTIONS_LIST)).toMatchObject({ ok: true, connections: [], defaultService: { kind: "chatgpt-plan" } });
  expect(harness.server.calls).toHaveLength(0);
  await options.close();
});

test("review regression: reference-only messages cannot restore deleted words or replace new answers", async ({ harness }) => {
  const content = await harness.open("/selection"), tabId = await harness.tabId(content);
  const center = await harness.context.newPage();
  await center.goto(`chrome-extension://${harness.extensionId}/learning-center.html#wordbook`);
  // Preserve null fields across Chrome scripting argument serialization.
  const fromContent = message => harness.driver.evaluate(async ({ tabId, message }) => {
    const [response] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED",
      func: input => chrome.runtime.sendMessage(JSON.parse(input)), args: [JSON.stringify(message)] });
    return response.result;
  }, { tabId, message });
  const note = { headword: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN", action: "understand", text: "Old synthetic answer", turnId: "old-turn",
    provenance: { provider: "mock", model: "mock", promptVersion: "v1", providerConfigFingerprint: "opaque" }, readingRef: null };
  const saved = await fromContent({ type: B.VOCABULARY_BOOK_ADD_AI_NOTE, note });
  expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
  const reference = { entryId: saved.entry.id, action: note.action, turnId: note.turnId, readingRef: { recordId: "record-1", artifactId: "artifact-1" } };
  expect(await fromContent({ type: B.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE, reference })).toMatchObject({ ok: true, updated: true });
  expect(await send(center, B.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE, { reference })).toMatchObject({ ok: false });
  expect(await fromContent({ type: B.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE, reference: { ...reference, text: "forged" } }))
    .toMatchObject({ ok: false, errorCode: "VOCABULARY_BAD_DATA" });
  await fromContent({ type: B.VOCABULARY_BOOK_ADD_AI_NOTE, note: { ...note, text: "New synthetic answer", turnId: "new-turn" } });
  expect(await fromContent({ type: B.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE, reference })).toMatchObject({ ok: true, updated: false });
  const listed = await send(center, B.VOCABULARY_BOOK_LIST);
  expect(listed.entries[0].aiNotes[0]).toMatchObject({ turnId: "new-turn", text: "New synthetic answer", readingRef: null });
  expect(await send(center, B.VOCABULARY_BOOK_REMOVE, { id: saved.entry.id })).toMatchObject({ ok: true, removed: true });
  expect(await fromContent({ type: B.VOCABULARY_BOOK_SYNC_AI_NOTE_REFERENCE, reference })).toMatchObject({ ok: true, updated: false });
  expect(await send(center, B.VOCABULARY_BOOK_LIST)).toMatchObject({ ok: true, count: 0 });
  expect(harness.server.calls).toHaveLength(0);
  await content.close(); await center.close();
});
