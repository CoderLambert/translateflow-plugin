import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startMockServer } from "./support/mock-server.mjs";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";

test("Selection assistant Port streams real text and stop preserves partial without late complete", async () => {
  test.setTimeout(60000); const temporary = await mkdtemp(join(tmpdir(), "tf-assistant-stream-")), extension = join(temporary, "extension"), profile = join(temporary, "profile");
  const server = await startMockServer(); let context;
  try {
    await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: "fixture", baseUrl: server.baseUrl });
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium", args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), id = new URL(worker.url()).host;
    const driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
    await driver.evaluate(baseUrl => chrome.storage.local.set({ provider: "openai-compatible", targetLanguage: "Simplified Chinese",
      openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: "", model: "mock-model", streaming: true } }), server.baseUrl);
    const page = await context.newPage(); await page.goto(`${server.baseUrl}/selection`); const tabId = await driver.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, page.url());
    async function command(name, requestId) { return driver.evaluate(async ({ tabId, name, requestId, pageUrl }) => { const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", args: [name, requestId, pageUrl], func: (name, requestId, pageUrl) => {
        if (name === "start") { const port = chrome.runtime.connect({ name: "selection.assistant-stream" }); globalThis.__stream = { port, events: [] };
          port.onMessage.addListener(value => globalThis.__stream.events.push(value)); port.postMessage({ protocolVersion: 1, type: "start", requestId, text: "session", pageUrl, context: null, depth: "standard", ownerToken: "0123456789abcdef0123456789abcdef",
            action: "understand", threadId: "thread-1", turnId: requestId, parentTurnId: null, branchId: requestId, regenerationOf: null }); }
        if (name === "cancel") globalThis.__stream.port.postMessage({ type: "cancel", requestId });
        return globalThis.__stream?.events || [];
      } }); return result.result; }, { tabId, name, requestId, pageUrl: page.url() }); }
    await command("start", "stream-stop"); await expect.poll(async () => (await command("read", "stream-stop")).filter(value => value.type === "delta").length).toBeGreaterThan(0);
    await command("cancel", "stream-stop"); await expect.poll(async () => (await command("read", "stream-stop")).at(-1)?.type).toBe("interrupted");
    await new Promise(resolve => setTimeout(resolve, 400)); let events = await command("read", "stream-stop"); expect(events.some(value => value.type === "complete" || value.turn)).toBe(false);
    await command("start", "stream-complete"); await expect.poll(async () => (await command("read", "stream-complete")).at(-1)?.type).toBe("complete");
    events = await command("read", "stream-complete"); expect(events.filter(value => value.type === "delta").map(value => value.text).join("")).toBe("streamed answer");
    expect(events.at(-1).turn).toMatchObject({ action: "understand", threadId: "thread-1", turnId: "stream-complete", parentTurnId: null,
      branchId: "stream-complete", regenerationOf: null, completionStatus: "completed", assistantAnswer: "streamed answer" });
  } finally { await context?.close(); await server.close(); await rm(temporary, { recursive: true, force: true }); }
});
