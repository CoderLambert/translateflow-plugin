import { test as base, chromium, expect } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockServer } from "./mock-server.mjs";
import { buildExtension } from "../../scripts/build-extension.mjs";
import { compileTflexTechnical } from "../../scripts/build-tflex-technical.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../../src/shared/constants.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT_SCRIPTS = [...CONTENT_SCRIPT_FILES];
const CONTENT_STYLES = [...CONTENT_STYLE_FILES];
const YOUTUBE_MAIN_BRIDGE_SCRIPTS = [
  "src/content/subtitles/youtube-bridge-protocol.js",
  "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/youtube-main-bridge.js"
];

export const test = base.extend({
  lexiconPacks: ["fixture", { option: true, scope: "worker" }],
  ecdictMdxReleaseHostAccess: [false, { option: true, scope: "worker" }],
  ecdictMdxCachedArchivePath: ["", { option: true, scope: "worker" }],
  harness: [async ({
    lexiconPacks,
    ecdictMdxReleaseHostAccess,
    ecdictMdxCachedArchivePath
  }, use) => {
    const server = await startMockServer({
      ecdictMdxArchivePath: ecdictMdxCachedArchivePath
    });
    const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-e2e-"));
    const extensionDir = join(tempRoot, "extension");
    const buildReport = await buildExtension({
      outDir: extensionDir,
      allowExternalOutput: true
    });

    const lexiconDir = join(extensionDir, "assets", "lexicon");
    await rm(lexiconDir, { recursive: true, force: true });
    if (lexiconPacks === "release") {
      await cp(join(repoRoot, "assets", "lexicon"), lexiconDir, { recursive: true });
    } else if (lexiconPacks !== "missing") {
      await mkdir(lexiconDir, { recursive: true });
      await cp(
        join(repoRoot, "tests", "fixtures", "tflex-runtime-pack"),
        join(lexiconDir, "core"),
        { recursive: true }
      );
      await compileTflexTechnical({
        extractPath: join(repoRoot, "lexicon", "sources", "wikidata-tech-entities.json"),
        sourceLockPath: join(repoRoot, "lexicon", "source-locks", "technical-wikidata.json"),
        outDir: join(lexiconDir, "technical")
      });

      if (lexiconPacks === "corrupt") {
        const shardPath = join(lexiconDir, "core", "shards", "0000.jsonl");
        const bytes = new Uint8Array(await readFile(shardPath));
        const corruptBytes = new Uint8Array(bytes.byteLength + 1);
        corruptBytes.set(bytes);
        corruptBytes[corruptBytes.length - 1] = 10;
        await writeFile(shardPath, corruptBytes);
      } else if (lexiconPacks === "incompatible") {
        const coreManifestPath = join(lexiconDir, "core", "manifest.json");
        const manifest = JSON.parse(await readFile(coreManifestPath, "utf8"));
        manifest.formatVersion = 2;
        await writeFile(coreManifestPath, JSON.stringify(manifest) + "\n", "utf8");
      }
    }

    const manifestPath = join(extensionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.host_permissions = [
      "http://127.0.0.1/*",
      "https://api.deepseek.com/*",
      "https://raw.githubusercontent.com/*"
    ];
    if (ecdictMdxReleaseHostAccess) {
      manifest.host_permissions.push(
        "https://github.com/*",
        "https://release-assets.githubusercontent.com/*"
      );
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (ecdictMdxCachedArchivePath) {
      const mdxWorkerPath = join(
        extensionDir,
        "src",
        "options",
        "workers",
        "curated-ecdict-mdx-worker.js"
      );
      await writeFile(mdxWorkerPath, makeCachedEcdictMdxTestWorker(server.baseUrl));
    }

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
    await context.close();
    await server.close();
    await rm(tempRoot, { recursive: true, force: true });
  }, { scope: "worker" }]
});

export { expect };

function makeCachedEcdictMdxTestWorker(baseUrl) {
  return `import { createCuratedEcdictMdxWorkerHandler } from "./curated-ecdict-mdx-worker-core.js";

const handler = createCuratedEcdictMdxWorkerHandler({
  postMessage(message) { self.postMessage(message); },
  network: {
    async fetchSource(source, { signal } = {}) {
      if (
        source?.id !== "ecdict-en-zh-mdx-curated" ||
        source?.downloadUrl !== "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip"
      ) throw new Error("Test archive bridge only accepts the pinned ECDICT 1.0.28 recipe.");
      const local = await fetch(${JSON.stringify(`${baseUrl}/__e2e/ecdict-mdx-28.zip`)}, {
        method: "GET",
        cache: "no-store",
        signal
      });
      return {
        ok: local.ok,
        status: local.status,
        url: "https://release-assets.githubusercontent.com/e2e-cached/ecdict-mdx-28.zip",
        redirected: true,
        headers: local.headers,
        body: local.body,
        arrayBuffer() { return local.arrayBuffer(); }
      };
    }
  }
});

self.addEventListener("message", (event) => {
  Promise.resolve(handler.handleMessage(event.data)).catch((error) => {
    self.postMessage({
      type: "curated-ecdict-mdx:error",
      requestId: event.data?.requestId || "",
      error: error?.message || String(error),
      errorName: error?.name || "Error",
      errorCode: error?.code || ""
    });
  });
});
`;
}
