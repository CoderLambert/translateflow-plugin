import { test as base, chromium, expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT_SCRIPTS = [
  "src/content/runtime.js",
  "src/content/ui/tokens.js",
  "src/content/ui/quick-control-styles.js",
  "src/content/ui/host.js",
  "src/content/ui/primitives.js",
  "src/content/ui/toast.js",
  "src/content/appearance.js",
  "src/content/tasks.js",
  "src/content/structured.js",
  "src/content/dom.js",
  "src/content/batch.js",
  "src/content/processor.js",
  "src/content/auto.js",
  "src/content/subtitles/source.js",
  "src/content/subtitles/sources/text-track.js",
  "src/content/subtitles/sources/youtube.js",
  "src/content/subtitles/pipeline.js",
  "src/content/subtitles/renderer.js",
  "src/content/subtitles/controller.js",
  "src/content/selection/selection.js",
  "src/content/selection/popover.js",
  "src/content/selection/controller.js",
  "src/content/quick-control-view.js",
  "src/content/quick-control.js",
  "content.js"
];
const CONTENT_STYLES = ["content.css"];

export const test = base.extend({
  harness: [async ({}, use) => {
    const server = await startMockServer();
    const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-e2e-"));
    const extensionDir = join(tempRoot, "extension");
    await cp(repoRoot, extensionDir, {
      recursive: true,
      filter: (source) => {
        const rel = relative(repoRoot, source);
        if (!rel) return true;
        const first = rel.split(sep)[0];
        return ![".git", "node_modules", "playwright-report", "test-results"].includes(first);
      }
    });

    const manifestPath = join(extensionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.host_permissions = [
      "http://127.0.0.1/*",
      "https://api.deepseek.com/*"
    ];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const userDataDir = join(tempRoot, "profile");
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    });

    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/popup.html`);

    const harness = {
      context,
      driver,
      extensionId,
      server,

      async reset() {
        server.reset();
        await driver.evaluate(async ({ baseUrl }) => {
          await chrome.storage.local.clear();
          await chrome.storage.local.set({
            provider: "openai-compatible",
            model: "mock-model",
            targetLanguage: "Simplified Chinese",
            prompt: "Translate the segments and return JSON only.",
            appearance: "standard",
            cacheMaxMB: 50,
            cacheRestoreSites: [],
            autoSites: [],
            quickControlSites: [],
            quickControlHiddenSites: [],
            siteProfiles: {},
            glossary: { version: 1, entries: [] },
            siteGlossaries: { version: 1, sites: {} },
            openAICompatible: {
              baseUrl: `${baseUrl}/v1`,
              apiKey: "",
              model: "mock-model"
            }
          });
        }, { baseUrl: server.baseUrl });
      },

      async open(pathname) {
        const page = await context.newPage();
        await page.goto(`${server.baseUrl}${pathname}`);
        return page;
      },

      async tabId(page) {
        const url = page.url();
        const id = await driver.evaluate(async ({ url }) => {
          const tabs = await chrome.tabs.query({});
          return tabs.find((tab) => tab.url === url)?.id || null;
        }, { url });
        if (!id) throw new Error(`Could not resolve Chrome tab id for ${url}`);
        return id;
      },

      async inject(page) {
        const tabId = await this.tabId(page);
        await driver.evaluate(async ({ tabId, scripts, styles }) => {
          try {
            const status = await chrome.tabs.sendMessage(tabId, { type: "ABT_STATUS" });
            if (status?.ok) return;
          } catch {}

          await chrome.scripting.insertCSS({
            target: { tabId },
            files: styles
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            files: scripts
          });
        }, {
          tabId,
          scripts: CONTENT_SCRIPTS,
          styles: CONTENT_STYLES
        });
        return tabId;
      },

      async sendContent(page, type, payload = {}) {
        const tabId = await this.tabId(page);
        return driver.evaluate(
          ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
          { tabId, message: { type, ...payload } }
        );
      },

      async runtime(message) {
        return driver.evaluate((message) => chrome.runtime.sendMessage(message), message);
      },

      async setStorage(values) {
        await driver.evaluate((values) => chrome.storage.local.set(values), values);
      },

      async getStorage(keys) {
        return driver.evaluate((keys) => chrome.storage.local.get(keys), keys);
      }
    };

    await harness.reset();
    await use(harness);
    await context.close();
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }, { scope: "worker" }]
});

export { expect };
