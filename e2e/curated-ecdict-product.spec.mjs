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
    await expect(row).toContainText("精选上游 · 非官方");
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
    await expect(installed).toContainText("精选上游 · 非官方");
    await expect(
      row.getByRole("button", { name: "重新安装" })
    ).toBeVisible();
    await expect(row).toContainText("已安装 · 可用");

    const syntheticUpdate = await options.evaluate(async () => {
      const [{ getCuratedInstallPresentation }, recipes] =
        await Promise.all([
          import(
            chrome.runtime.getURL(
              "src/options/curated-dictionary-ui.js"
            )
          ),
          import(
            chrome.runtime.getURL(
              "src/shared/curated-dictionaries.js"
            )
          )
        ]);
      return getCuratedInstallPresentation(
        recipes.CURATED_DICTIONARIES[0],
        {
          status: "healthy",
          active: {
            packVersion: "2024-older-reviewed"
          }
        }
      );
    });
    expect(syntheticUpdate.status).toBe("update-available");
    expect(syntheticUpdate.badgeLabel).toBe("有已审核更新");
    expect(syntheticUpdate.actionLabel).toBe("更新");

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
        candidate.provenance?.sourceRefs?.some(
          (sourceRef) => sourceRef.sourceId === "ecdict"
        )
      )
    ).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("denied exact upstream permission stops before Worker download or import commit", async ({ harness }) => {
    const options = await harness.context.newPage();
    await options.addInitScript(() => {
      window.__tfCuratedPermissionRequests = [];
      window.__tfCuratedWorkerCreations = 0;
      window.__tfCuratedImportCommits = 0;

      const originalRequest = chrome.permissions.request;
      try {
        chrome.permissions.request = async (details) => {
          window.__tfCuratedPermissionRequests.push(details);
          return false;
        };
      } catch {
        Object.defineProperty(chrome.permissions, "request", {
          configurable: true,
          value: async (details) => {
            window.__tfCuratedPermissionRequests.push(details);
            return false;
          }
        });
      }
      window.__tfCuratedPermissionStubInstalled =
        chrome.permissions.request !== originalRequest;

      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args) {
          window.__tfCuratedWorkerCreations += 1;
          return Reflect.construct(target, args);
        }
      });
      window.__tfCuratedWorkerSpyInstalled =
        window.Worker !== NativeWorker;

      const originalSendMessage = chrome.runtime.sendMessage;
      const nativeSendMessage = originalSendMessage.bind(
        chrome.runtime
      );
      chrome.runtime.sendMessage = (...args) => {
        if (args[0]?.type === "DICTIONARY_LOCAL_IMPORT_COMMIT") {
          window.__tfCuratedImportCommits += 1;
        }
        return nativeSendMessage(...args);
      };
      window.__tfCuratedCommitSpyInstalled =
        chrome.runtime.sendMessage !== originalSendMessage;
    });

    await options.goto(
      `chrome-extension://${harness.extensionId}/options.html#dictionary-packs`
    );
    const row = options
      .locator("#curatedDictionaryList .site-row")
      .filter({ hasText: "ECDICT 高频英汉" });
    await expect(row).toBeVisible();
    await row
      .getByRole("button", { name: "下载并安装" })
      .click();

    await expect(row).toContainText(
      "未授予 ECDICT 高频英汉 上游下载权限。"
    );
    const denialEvidence = await options.evaluate(() => ({
      permissionRequests: window.__tfCuratedPermissionRequests,
      workerCreations: window.__tfCuratedWorkerCreations,
      importCommits: window.__tfCuratedImportCommits,
      permissionStubInstalled:
        window.__tfCuratedPermissionStubInstalled,
      workerSpyInstalled: window.__tfCuratedWorkerSpyInstalled,
      commitSpyInstalled: window.__tfCuratedCommitSpyInstalled
    }));
    expect(denialEvidence.permissionRequests).toEqual([
      { origins: ["https://raw.githubusercontent.com/*"] }
    ]);
    expect(denialEvidence.workerCreations).toBe(0);
    expect(denialEvidence.importCommits).toBe(0);
    expect(denialEvidence.permissionStubInstalled).toBe(true);
    expect(denialEvidence.workerSpyInstalled).toBe(true);
    expect(denialEvidence.commitSpyInstalled).toBe(true);

    const status = await options.evaluate(() => chrome.runtime.sendMessage({
      type: "DICTIONARY_PACK_STATUS"
    }));
    expect(status.ok).toBe(true);
    expect(
      status.state?.packs?.["local-curated-ecdict-en-zh"]
    ).toBeUndefined();
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
