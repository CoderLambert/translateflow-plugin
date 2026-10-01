import {
  test,
  expect
} from "./support/extension-fixture.mjs";

test.describe("StarDict visible local import product flow", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test.afterEach(async ({ harness }) => {
    for (const page of harness.context.pages()) {
      if (
        page !== harness.driver &&
        !page.isClosed()
      ) {
        await page.close();
      }
    }
  });

  test("Settings import reaches Selection without Provider and uninstall removes lookup", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );

    const fixture = makeStarDictFixture();
    await options.locator("#localDictionaryFiles").setInputFiles([
      {
        name: "issue165.ifo",
        mimeType: "text/plain",
        buffer: Buffer.from(fixture.ifoBytes)
      },
      {
        name: "issue165.idx",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(fixture.idxBytes)
      },
      {
        name: "issue165.dict",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(fixture.dictBytes)
      }
    ]);

    await expect(
      options.locator("#localDictionaryPreflightSummary")
    ).toContainText("Issue 165 E2E Dictionary");
    await expect(
      options.locator("#localDictionaryPreflightSummary")
    ).toContainText("StarDict 结构化词典");

    await expect(options.locator("#localDictionarySemanticLabel")).toBeVisible();
    await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
    await options.locator("#localDictionarySemanticConfirmation").focus();
    await options.locator("#localDictionarySemanticConfirmation").press("Space");
    await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
    await options.locator("#localDictionaryImportButton").click();

    await expect(
      options.locator("#localDictionaryImportProgress")
    ).toContainText("完成");
    const installed = options
      .locator("#installedDictionaryList .site-row")
      .filter({ hasText: "Issue 165 E2E Dictionary" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("本地导入");
    await expect(installed).toContainText("本地导入 · 用户提供 / 未验证");
    await expect(installed).toContainText("StarDict");

    await options.reload();
    await expect(
      options
        .locator("#installedDictionaryList .site-row")
        .filter({ hasText: "Issue 165 E2E Dictionary" })
    ).toBeVisible();

    const page = await harness.open("/selection");
    await page.evaluate(({ word }) => {
      const node = document.createElement("p");
      node.id = "issue-165-local-word";
      node.textContent = word;
      document.body.appendChild(node);
    }, { word: fixture.word });
    await harness.inject(page);

    await selectElementText(page, "#issue-165-local-word");
    await page.locator(".tf-selection-chip").click();
    await expect(
      page.locator(".tf-selection-result")
    ).toContainText(fixture.translation);
    await expect(
      page.locator(".tf-selection-primary")
    ).toContainText(fixture.translation);
    expect(harness.server.calls).toHaveLength(0);

    const lookupBefore = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: fixture.word,
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(lookupBefore.ok).toBe(true);
    expect(lookupBefore.status).toBe("candidates");
    expect(
      lookupBefore.candidates.some(
        (candidate) =>
          candidate.translations?.includes(
            fixture.translation
          )
      )
    ).toBe(true);

    const reloadedInstalled = options
      .locator("#installedDictionaryList .site-row")
      .filter({ hasText: "Issue 165 E2E Dictionary" });
    await reloadedInstalled
      .getByRole("button", { name: "删除" })
      .click();
    await expect(reloadedInstalled).toHaveCount(0);

    const lookupAfter = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: fixture.word,
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(lookupAfter.ok).toBe(true);
    expect(
      lookupAfter.candidates?.some(
        (candidate) =>
          candidate.translations?.includes(
            fixture.translation
          )
      ) || false
    ).toBe(false);

    await page
      .getByRole("button", { name: "关闭" })
      .click();
    await selectElementText(page, "#issue-165-local-word");
    await page.locator(".tf-selection-chip").click();
    await expect(
      page.locator(".tf-selection-result")
    ).not.toContainText(fixture.translation);
    expect(harness.server.calls).toHaveLength(0);
  });
});

function makeStarDictFixture() {
  const encoder = new TextEncoder();
  const word = "issueonefivelocalword";
  const translation = "本地导入专用释义";
  const wordBytes = encoder.encode(word);
  const dictBytes = encoder.encode(translation);
  const idxBytes = new Uint8Array(
    wordBytes.byteLength + 1 + 8
  );
  idxBytes.set(wordBytes, 0);
  const view = new DataView(idxBytes.buffer);
  view.setUint32(wordBytes.byteLength + 1, 0, false);
  view.setUint32(
    wordBytes.byteLength + 5,
    dictBytes.byteLength,
    false
  );
  const ifoBytes = encoder.encode([
    "StarDict's dict ifo file",
    "version=2.4.2",
    "bookname=Issue 165 E2E Dictionary",
    "wordcount=1",
    "idxfilesize=" + idxBytes.byteLength,
    "sametypesequence=m",
    ""
  ].join("\n"));
  return {
    word,
    translation,
    ifoBytes,
    idxBytes,
    dictBytes
  };
}

async function selectElementText(page, selector) {
  await page.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });
}
