import { afterEach, expect, test, vi } from "vitest";

vi.mock("../../src/background/config.js", () => ({ getEffectiveGlossary: vi.fn(async () => []) }));
import { getEffectiveGlossary } from "../../src/background/config.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

test("production lexical runtime returns no-hit with no installed dictionary and keeps glossary overrides", async () => {
  const get = vi.fn(async () => ({}));
  const set = vi.fn();
  const fetch = vi.fn(() => { throw new Error("local lookup must not fetch package assets or call a Provider"); });
  const getDirectory = vi.fn(() => { throw new Error("no installed packs must not open OPFS"); });
  vi.stubGlobal("chrome", { storage: { local: { get, set } } });
  vi.stubGlobal("navigator", { storage: { getDirectory } });
  vi.stubGlobal("fetch", fetch);
  const { runLexicalLookup } = await import("../../src/background/lexical/index.js");
  const input = { text: "persistent", sourceLanguage: "en", targetLanguage: "zh-CN" };

  await expect(runLexicalLookup(input)).resolves.toMatchObject({ status: "no-hit" });
  vi.mocked(getEffectiveGlossary).mockResolvedValueOnce([{ id: "personal", source: "persistent", target: "个人译法", enabled: true, caseSensitive: false }] as never);
  await expect(runLexicalLookup(input)).resolves.toMatchObject({
    status: "candidates", matchedBy: "user-glossary",
    candidates: [{ translations: ["个人译法"] }]
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(getDirectory).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
