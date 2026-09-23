import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ROOT_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.js",
  "popup.css",
  "options.html",
  "options.js",
  "options.css"
];

export async function prepareTestExtension() {
  const root = await mkdtemp(join(tmpdir(), "translateflow-e2e-extension-"));

  for (const file of ROOT_FILES) {
    await cp(join(REPO_ROOT, file), join(root, file));
  }
  await cp(join(REPO_ROOT, "src"), join(root, "src"), { recursive: true });

  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    "http://127.0.0.1/*"
  ])];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    path: root,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

export async function launchExtension(extensionPath) {
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");

  return {
    context,
    serviceWorker,
    extensionId: serviceWorker.url().split("/")[2]
  };
}

export async function configureExtension(serviceWorker, {
  apiBaseUrl,
  siteProfiles = {},
  glossary = { version: 1, entries: [] },
  siteGlossaries = { version: 1, sites: {} }
}) {
  await serviceWorker.evaluate(async (config) => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({
      provider: "openai-compatible",
      prompt: "Translate the provided English web-page segments into natural Simplified Chinese. Return JSON only.",
      targetLanguage: "Simplified Chinese",
      cacheMaxMB: 50,
      autoSites: [],
      openAICompatible: {
        baseUrl: config.apiBaseUrl,
        apiKey: "e2e-key",
        model: "e2e-model"
      },
      siteProfiles: config.siteProfiles,
      glossary: config.glossary,
      siteGlossaries: config.siteGlossaries
    });
  }, { apiBaseUrl, siteProfiles, glossary, siteGlossaries });
}

export async function injectExtension(serviceWorker, page) {
  const url = page.url();
  return serviceWorker.evaluate(async (targetUrl) => {
    const { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } = await import(
      chrome.runtime.getURL("src/shared/constants.js")
    );
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === targetUrl);
    if (!tab?.id) throw new Error(`fixture tab not found: ${targetUrl}`);

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: [...CONTENT_STYLE_FILES]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [...CONTENT_SCRIPT_FILES]
    });

    return tab.id;
  }, url);
}

export async function sendContentMessage(serviceWorker, page, message) {
  const url = page.url();
  return serviceWorker.evaluate(async ({ targetUrl, message }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === targetUrl);
    if (!tab?.id) throw new Error(`fixture tab not found: ${targetUrl}`);
    return chrome.tabs.sendMessage(tab.id, message);
  }, { targetUrl: url, message });
}

export async function getEffectiveContext(serviceWorker, pageUrl) {
  return serviceWorker.evaluate(async (targetUrl) => {
    const { getEffectiveContext } = await import(
      chrome.runtime.getURL("src/background/config.js")
    );
    return getEffectiveContext(targetUrl);
  }, pageUrl);
}

export async function setLocalConfig(serviceWorker, patch) {
  await serviceWorker.evaluate(async (value) => {
    await chrome.storage.local.set(value);
  }, patch);
}

export async function getLocalConfig(serviceWorker, keys) {
  return serviceWorker.evaluate(async (requestedKeys) => (
    chrome.storage.local.get(requestedKeys)
  ), keys);
}
