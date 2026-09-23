import { test as base, chromium, expect } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT_SCRIPTS = [
  "src/content/runtime.js",
  "src/content/tasks.js",
  "src/content/structured.js",
  "src/content/dom.js",
  "src/content/batch.js",
  "src/content/processor.js",
  "src/content/auto.js",
  "src/content/selection/selection.js",
  "src/content/selection/popover.js",
  "src/content/selection/controller.js",
  "content.js"
];
const CONTENT_STYLES = ["content.css"];

export const test = base.extend({
  harness: [async ({}, use) => {
    const server = await startMockServer();
    const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-e2e-"));
    const extensionDir = join(tempRoot, "extension");
    const userDataDir = join(tempRoot, "profile");

    await copyExtension(extensionDir);
    await patchManifest(extensionDir);
    await writeFile(
      join(extensionDir, "e2e-driver.html"),
      "<!doctype html><meta charset=\"utf-8\"><title>TranslateFlow E2E Driver</title>",
      "utf8"
    );

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    });

    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).hostname;

    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}/e2e-driver.html`);

    for (const page of context.pages()) {
      if (page !== driver && page.url() === "about:blank") await page.close();
    }

    const harness = createHarness({
      context,
      driver,
      extensionId,
      server
    });

    await harness.reset();
    await use(harness);

    await Promise.allSettled([
      context.close(),
      server.close()
    ]);
    await rm(tempRoot, { recursive: true, force: true });
  }, { scope: "worker" }]
});

export { expect };

function createHarness({ context, driver, extensionId, server }) {
  return {
    context,
    driver,
    extensionId,
    server,

    async reset() {
      for (const page of context.pages()) {
        if (page !== driver) await page.close().catch(() => {});
      }
      server.reset();

      await driver.evaluate(async ({ baseUrl }) => {
        try {
          await chrome.runtime.sendMessage({ type: "CACHE_CLEAR_ALL" });
        } catch {}
        await chrome.storage.local.clear();
        await chrome.storage.session.clear();
        await chrome.storage.local.set({
          provider: "openai-compatible",
          prompt: "Translate the supplied web content faithfully and return the required JSON structure only.",
          targetLanguage: "Simplified Chinese",
          cacheMaxMB: 50,
          autoSites: [],
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
}

async function copyExtension(extensionDir) {
  const excluded = new Set([
    ".git",
    "node_modules",
    "e2e",
    "test-results",
    "playwright-report"
  ]);

  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const rel = relative(repoRoot, source);
      if (!rel) return true;
      const [first] = rel.split(sep);
      return !excluded.has(first);
    }
  });
}

async function patchManifest(extensionDir) {
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [
    ...new Set([
      ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
      "http://127.0.0.1/*"
    ])
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
