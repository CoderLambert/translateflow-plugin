import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { readMddInteropFixture } from "../tests/helpers/mdd-fixture.mjs";

const TRUST_LABEL = "本地导入 · 用户提供 / 未验证";
const evidenceDir = process.env.DICTIONARY_LIBRARY_VNEXT_EVIDENCE_DIR ||
  resolve("test-results/dictionary-library-vnext-evidence");

test.describe("Dictionary Library vNext integrated product flow", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("two local rich MDX dictionaries and one attached MDD keep isolated cards, preferences, and resources", async ({ harness }) => {
    const options = await openOptions(harness);
    const baseline = await resolveStructuredPrimary(harness, `${harness.server.baseUrl}/selection`);
    expect(baseline.route).toBe("local");
    expect(baseline.topCandidateId).toBeTruthy();

    const alpha = await installRichDictionary(options, {
      title: "Field Notes · Alpha",
      fileName: "field-notes-alpha.mdx",
      records: [
        ["persistent", "<div><p><b>persistent</b> <i>/pərˈsɪstənt/</i> <span>adjective</span></p><ol><li>Continuing firmly over time.</li><li>Remaining active despite interference.</li></ol><p>Alpha's synthetic editorial usage note.</p></div>"],
        ["persistently", "<p>In a persistent manner; with continued effort.</p>"]
      ]
    });
    const beta = await installRichDictionary(options, {
      title: "Field Notes · Beta",
      fileName: "field-notes-beta.mdx",
      records: [
        ["persistent", "<article><p><b>persistent</b> <i>/pəˈsɪstənt/</i> <span>adjective</span></p><table><tr><th>Sense</th><th>Gloss</th></tr><tr><td>1</td><td>Lasting or continuing without interruption.</td></tr><tr><td>2</td><td>Continuing to exist or recur.</td></tr></table><p>Beta's synthetic usage panel.</p><img src=\"interop/sample.png\" alt=\"Beta local illustration\"></article>"],
        ["persistence", "<p>The quality of continuing steadily despite difficulty.</p>"]
      ]
    });

    const { mdd } = await readMddInteropFixture();
    await attachMddFile(beta.row, {
      name: "field-notes-beta.mdd",
      mimeType: "application/octet-stream",
      buffer: mdd
    });

    await setDictionaryPreference(options, alpha.row, "enabled", true);
    await setDictionaryPreference(options, beta.row, "enabled", true);
    await setDictionaryPreference(options, alpha.row, "expandedByDefault", false);
    await setDictionaryPreference(options, beta.row, "expandedByDefault", true);
    await moveDictionaryUp(options, beta.id);
    await options.reload();
    await expectDictionaryPreferences(options, beta.id, {
      enabled: true,
      expandedByDefault: true,
      order: 0
    });
    await expectDictionaryPreferences(options, alpha.id, {
      enabled: true,
      expandedByDefault: false,
      order: 1024
    });
    await expect(options.locator("#richMdictInstalledList .site-row").first())
      .toHaveAttribute("data-dictionary-id", beta.id);

    const initialIdentity = await readDictionaryIdentity(options, [alpha.id, beta.id]);
    expect(initialIdentity[alpha.id].sourceId).toBe("local-rich-mdict");
    expect(initialIdentity[beta.id].sourceId).toBe("local-rich-mdict");
    expect(initialIdentity[alpha.id].trustLabel).toBe(TRUST_LABEL);
    expect(initialIdentity[beta.id].trustLabel).toBe(TRUST_LABEL);

    const betaBytesBeforeDisable = await readInstalledSourceBytes(options, beta.id);
    const alphaBytesBeforeDisable = await readInstalledSourceBytes(options, alpha.id);
    expect(betaBytesBeforeDisable).toBeGreaterThan(0);
    expect(alphaBytesBeforeDisable).toBeGreaterThan(0);

    const resourceProbe = await harness.open("/selection");
    await harness.inject(resourceProbe);
    const matchingResource = await readMddResource(harness, resourceProbe, beta.id, "interop/sample.png");
    const mismatchedResource = await readMddResource(harness, resourceProbe, alpha.id, "interop/sample.png");
    expect(matchingResource).toMatchObject({ ok: true, found: true, mime: "image/png" });
    expect(mismatchedResource).toMatchObject({ ok: true, found: false });
    await resourceProbe.close();

    // Disabling affects the viewer list while leaving the installed source in place.
    await setDictionaryPreference(options, alpha.row, "enabled", false);
    await options.reload();
    await expectDictionaryPreferences(options, alpha.id, {
      enabled: false,
      expandedByDefault: false,
      order: 1024
    });
    expect(await readInstalledSourceBytes(options, alpha.id)).toBe(alphaBytesBeforeDisable);

    const remoteRequests = [];
    const page = await harness.open("/selection");
    page.on("request", (request) => {
      const url = request.url();
      if (/^https?:/iu.test(url) && new URL(url).origin !== harness.server.baseUrl) {
        remoteRequests.push(url);
      }
    });
    await installRichViewerProbe(harness, page);
    await harness.inject(page);
    await selectElementText(page, "#ambiguous");
    const disabledPrimaryStarted = Date.now();
    await page.locator(".tf-selection-chip").click();
    const firstPrimary = page.locator(".tf-selection-primary").first();
    await expect(firstPrimary).toContainText("持久的");
    const primaryVisibleMs = Date.now() - disabledPrimaryStarted;
    await expect(page.locator(".tf-selection-rich-record")).toHaveCount(1);
    const onlyBetaCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${beta.id}"]`);
    await expect(onlyBetaCard).toBeVisible();
    await expect(onlyBetaCard).toHaveAttribute("open", "");
    await expect(onlyBetaCard).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    await expect(onlyBetaCard).toContainText("Beta's synthetic usage panel");
    await expect(onlyBetaCard.locator(".tf-selection-rich-trust")).toContainText(TRUST_LABEL);
    await expect(onlyBetaCard.locator(".tf-selection-rich-format")).toContainText("Html");
    const betaImage = onlyBetaCard.locator("img.tf-rich-resource-image[src^='blob:']");
    await expect(betaImage).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => betaImage.evaluate((node) => node.naturalWidth)).toBe(2);
    const matchingImageWidth = await betaImage.evaluate((node) => node.naturalWidth);
    expect(await readRichViewerCalls(harness, page)).toEqual([
      expect.objectContaining({ type: "RICH_MDICT_VIEWER_LIST" }),
      expect.objectContaining({ type: "RICH_MDICT_LOOKUP", dictionaryId: beta.id, text: "persistent" }),
      expect.objectContaining({ type: "RICH_MDD_RESOURCE", dictionaryId: beta.id, path: "interop/sample.png" })
    ]);
    expect(harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);

    // Reload the selected page with the same stored preference state.
    const pageToken = await page.locator("html").getAttribute("data-tf-e2e-page-token");
    await page.reload();
    await restorePageTokenAndInject(harness, page, pageToken);
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-primary").first()).toContainText("持久的");
    const reloadedCards = page.locator(".tf-selection-rich-record");
    await expect(reloadedCards).toHaveCount(1);
    await expect(reloadedCards.first()).toHaveAttribute("data-dictionary-id", beta.id);
    await expect(reloadedCards.first()).toHaveJSProperty("open", true);

    // Re-enable Alpha, damage only its stored source, then confirm its delayed
    // failure stays inside that card while Beta and the structured primary remain.
    const alphaRow = dictionaryRow(options, alpha.id);
    await setDictionaryPreference(options, alphaRow, "enabled", true);
    await options.reload();
    await truncateInstalledSource(options, alpha.id);
    await expect(options.locator("#richMdictInstalledList [data-dictionary-id]")).toHaveCount(2);

    await page.reload();
    await restorePageTokenAndInject(harness, page, pageToken);
    await installRichViewerProbe(harness, page, { slowDictionaryId: alpha.id });
    await selectElementText(page, "#ambiguous");
    const primaryReloadStarted = Date.now();
    await page.locator(".tf-selection-chip").click();
    const primary = page.locator(".tf-selection-primary").first();
    await expect(primary).toContainText("持久的");
    const reloadedPrimaryVisibleMs = Date.now() - primaryReloadStarted;
    expect(reloadedPrimaryVisibleMs).toBeLessThan(30_000);
    const cards = page.locator(".tf-selection-rich-record");
    await expect(cards).toHaveCount(2);
    const ids = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.dictionaryId));
    expect(ids).toEqual([beta.id, alpha.id]);
    const betaCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${beta.id}"]`);
    const alphaCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${alpha.id}"]`);
    await expect(betaCard).toHaveJSProperty("open", true);
    await expect(alphaCard).toHaveJSProperty("open", false);
    await expect(betaCard).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    await expect(betaCard).toContainText("Beta's synthetic usage panel");
    await expect(alphaCard).toHaveAttribute("data-state", "idle");

    const beforeAlphaOpen = await readRichViewerCalls(harness, page);
    expect(beforeAlphaOpen
      .filter((call) => call.type === "RICH_MDICT_LOOKUP")
      .map((call) => call.dictionaryId)).toEqual([beta.id]);
    expect(beforeAlphaOpen.some((call) => call.dictionaryId === alpha.id)).toBe(false);

    const alphaLookupStarted = Date.now();
    await alphaCard.locator("summary").click();
    await expect(alphaCard).toHaveAttribute("data-state", "loading");
    await expect(betaCard).toHaveAttribute("data-state", "success");
    await expect(primary).toContainText("持久的");
    await expect(alphaCard).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    const isolatedFailureDelayMs = Date.now() - alphaLookupStarted;
    expect(isolatedFailureDelayMs).toBeGreaterThanOrEqual(800);
    await expect(alphaCard).toContainText("暂时无法读取");
    await expect(betaCard).toContainText("Beta's synthetic usage panel");
    await expect(primary).toContainText("持久的");

    const viewerCalls = await readRichViewerCalls(harness, page);
    expect(viewerCalls
      .filter((call) => call.type === "RICH_MDICT_LOOKUP")
      .map((call) => call.dictionaryId)).toEqual([beta.id, alpha.id]);
    expect(viewerCalls
      .filter((call) => call.type === "RICH_MDD_RESOURCE")
      .map(({ dictionaryId, path }) => ({ dictionaryId, path }))).toEqual([
      { dictionaryId: beta.id, path: "interop/sample.png" }
    ]);
    expect(await readInstalledSourceBytes(options, alpha.id)).toBe(1);
    expect(await resolveStructuredPrimary(harness, page.url())).toEqual(baseline);
    expect(harness.server.calls).toHaveLength(0);
    expect(remoteRequests).toEqual([]);

    // Removing the resource owner revokes the active blob and clears MDX,
    // MDD, and preference state. Removing the damaged companion clears its state too.
    const betaRow = dictionaryRow(options, beta.id);
    await betaRow.getByRole("button", { name: "删除" }).click();
    await expect(dictionaryRow(options, beta.id)).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(() => activeObjectUrlCount(harness, page)).toBe(0);
    await expect(page.locator("img.tf-rich-resource-image")).toHaveCount(0);
    expect(await readInstalledSourceBytes(options, beta.id)).toBe(0);
    expect(await readMddResource(harness, page, beta.id, "interop/sample.png")).toMatchObject({ ok: true, found: false });
    await expect.poll(() => preferenceExists(options, beta.id)).toBe(false);

    await dictionaryRow(options, alpha.id).getByRole("button", { name: "删除" }).click();
    await expect(dictionaryRow(options, alpha.id)).toHaveCount(0, { timeout: 30_000 });
    expect(await readInstalledSourceBytes(options, alpha.id)).toBe(0);
    await expect.poll(() => preferenceExists(options, alpha.id)).toBe(false);
    await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");

    const report = {
      schemaVersion: 1,
      spec: "e2e/dictionary-library-vnext-product.spec.mjs",
      test: "two local rich MDX dictionaries and one attached MDD keep isolated cards, preferences, and resources",
      status: "PASS",
      dictionaries: {
        order: [
          { id: beta.id, title: "Field Notes · Beta", sourceId: "local-rich-mdict", trustLabel: TRUST_LABEL },
          { id: alpha.id, title: "Field Notes · Alpha", sourceId: "local-rich-mdict", trustLabel: TRUST_LABEL }
        ],
        lookups: viewerCalls
          .filter((call) => call.type === "RICH_MDICT_LOOKUP")
          .map(({ dictionaryId, text }) => ({ dictionaryId, text })),
        betaBytesWhileAlphaDisabled: betaBytesBeforeDisable,
        alphaBytesWhileDisabled: alphaBytesBeforeDisable,
        alphaBytesAfterCorruption: 1,
        sourceBytesAfterDeletion: {
          beta: await readInstalledSourceBytes(options, beta.id),
          alpha: await readInstalledSourceBytes(options, alpha.id)
        }
      },
      structuredPrimary: {
        route: baseline.route,
        topCandidateId: baseline.topCandidateId,
        candidateIds: baseline.candidateIds,
        firstVisibleMs: primaryVisibleMs,
        afterReloadVisibleMs: reloadedPrimaryVisibleMs,
        unchanged: true
      },
      isolatedFailureDelayMs,
      mdd: {
        matchingDictionary: beta.id,
        mismatchedDictionary: alpha.id,
        mismatchedDictionaryFound: false,
        resourceRequests: viewerCalls
          .filter((call) => call.type === "RICH_MDD_RESOURCE")
          .map(({ dictionaryId, path }) => ({ dictionaryId, path })),
        matchingImageWidth,
        resourceFoundAfterDeletion: false
      },
      cleanup: {
        preferencesCleared: !(await preferenceExists(options, beta.id)) && !(await preferenceExists(options, alpha.id)),
        objectUrlsAfterResourceOwnerDeletion: await activeObjectUrlCount(harness, page),
        noInstalledDictionaries: true
      },
      providerCalls: harness.server.calls.length,
      remoteRequests: remoteRequests.length,
      generatedAt: new Date().toISOString()
    };
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(resolve(evidenceDir, "dictionary-library-vnext-product-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log("[DICTIONARY_LIBRARY_VNEXT_E2E]", JSON.stringify(report));
  });
});

async function openOptions(harness) {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  return options;
}

async function installRichDictionary(options, { title, fileName, records }) {
  const mdx = makeRichMdx(records, {
    title,
    encrypted: 2,
    compact: "Yes",
    compat: "Yes",
    styleSheet: "1\n<b>\n</b>"
  });
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: mdx
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText(title);
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("来源与信任");
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("用户选择的本机文件");
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
  const row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText(TRUST_LABEL);
  const id = await row.getAttribute("data-dictionary-id");
  expect(id).toMatch(/^rich-mdict-[a-f0-9-]{36}$/u);
  return { id, row };
}

function dictionaryRow(options, id) {
  return options.locator(`#richMdictInstalledList [data-dictionary-id="${id}"]`);
}

function dictionaryPreference(row, name) {
  const action = name === "expandedByDefault" ? "expanded-by-default" : name;
  return row.locator(`input[data-action="${action}"]`);
}

async function setDictionaryPreference(options, row, name, value) {
  const control = dictionaryPreference(row, name);
  const current = await control.isChecked();
  if (current !== value) {
    if (value) await control.check();
    else await control.uncheck();
  }
  await expect(control).toBeChecked({ checked: value });
  const id = await row.getAttribute("data-dictionary-id");
  await expect.poll(async () => {
    const state = await options.evaluate(() => chrome.storage.local.get("tfRichMdictPreferencesV1"));
    return state.tfRichMdictPreferencesV1?.dictionaries?.[id]?.[name];
  }).toBe(value);
}

async function moveDictionaryUp(options, dictionaryId) {
  const row = dictionaryRow(options, dictionaryId);
  const button = row.locator('[data-action="move-up"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async () => {
    const state = await options.evaluate(() => chrome.storage.local.get("tfRichMdictPreferencesV1"));
    return state.tfRichMdictPreferencesV1?.dictionaries?.[dictionaryId]?.order;
  }).toBe(0);
}

async function expectDictionaryPreferences(options, id, expected) {
  const row = dictionaryRow(options, id);
  await expect(row).toBeVisible();
  await expect(dictionaryPreference(row, "enabled")).toBeChecked({ checked: expected.enabled });
  await expect(dictionaryPreference(row, "expandedByDefault")).toBeChecked({ checked: expected.expandedByDefault });
  await expect.poll(async () => {
    const state = await options.evaluate(() => chrome.storage.local.get("tfRichMdictPreferencesV1"));
    return state.tfRichMdictPreferencesV1?.dictionaries?.[id]?.order;
  }).toBe(expected.order);
}

async function readDictionaryIdentity(options, ids) {
  return options.evaluate(async (ids) => {
    const [{ tfRichMdictStateV1 }, listed] = await Promise.all([
      chrome.storage.local.get("tfRichMdictStateV1"),
      chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" })
    ]);
    const byId = new Map((listed.dictionaries || []).map((dictionary) => [dictionary.id, dictionary]));
    return Object.fromEntries(ids.map((id) => [id, {
      sourceId: tfRichMdictStateV1?.packs?.[id]?.sourceId || "",
      trustLabel: byId.get(id)?.trustLabel || "",
      title: byId.get(id)?.title || ""
    }]));
  }, ids);
}

async function attachMddFile(row, file) {
  await row.getByRole("button", { name: /添加或替换 MDD 附件/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles(file);
  await expect(row.page().locator("#status")).toContainText("本地资源已更新", { timeout: 60_000 });
  await expect(row).toContainText("1 个 MDD 文件");
}

async function readMddResource(harness, page, dictionaryId, path) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, dictionaryId, path }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ dictionaryId, path }) => chrome.runtime.sendMessage({
        type: "RICH_MDD_RESOURCE",
        requestId: `selection-mdd-resource-${crypto.randomUUID().replaceAll("-", "")}`,
        ownerToken: globalThis.__tfMddHelperOwnerToken ||= crypto.randomUUID().replaceAll("-", ""),
        dictionaryId,
        path
      }),
      args: [{ dictionaryId, path }]
    });
    return result?.result;
  }, { tabId, dictionaryId, path });
}

async function readInstalledSourceBytes(options, dictionaryId) {
  return options.evaluate(async (dictionaryId) => {
    const { tfRichMdictStateV1 } = await chrome.storage.local.get("tfRichMdictStateV1");
    const active = tfRichMdictStateV1?.packs?.[dictionaryId]?.active;
    if (!active) return 0;
    const root = await navigator.storage.getDirectory();
    const dictionaries = await root.getDirectoryHandle("rich-mdict-dictionaries");
    const pack = await dictionaries.getDirectoryHandle(dictionaryId);
    const version = await pack.getDirectoryHandle(active.packVersion);
    const source = await version.getFileHandle("source.mdx");
    return (await source.getFile()).size;
  }, dictionaryId);
}

async function truncateInstalledSource(options, dictionaryId) {
  await options.evaluate(async (dictionaryId) => {
    const { tfRichMdictStateV1 } = await chrome.storage.local.get("tfRichMdictStateV1");
    const active = tfRichMdictStateV1?.packs?.[dictionaryId]?.active;
    if (!active) throw new Error("Installed synthetic dictionary state is missing.");
    const root = await navigator.storage.getDirectory();
    const dictionaries = await root.getDirectoryHandle("rich-mdict-dictionaries");
    const pack = await dictionaries.getDirectoryHandle(dictionaryId);
    const version = await pack.getDirectoryHandle(active.packVersion);
    const source = await version.getFileHandle("source.mdx", { create: false });
    const writable = await source.createWritable();
    await writable.write(new Uint8Array([0]));
    await writable.close();
  }, dictionaryId);
}

async function preferenceExists(options, dictionaryId) {
  return options.evaluate(async (dictionaryId) => {
    const state = await chrome.storage.local.get("tfRichMdictPreferencesV1");
    return Object.hasOwn(state.tfRichMdictPreferencesV1?.dictionaries || {}, dictionaryId);
  }, dictionaryId);
}

async function installRichViewerProbe(harness, page, { slowDictionaryId = "" } = {}) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async ({ tabId, slowDictionaryId }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (slowDictionaryId) => {
        const runtime = chrome.runtime;
        const original = runtime.sendMessage;
        const calls = [];
        Object.defineProperty(globalThis, "__tfDictionaryLibraryCalls", {
          configurable: true,
          value: calls
        });
        runtime.sendMessage = function (message, ...args) {
          if (["RICH_MDICT_VIEWER_LIST", "RICH_MDICT_LOOKUP", "RICH_MDD_RESOURCE"].includes(message?.type)) {
            calls.push({
              type: String(message.type),
              dictionaryId: String(message.dictionaryId || ""),
              text: String(message.text || ""),
              path: String(message.path || "")
            });
          }
          if (message?.type === "RICH_MDICT_LOOKUP" && message.dictionaryId === slowDictionaryId) {
            const callbackIndex = args.findIndex((arg) => typeof arg === "function");
            if (callbackIndex >= 0) {
              const callback = args[callbackIndex];
              args[callbackIndex] = (...callbackArgs) => {
                setTimeout(() => callback(...callbackArgs), 900);
              };
            }
          }
          return original.call(runtime, message, ...args);
        };
      },
      args: [slowDictionaryId]
    });
  }, { tabId, slowDictionaryId });
}

async function readRichViewerCalls(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__tfDictionaryLibraryCalls || []
    });
    return result?.result || [];
  }, tabId);
}

async function activeObjectUrlCount(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__TRANSLATE_FLOW_CONTENT__?.modules?.richResourceResolver?.activeObjectUrlCount ?? 0
    });
    return result?.result || 0;
  }, { tabId });
}

async function restorePageTokenAndInject(harness, page, token) {
  await page.evaluate((token) => {
    document.documentElement.dataset.tfE2ePageToken = token;
  }, token);
  await harness.inject(page);
}

async function resolveStructuredPrimary(harness, pageUrl) {
  const resolved = await harness.runtime({
    type: "SELECTION_RESOLVE",
    text: "persistent",
    pageUrl,
    context: null
  });
  expect(resolved.ok).toBe(true);
  return {
    route: resolved.route,
    topCandidateId: resolved.decision?.topCandidateId || "",
    candidateIds: Array.isArray(resolved.decision?.candidates)
      ? resolved.decision.candidates.map((candidate) => candidate.id)
      : []
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
