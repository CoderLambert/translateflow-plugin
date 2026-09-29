import {
  test,
  expect
} from "./support/extension-fixture.mjs";

test.describe("curated ECDICT product flow", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("visible Settings install activates the locked upstream pack for Selection without Provider calls", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );

    const row = options
      .locator("#curatedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("上游 / 社区");
    await expect(row).toContainText("ECDICT");
    await row
      .getByRole("button", { name: "下载并安装" })
      .click();

    await expect(row).toContainText("安装完成", {
      timeout: 150_000
    });
    const installDetail = String(
      await row
        .locator(".dictionary-pack-detail")
        .textContent()
    ).trim();
    expect(installDetail).toMatch(
      /^安装完成：[\d,]+ 个词条 · 输出 \d+(?:\.\d+)? (?:KiB|MiB)。$/
    );
    console.log(
      "[ECDICT_PRODUCT_METRICS]",
      "inputBytes=65933428",
      installDetail
    );

    const installed = options
      .locator("#installedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(installed).toBeVisible();
    await expect(installed).toContainText("上游 / 社区");

    const page = await harness.open("/selection");
    await page.evaluate(() => {
      const node = document.createElement("p");
      node.id = "curated-ecdict-word";
      node.textContent = "hello";
      document.body.appendChild(node);
    });
    await harness.inject(page);
    await selectElementText(page, "#curated-ecdict-word");
    await page.locator(".tf-selection-chip").click();
    await expect(
      page.locator(".tf-selection-result")
    ).toBeVisible();

    const qualitySamples = [];
    for (const sample of [
      { word: "hello", expected: /你好|您好|喂/u },
      { word: "run", expected: /跑|运行|经营/u },
      { word: "quay", expected: /码头|岸壁/u }
    ]) {
      const candidate = await lookupEcdictCandidate(
        harness,
        page.url(),
        sample.word
      );
      const translations = (candidate.translations || [])
        .join("\n");
      expect(translations).toMatch(sample.expected);
      qualitySamples.push({
        word: sample.word,
        translation: translations.slice(0, 240)
      });
    }
    console.log(
      "[ECDICT_PRODUCT_QUALITY]",
      JSON.stringify(qualitySamples)
    );
    expect(harness.server.calls).toHaveLength(0);

    await installed
      .getByRole("button", { name: "删除" })
      .click();
    await expect(installed).toHaveCount(0);

    const afterDelete = await harness.runtime({
      type: "LEXICAL_LOOKUP",
      text: "hello",
      pageUrl: page.url(),
      sourceLanguage: "en",
      targetLanguage: "zh-CN"
    });
    expect(afterDelete.ok).toBe(true);
    expect(
      (afterDelete.candidates || []).some((candidate) =>
        candidate.senses?.some((sense) =>
          sense.sourceRefs?.some(
            (sourceRef) => sourceRef.sourceId === "ecdict"
          )
        )
      )
    ).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });
});

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


async function lookupEcdictCandidate(
  harness,
  pageUrl,
  text
) {
  const lookup = await harness.runtime({
    type: "LEXICAL_LOOKUP",
    text,
    pageUrl,
    sourceLanguage: "en",
    targetLanguage: "zh-CN"
  });
  expect(lookup.ok).toBe(true);
  expect(lookup.status).toBe("candidates");
  const candidate = (lookup.candidates || []).find(
    (item) =>
      item.provenance?.sourceRefs?.some(
        (sourceRef) => sourceRef.sourceId === "ecdict"
      )
  );
  expect(candidate, text + " should have an ECDICT candidate")
    .toBeTruthy();
  return candidate;
}
