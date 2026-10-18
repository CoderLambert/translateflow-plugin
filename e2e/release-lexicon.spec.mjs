import { test, expect } from "./support/extension-fixture.mjs";
import { USER_LEXICAL_PACK_ID, USER_TECHNICAL_PACK_ID } from "./support/user-dictionaries.mjs";

// Keep the former release-pack integration coverage on explicit user dictionaries.
// The package and shared fixture both start with no dictionary installed.
test("production extension resolves installed user packs without Provider calls", async ({ harness }) => {
  const page = await harness.open("/article");
  const pageUrl = page.url();
  const lookup = (text, extra = {}) => harness.runtime({
    type: "LEXICAL_LOOKUP", text, pageUrl, sourceLanguage: "en", targetLanguage: "zh-CN", ...extra
  });
  const fresh = await lookup("persistent");
  expect(fresh.status).toBe("no-hit");
  expect(harness.server.calls).toHaveLength(0);
  const manifests = await harness.installUserDictionaries();
  let settings = await harness.context.newPage();
  await settings.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  const status = await settings.evaluate(() => chrome.runtime.sendMessage({ type: "DICTIONARY_PACK_STATUS" }));
  expect(status.ok).toBe(true);
  expect(Object.keys(status.state.packs).sort()).toEqual([USER_LEXICAL_PACK_ID, USER_TECHNICAL_PACK_ID].sort());

  for (const [word, packId] of [["persistent", USER_LEXICAL_PACK_ID], ["tmux", USER_TECHNICAL_PACK_ID]]) {
    const result = await lookup(word);
    const manifest = manifests.find(item => item.packId === packId);
    expect(result.status).toBe("candidates");
    expect(result.candidates.some(candidate => candidate.provenance.packId === packId && candidate.provenance.fingerprint === manifest.fingerprint)).toBe(true);
  }
  const session = await lookup("session");
  expect(session.status).toBe("candidates");
  expect(session.candidates.some(candidate => candidate.kind === "technical-concept")).toBe(true);
  expect(session.candidates.some(candidate => candidate.provenance.packId === USER_LEXICAL_PACK_ID)).toBe(true);
  expect((await lookup("runtime system")).status).toBe("candidates");
  expect((await lookup("persistent session")).status).toBe("no-hit");
  expect((await lookup("sessions")).status).toBe("candidates");
  expect((await lookup("persistent", { sourceLanguage: "ja" })).status).toBe("unsupported");
  expect(harness.server.calls).toHaveLength(0);

  await settings.close();
  await harness.restartBrowser();
  expect((await lookup("persistent")).status).toBe("candidates");
  expect(harness.server.calls).toHaveLength(0);
  settings = await harness.context.newPage();
  await settings.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await expect(settings.locator(`#installedDictionaryList [data-pack-id="${USER_LEXICAL_PACK_ID}"]`)).toContainText("可用");
  await expect(settings.locator(`#installedDictionaryList [data-pack-id="${USER_TECHNICAL_PACK_ID}"]`)).toContainText("可用");
  await settings.close();
  if (!page.isClosed()) await page.close();
});
