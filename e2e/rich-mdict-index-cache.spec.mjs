import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

test.describe("Rich MDict parsed-index cache", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("multiple installed dictionaries return identical local results warm and after worker restart", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
    const alpha = await installFixture(options, {
      title: "Cache Fixture Alpha",
      fileName: "cache-alpha.mdx",
      meaning: "Alpha cache meaning"
    });
    const beta = await installFixture(options, {
      title: "Cache Fixture Beta",
      fileName: "cache-beta.mdx",
      meaning: "Beta cache meaning"
    });

    const cold = await harness.runtime({ type: "RICH_MDICT_LOOKUP", text: "cachefixture" });
    expect(cold.found).toBe(true);
    expect(cold.dictionaries.map((dictionary) => dictionary.text)).toEqual([
      "Alpha cache meaning", "Beta cache meaning"
    ]);
    expect(cold.errors).toEqual([]);

    for (let repeat = 0; repeat < 3; repeat += 1) {
      const warm = await harness.runtime({ type: "RICH_MDICT_LOOKUP", text: "cachefixture" });
      expect(warm).toEqual(cold);
    }

    expect(alpha.id).not.toBe(beta.id);
    const restart = await harness.restartBrowser();
    expect(restart.restartedPersistentProfile).toBe(true);
    const afterRestart = await harness.runtime({ type: "RICH_MDICT_LOOKUP", text: "cachefixture" });
    expect(afterRestart).toEqual(cold);
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function installFixture(options, { title, fileName, meaning }) {
  const bytes = makeRichMdx([["cachefixture", `<p>${meaning}</p>`]], {
    title,
    encrypted: 2,
    compact: "Yes",
    compat: "Yes"
  });
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: bytes
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText(title);
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
  const row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-dictionary-id");
  expect(id).toMatch(/^rich-mdict-[a-f0-9-]{36}$/u);
  return { id };
}
