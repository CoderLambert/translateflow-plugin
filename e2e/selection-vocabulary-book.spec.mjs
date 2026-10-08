import { test, expect, chromium } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startMockServer } from "./support/mock-server.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { VOCABULARY_BOOK_STORAGE_KEY } from "../src/background/vocabulary-book.js";
import { defaultArtifact } from "./support/production-artifact.mjs";

// Real WXT Chromium artifact, with a clearly synthetic Core fixture copied into
// a temporary browser profile. This proves the UX and local storage contract,
// not dictionary corpus coverage or a paid-provider flow.
const root = resolve(import.meta.dirname, ".."), artifact = defaultArtifact;
let temporary, context, worker, driver, server, extensionId, extension;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(path, prefix = "") {
  const items = [];
  for (const entry of await readdir(join(path, prefix), { withFileTypes: true })) {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) items.push(...await inventory(path, file));
    else { const bytes = await readFile(join(path, file)); items.push({ file, size: bytes.length, sha256: hash(bytes) }); }
  }
  return items.sort((a, b) => a.file.localeCompare(b.file));
}

test.describe("Selection → local wordbook → minimal review on the WXT Chromium artifact", () => {
  test.setTimeout(60000);
  test.beforeAll(async () => {
    server = await startMockServer();
    temporary = await mkdtemp(join(tmpdir(), "translateflow-vocabulary-book-"));
    extension = join(temporary, "extension");
    const production = await inventory(artifact);
    await cp(artifact, extension, { recursive: true });
    expect(await inventory(extension)).toEqual(production);
    const backgroundSha256 = hash(await readFile(join(extension, "background.js")));
    const technicalFixture = join(artifact, "assets/lexicon/technical");
    await rm(join(extension, "assets/lexicon"), { recursive: true, force: true });
    await mkdir(join(extension, "assets/lexicon"), { recursive: true });
    await cp(join(root, "tests/fixtures/tflex-runtime-pack"), join(extension, "assets/lexicon/core"), { recursive: true });
    await cp(technicalFixture, join(extension, "assets/lexicon/technical"), { recursive: true });
    const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
    manifest.host_permissions.push("http://127.0.0.1/*");
    await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
    expect(hash(await readFile(join(extension, "background.js")))).toBe(backgroundSha256);
    context = await chromium.launchPersistentContext(join(temporary, "profile"), { headless: true, channel: "chromium",
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    extensionId = new URL(worker.url()).host;
    driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/popup.html`);
    await writeFile(test.info().outputPath("selection-vocabulary-package.json"), JSON.stringify({ artifactPath: artifact,
      productionInventory: production, backgroundSha256, exactCopyBeforeFixtures: true, browser: context.browser().version(),
      temporaryChanges: ["synthetic Core TFLex fixture; built-in Technical pack retained", "localhost test host permission"], paidProviderCalls: 0,
      privateDictionaryUpload: false }, null, 2));
  });

  test.afterAll(async () => {
    await context?.close(); await server?.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    for (const page of context.pages()) if (page !== driver) await page.close();
    await driver.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ uiLocale: "en", provider: "openai-compatible", targetLanguage: "Simplified Chinese",
        prompt: "Translate the segments and return JSON only.", selectionExplanationDepth: "standard", appearance: "standard",
        glossary: { version: 1, entries: [] }, siteGlossaries: { version: 1, sites: {} }, openAICompatible: {
          baseUrl: "http://127.0.0.1:1/v1", apiKey: "", model: "offline-test-model" }, autoSites: [], cacheRestoreSites: [], siteProfiles: {} });
    });
    const lexicon = await driver.evaluate(() => chrome.runtime.sendMessage({ type: "BUNDLED_LEXICON_STATUS" }));
    expect(lexicon.packs.filter(pack => pack.status === "ready")).toHaveLength(2);
    server.reset();
  });

  test("explicitly saves a trusted dictionary hit, reviews it, then deletes only the local wordbook entry", async () => {
    const page = await context.newPage();
    await page.goto(`${server.baseUrl}/article`);
    const title = `Synthetic Vocabulary ${crypto.randomUUID()}`;
    await page.evaluate(title => { document.title = title; document.body.innerHTML = '<main><p id="word">persistent</p></main>'; }, title);
    const tabId = await driver.evaluate(async title => (await chrome.tabs.query({})).find(tab => tab.title === title).id, title);
    await driver.evaluate(async ({ tabId, files, styles }) => {
      await chrome.scripting.insertCSS({ target: { tabId }, files: styles });
      await chrome.scripting.executeScript({ target: { tabId }, files });
    }, { tabId, files: [...CONTENT_SCRIPT_FILES], styles: [...CONTENT_STYLE_FILES] });
    await page.evaluate(() => {
      const node = document.querySelector("#word").firstChild, range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, node.nodeValue.length);
      getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(page.locator(".tf-selection-chip")).toBeVisible();
    await page.locator(".tf-selection-chip").click();
    await expect(page.locator(".tf-selection-result")).toContainText("持久的");
    await page.screenshot({ path: test.info().outputPath("synthetic-local-wordbook-save.png") });
    await expect(page.locator(".tf-selection-vocabulary-add")).toBeVisible();
    await page.locator(".tf-selection-vocabulary-add").click();
    await expect(page.locator(".tf-selection-vocabulary-open")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("synthetic-selection-saved.png") });
    const saved = await driver.evaluate(async key => (await chrome.storage.local.get(key))[key], VOCABULARY_BOOK_STORAGE_KEY);
    expect(saved.version).toBe(1);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].headword).toBe("persistent");
    expect(saved.entries[0].sources[0].sourceId).toBe("pwn-3.0");
    expect(saved.entries[0]).not.toHaveProperty("pageUrl");
    expect(saved.entries[0]).not.toHaveProperty("context");
    expect(server.calls).toHaveLength(0);

    const opened = context.waitForEvent("page");
    await page.locator(".tf-selection-vocabulary-open").click();
    const wordbook = await opened;
    await expect(wordbook).toHaveURL(/learning-center\.html#wordbook$/u);
    await expect(wordbook.getByRole("heading", { name: "persistent", exact: true })).toBeVisible();
    await wordbook.screenshot({ path: test.info().outputPath("synthetic-wordbook-list.png") });
    await wordbook.getByRole("button", { name: "Review", exact: true }).click();
    await expect(wordbook.getByTestId("vocabulary-review-card")).toBeVisible();
    await wordbook.getByRole("button", { name: "Show meaning", exact: true }).click();
    await expect(wordbook.locator(".vocabulary-answer")).toContainText("持久的");
    await wordbook.screenshot({ path: test.info().outputPath("synthetic-wordbook-review.png") });
    await wordbook.getByRole("button", { name: "Know it", exact: true }).click();
    await expect(wordbook.getByText(/Nothing is due right now|all caught up/u)).toBeVisible();
    await wordbook.screenshot({ path: test.info().outputPath("synthetic-wordbook-review-scheduled.png") });
    let afterReview = await driver.evaluate(async key => (await chrome.storage.local.get(key))[key], VOCABULARY_BOOK_STORAGE_KEY);
    expect(afterReview.entries[0].reviewCount).toBe(1);
    expect(afterReview.entries[0].knownStreak).toBe(1);
    expect(afterReview.entries[0].nextReviewAt).toBeGreaterThan(Date.now());

    await wordbook.getByRole("button", { name: "Wordbook", exact: true }).click();
    await wordbook.locator("[data-entry-id]").getByRole("button", { name: "Delete word", exact: true }).click();
    await wordbook.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(wordbook.getByText(/No saved words yet/u)).toBeVisible();
    await wordbook.screenshot({ path: test.info().outputPath("synthetic-wordbook-empty.png") });
    afterReview = await driver.evaluate(async key => (await chrome.storage.local.get(key))[key], VOCABULARY_BOOK_STORAGE_KEY);
    expect(afterReview.entries).toHaveLength(0);
    expect(server.calls).toHaveLength(0);
    await wordbook.getByRole("button", { name: "Reading history", exact: true }).click();
    await expect(wordbook.getByRole("button", { name: "Reading history", exact: true })).toHaveAttribute("aria-pressed", "true");
    await wordbook.goBack();
    await expect(wordbook.getByRole("button", { name: "Wordbook", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
