import { test as base, chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMockServer } from "./mock-server.mjs";
import { prepareExtensionTestCopy } from "./production-artifact.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../../src/shared/constants.js";

const CONTENT_SCRIPTS = [...CONTENT_SCRIPT_FILES];
const CONTENT_STYLES = [...CONTENT_STYLE_FILES];
const YOUTUBE_MAIN_BRIDGE_SCRIPTS = [
  "src/content/subtitles/youtube-bridge-protocol.js",
  "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/youtube-main-bridge.js"
];

export const test = base.extend({
  commandCallbackProbe: [false, { option: true, scope: "worker" }],
  lexiconPacks: ["fixture", { option: true, scope: "worker" }],
  ecdictMdxReleaseHostAccess: [false, { option: true, scope: "worker" }],
  ecdictMdxCachedArchivePath: ["", { option: true, scope: "worker" }],
  staticContentInjection: [true, { option: true, scope: "worker" }],
  harness: [async ({
    lexiconPacks,
    commandCallbackProbe,
    ecdictMdxReleaseHostAccess,
    ecdictMdxCachedArchivePath,
    staticContentInjection
  }, use) => {
    const server = await startMockServer({
      ecdictMdxArchivePath: ecdictMdxCachedArchivePath
    });
    const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-e2e-"));
    const extensionDir = join(tempRoot, "extension");
    let context;
    try {
    const buildReport = await prepareExtensionTestCopy({
      extensionDir, lexiconPacks, ecdictMdxReleaseHostAccess,
      ecdictMdxCachedArchivePath, captureCommands: commandCallbackProbe,
      staticContentInjection, baseUrl: server.baseUrl
    });

    console.log("[E2E_PRODUCTION_ARTIFACT]", JSON.stringify({
      artifact: buildReport.artifact, sourceHead: buildReport.sourceHead,
      treeSha256: buildReport.treeSha256, fileCount: buildReport.fileCount,
      totalBytes: buildReport.totalBytes, lexicalBytes: buildReport.lexicalBytes,
      lexiconMode: buildReport.lexiconMode, testChanges: buildReport.testCopy.changes,
      commandCallbackProbe: buildReport.commandCallbackProbe,
      cachedWorkerOverride: buildReport.cachedWorkerOverride,
      staticContentInjection: buildReport.staticContentInjection
    }));
    const userDataDir = join(tempRoot, "profile");
    context = await chromium.launchPersistentContext(userDataDir, {
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
    const pageTokens = new WeakMap();
    let pageTokenCounter = 0;

    const harness = {
      context,
      driver,
      serviceWorker,
      extensionId,
      extensionDir,
      buildReport,
      server,

      async reset() {
        server.reset();
        await driver.evaluate(async ({ baseUrl }) => {
          await chrome.runtime.sendMessage({ type: "CACHE_CLEAR_ALL" });
          await chrome.storage.local.clear();
          await chrome.storage.local.set({
            provider: "openai-compatible",
            model: "mock-model",
            targetLanguage: "Simplified Chinese",
            uiLocale: "zh_CN",
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
        const token = `tf-e2e-${++pageTokenCounter}`;
        pageTokens.set(page, token);
        await page.evaluate((token) => {
          document.documentElement.dataset.tfE2ePageToken = token;
        }, token);
        return page;
      },

      async tabId(page) {
        const url = page.url();
        const token = pageTokens.get(page);
        const id = await driver.evaluate(async ({ url, token }) => {
          const tabs = await chrome.tabs.query({});
          const candidates = tabs.filter((tab) => tab.url === url && Number.isInteger(tab.id));
          if (!token) return candidates[0]?.id || null;

          for (const tab of candidates) {
            try {
              const [result] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => document.documentElement.dataset.tfE2ePageToken || ""
              });
              if (result?.result === token) return tab.id;
            } catch {}
          }
          return null;
        }, { url, token });
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

      async installYouTubeMainBridge(page) {
        const tabId = await this.tabId(page);
        await driver.evaluate(async ({ tabId, files }) => {
          await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files });
        }, { tabId, files: YOUTUBE_MAIN_BRIDGE_SCRIPTS });
        return tabId;
      },

      async sendContent(page, type, payload = {}) {
        const tabId = await this.tabId(page);
        return driver.evaluate(
          ({ tabId, message }) => chrome.tabs.sendMessage(tabId, message),
          { tabId, message: { type, ...payload } }
        );
      },

      async captureSelectionContext(page) {
        const tabId = await this.tabId(page);
        return driver.evaluate(async (tabId) => {
          const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
              const snapshot = app?.modules?.selection?.readSelection?.();
              return app?.modules?.selectionContext?.captureSelectionContext?.(snapshot) || null;
            }
          });
          return result?.result || null;
        }, tabId);
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
    } finally {
      try { await context?.close(); }
      finally {
        try { await server.close(); }
        finally { await rm(tempRoot, { recursive: true, force: true }); }
      }
    }
  }, { scope: "worker" }]
});

export { expect };
