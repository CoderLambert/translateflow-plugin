import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  BACKGROUND_MESSAGES,
  CONTENT_SCRIPT_FILES,
  CONTENT_STYLE_FILES
} from "../../../src/shared/constants.js";

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
  await writeFile(
    join(root, "e2e-control.html"),
    "<!doctype html><meta charset=\"utf-8\"><title>TranslateFlow E2E Control</title>\n"
  );

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

  const extensionId = serviceWorker.url().split("/")[2];
  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${extensionId}/e2e-control.html`);

  return {
    context,
    serviceWorker,
    extensionId,
    controlPage
  };
}

export async function configureExtension(controlPage, {
  apiBaseUrl,
  siteProfiles = {},
  glossary = { version: 1, entries: [] },
  siteGlossaries = { version: 1, sites: {} }
}) {
  await controlPage.evaluate(async (config) => {
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

export async function injectExtension(controlPage, page) {
  const url = page.url();
  return controlPage.evaluate(async ({ targetUrl, scriptFiles, styleFiles }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === targetUrl);
    if (!tab?.id) throw new Error(`fixture tab not found: ${targetUrl}`);

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: styleFiles
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: scriptFiles
    });

    return tab.id;
  }, {
    targetUrl: url,
    scriptFiles: [...CONTENT_SCRIPT_FILES],
    styleFiles: [...CONTENT_STYLE_FILES]
  });
}

export async function sendContentMessage(controlPage, page, message) {
  const url = page.url();
  return controlPage.evaluate(async ({ targetUrl, message }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === targetUrl);
    if (!tab?.id) throw new Error(`fixture tab not found: ${targetUrl}`);
    return chrome.tabs.sendMessage(tab.id, message);
  }, { targetUrl: url, message });
}

export async function getEffectiveContext(controlPage, pageUrl) {
  const response = await controlPage.evaluate(async ({ pageUrl, type }) => (
    chrome.runtime.sendMessage({ type, pageUrl })
  ), {
    pageUrl,
    type: BACKGROUND_MESSAGES.EFFECTIVE_CONTEXT
  });

  if (!response?.ok) throw new Error(response?.error || "failed to resolve effective context");
  return response.context;
}

export async function setLocalConfig(controlPage, patch) {
  await controlPage.evaluate(async (value) => {
    await chrome.storage.local.set(value);
  }, patch);
}

export async function getLocalConfig(controlPage, keys) {
  return controlPage.evaluate(async (requestedKeys) => (
    chrome.storage.local.get(requestedKeys)
  ), keys);
}
