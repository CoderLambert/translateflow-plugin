import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";

const evidenceDir = resolve("test-results/multi-dictionary-viewer-evidence");

test.describe("multiple local rich dictionary cards", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("configured order and collapsed defaults survive reload beside the unchanged structured primary", async ({ harness }) => {
    await mkdir(evidenceDir, { recursive: true });
    const options = await openOptions(harness);
    const alpha = await installFixture(options, {
      title: "Fixture Alpha Rich",
      marker: "Alpha rich gloss",
      fileName: "fixture-alpha.mdx"
    });
    const beta = await installFixture(options, {
      title: "Fixture Beta Rich",
      marker: "Beta rich gloss",
      fileName: "fixture-beta.mdx"
    });

    // Exercise the Settings controls, then verify the Selection surface consumes
    // those saved values after both Options and the selected page reload.
    await setDictionaryPreference(options, alpha.row, "enabled", true);
    await setDictionaryPreference(options, beta.row, "enabled", true);
    await setDictionaryPreference(options, alpha.row, "expandedByDefault", true);
    await setDictionaryPreference(options, alpha.row, "expandedByDefault", false);
    await setDictionaryPreference(options, beta.row, "expandedByDefault", true);
    await moveDictionaryUp(options, beta.row);
    await options.reload();
    const alphaRow = dictionaryRow(options, alpha.id);
    const betaRow = dictionaryRow(options, beta.id);
    await expect(alphaRow).toBeVisible();
    await expect(betaRow).toBeVisible();
    await expect(dictionaryPreference(alphaRow, "enabled")).toBeChecked();
    await expect(dictionaryPreference(betaRow, "enabled")).toBeChecked();
    await expect(dictionaryPreference(alphaRow, "expandedByDefault")).not.toBeChecked();
    await expect(dictionaryPreference(betaRow, "expandedByDefault")).toBeChecked();

    const page = await harness.open("/selection");
    const baseline = await resolveStructuredPrimary(harness, page.url());
    expect(baseline.route).toBe("local");
    expect(baseline.topCandidateId).toBeTruthy();
    await harness.inject(page);
    await selectElementText(page, "#ambiguous");
    const primaryStarted = Date.now();
    await page.locator(".tf-selection-chip").click();

    const primary = page.locator(".tf-selection-primary").first();
    await expect(primary).toContainText("持久的");
    const primaryVisibleMs = Date.now() - primaryStarted;
    const cards = page.locator(".tf-selection-rich-record");
    await expect(cards).toHaveCount(2);
    const orderedIds = await cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.dictionaryId));
    expect(orderedIds).toEqual([beta.id, alpha.id]);
    const cardById = (id) => page.locator(`.tf-selection-rich-record[data-dictionary-id="${id}"]`);
    await expect(cardById(beta.id)).toHaveJSProperty("open", true);
    await expect(cardById(alpha.id)).toHaveJSProperty("open", false);
    await expect(cardById(beta.id)).toHaveAttribute("data-state", "success");
    await expect(cardById(beta.id)).toContainText("Beta rich gloss");

    // Reload Selection before opening either card to prove the stored defaults
    // are applied by the real viewer-list -> per-dictionary lookup flow.
    const pageToken = await page.locator("html").getAttribute("data-tf-e2e-page-token");
    await page.reload();
    await page.evaluate((token) => {
      document.documentElement.dataset.tfE2ePageToken = token;
    }, pageToken);
    await harness.inject(page);
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-primary").first()).toContainText("持久的");
    const reloadedCards = page.locator(".tf-selection-rich-record");
    await expect(reloadedCards).toHaveCount(2);
    const reloadedIds = await reloadedCards.evaluateAll((nodes) => nodes.map((node) => node.dataset.dictionaryId));
    expect(reloadedIds).toEqual([beta.id, alpha.id]);
    await expect(cardById(beta.id)).toHaveJSProperty("open", true);
    await expect(cardById(alpha.id)).toHaveJSProperty("open", false);
    await expect(cardById(beta.id)).toHaveAttribute("data-state", "success");
    await expect(cardById(beta.id)).toContainText("Beta rich gloss");

    await cardById(alpha.id).locator("summary").click();
    await expect(cardById(alpha.id)).toHaveAttribute("data-state", "success");
    await expect(cardById(alpha.id)).toContainText("Alpha rich gloss");

    const after = await resolveStructuredPrimary(harness, page.url());
    expect(after.topCandidateId).toBe(baseline.topCandidateId);
    expect(after.candidateIds).toEqual(baseline.candidateIds);
    expect(await page.locator(".tf-selection-result").getAttribute("data-result-kind")).toBe("local");
    expect(harness.server.calls).toHaveLength(0);

    const evidence = {
      status: "PASS",
      dictionaries: [
        { id: beta.id, title: "Fixture Beta Rich", order: 0, expandedByDefault: true },
        { id: alpha.id, title: "Fixture Alpha Rich", order: 1, expandedByDefault: false }
      ],
      structuredPrimary: {
        route: baseline.route,
        topCandidateId: after.topCandidateId,
        candidateIds: after.candidateIds,
        meaning: await primary.textContent()
      },
      primaryVisibleMs,
      providerCalls: harness.server.calls.length
    };
    await page.screenshot({ path: resolve(evidenceDir, "beta-expanded-alpha-collapsed.png"), fullPage: true });
    console.log("[MULTI_DICTIONARY_VIEWER]", JSON.stringify(evidence));
  });

  test("disabling a dictionary hides it from Selection while its installed bytes remain available", async ({ harness }) => {
    const options = await openOptions(harness);
    const enabled = await installFixture(options, {
      title: "Fixture Enabled Rich",
      marker: "Enabled rich gloss",
      fileName: "fixture-enabled.mdx"
    });
    const disabled = await installFixture(options, {
      title: "Fixture Disabled Rich",
      marker: "Disabled rich gloss",
      fileName: "fixture-disabled.mdx"
    });
    const disabledBytesBefore = await readInstalledSourceBytes(options, disabled.id);
    await setDictionaryPreference(options, disabled.row, "enabled", false);
    await options.reload();

    const disabledRow = dictionaryRow(options, disabled.id);
    await expect(disabledRow).toBeVisible();
    await expect(dictionaryPreference(disabledRow, "enabled")).not.toBeChecked();
    const installed = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LIST" }));
    expect(installed.ok).toBe(true);
    expect(installed.dictionaries.map((item) => item.id)).toEqual(expect.arrayContaining([enabled.id, disabled.id]));
    expect(await readInstalledSourceBytes(options, disabled.id)).toBe(disabledBytesBefore);

    const page = await harness.open("/selection");
    await harness.inject(page);
    await installRichViewerMessageProbe(harness, page);
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-primary").first()).toContainText("持久的");
    const cards = page.locator(".tf-selection-rich-record");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("data-dictionary-id", enabled.id);
    await cards.first().locator("summary").click();
    await expect(cards.first()).toHaveAttribute("data-state", "success");
    await expect(cards.first()).toContainText("Enabled rich gloss");
    await expect(page.locator(".tf-selection-rich-details")).not.toContainText("Fixture Disabled Rich");
    const viewerRequests = await readRichViewerMessages(harness, page);
    expect(viewerRequests.filter((message) => message.type === "RICH_MDICT_VIEWER_LIST")).toHaveLength(1);
    expect(viewerRequests.filter((message) => message.type === "RICH_MDICT_LOOKUP").map((message) => message.dictionaryId))
      .toEqual([enabled.id]);
    expect(viewerRequests.some((message) => message.dictionaryId === disabled.id)).toBe(false);
    expect(harness.server.calls).toHaveLength(0);
  });

  test("a corrupted dictionary reports its own error while another card and the structured primary render", async ({ harness }) => {
    const options = await openOptions(harness);
    const corrupt = await installFixture(options, {
      title: "Fixture Corrupt Rich",
      marker: "Corrupt rich gloss",
      fileName: "fixture-corrupt.mdx"
    });
    const healthy = await installFixture(options, {
      title: "Fixture Healthy Rich",
      marker: "Healthy rich gloss",
      fileName: "fixture-healthy.mdx"
    });
    await setDictionaryPreference(options, corrupt.row, "expandedByDefault", true);
    await setDictionaryPreference(options, healthy.row, "expandedByDefault", true);
    await truncateInstalledSource(options, corrupt.id);

    const page = await harness.open("/selection");
    await harness.inject(page);
    await selectElementText(page, "#ambiguous");
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-primary").first()).toContainText("持久的");
    const corruptCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${corrupt.id}"]`);
    const healthyCard = page.locator(`.tf-selection-rich-record[data-dictionary-id="${healthy.id}"]`);
    await expect(corruptCard).toHaveAttribute("data-state", "error");
    await expect(healthyCard).toHaveAttribute("data-state", "success");
    await expect(healthyCard).toContainText("Healthy rich gloss");
    await expect(page.locator(".tf-selection-result")).toContainText("持久的");
    expect(harness.server.calls).toHaveLength(0);
  });
});

async function openOptions(harness) {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  return options;
}

async function installFixture(options, { title, marker, fileName }) {
  const fixture = makeRichMdx([
    ["persistent", `<p><b>${marker}</b><br>Bounded synthetic viewer fixture.</p>`]
  ], { title, encrypted: 2, compact: "Yes", compat: "Yes" });
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: fixture
  });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText(title);
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 90_000 });
  const row = options.locator("#richMdictInstalledList .site-row").filter({ hasText: title });
  await expect(row).toBeVisible();
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
  const rowId = await row.getAttribute("data-dictionary-id");
  await expect.poll(async () => {
    const state = await options.evaluate(() => chrome.storage.local.get("tfRichMdictPreferencesV1"));
    return state.tfRichMdictPreferencesV1?.dictionaries?.[rowId]?.[name];
  }).toBe(value);
}

async function moveDictionaryUp(options, row) {
  const button = row.locator('[data-action="move-up"]');
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(async () => {
    const state = await options.evaluate(() => chrome.storage.local.get("tfRichMdictPreferencesV1"));
    const preferences = state.tfRichMdictPreferencesV1?.dictionaries || {};
    const currentId = await row.getAttribute("data-dictionary-id");
    const currentOrder = preferences[currentId]?.order;
    const orders = Object.values(preferences).map((item) => item?.order).filter(Number.isSafeInteger);
    return Number.isSafeInteger(currentOrder) && currentOrder === Math.min(...orders);
  }).toBe(true);
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

async function installRichViewerMessageProbe(harness, page) {
  const tabId = await harness.tabId(page);
  await harness.driver.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const runtime = chrome.runtime;
        const original = runtime.sendMessage;
        const calls = [];
        Object.defineProperty(globalThis, "__tfRichViewerMessageCalls", {
          configurable: true,
          value: calls
        });
        runtime.sendMessage = function (message, ...args) {
          if (["RICH_MDICT_VIEWER_LIST", "RICH_MDICT_LOOKUP"].includes(message?.type)) {
            calls.push({
              type: message.type,
              dictionaryId: String(message.dictionaryId || "")
            });
          }
          return original.call(runtime, message, ...args);
        };
      }
    });
  }, tabId);
}

async function readRichViewerMessages(harness, page) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async (tabId) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.__tfRichViewerMessageCalls || []
    });
    return result?.result || [];
  }, tabId);
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
