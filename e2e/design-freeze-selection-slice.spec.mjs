import { test, expect } from "./support/extension-fixture.mjs";

const PORT = "TF_DESIGN_FREEZE_SELECTION_POC";

test.describe("Selection v2 Design Freeze vertical slice", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("local lexical/entity hits avoid Provider; ambiguous and sentence routes reuse Background translation boundary", async ({ harness }) => {
    const worker = harness.context.serviceWorkers()[0];
    await worker.evaluate((portName) => {
      if (globalThis.__tfDesignFreezePortInstalled) return;
      globalThis.__tfDesignFreezePortInstalled = true;
      globalThis.__tfDesignFreezeLatestRequest = "";

      const local = new Map([
        ["persistent", {
          route: "local",
          candidates: [
            { id: "pwn:persistent-duration", source: "core", zh: ["持久的", "持续存在的"] }
          ]
        }],
        ["tmux", {
          route: "local",
          candidates: [
            { id: "wd:Q1935361", source: "technical", zh: ["终端复用器"], type: "software" }
          ]
        }],
        ["session", {
          route: "explain",
          candidates: [
            { id: "poc:session-general", source: "core", zh: ["会期", "学期"] },
            { id: "poc:session-computing", source: "technical", zh: ["会话"], domain: "computing" }
          ]
        }]
      ]);

      chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== portName) return;
        port.onMessage.addListener((message) => {
          const requestId = String(message?.requestId || "");
          globalThis.__tfDesignFreezeLatestRequest = requestId;
          const respond = () => {
            if (globalThis.__tfDesignFreezeLatestRequest !== requestId) {
              port.postMessage({ requestId, route: "superseded" });
              return;
            }

            const text = String(message?.text || "").trim();
            const key = text.toLowerCase();
            const words = key.split(/\s+/).filter(Boolean);
            if (words.length >= 6) {
              port.postMessage({ requestId, route: "translation" });
              return;
            }

            const hit = local.get(key);
            if (hit) {
              port.postMessage({
                requestId,
                ...hit,
                context: String(message?.context || "").slice(0, 160)
              });
              return;
            }

            port.postMessage({ requestId, route: "no-hit", candidates: [] });
          };
          setTimeout(respond, Math.max(0, Number(message?.delayMs || 0)));
        });
      });
    }, PORT);

    const page = await harness.open("/article");
    await harness.inject(page);

    const persistent = await runSelection(harness, page, {
      requestId: "local-persistent",
      text: "persistent",
      context: "A persistent tmux session survives after the terminal closes."
    });
    expect(persistent.route).toBe("local");
    expect(persistent.candidates[0]).toMatchObject({ source: "core", zh: ["持久的", "持续存在的"] });
    expect(harness.server.calls).toHaveLength(0);

    const tmux = await runSelection(harness, page, {
      requestId: "local-tmux",
      text: "tmux",
      context: "With tmux, you can create multiple terminal sessions."
    });
    expect(tmux.route).toBe("local");
    expect(tmux.candidates[0]).toMatchObject({ id: "wd:Q1935361", zh: ["终端复用器"] });
    expect(harness.server.calls).toHaveLength(0);

    const ambiguous = await runSelection(harness, page, {
      requestId: "ambiguous-session",
      text: "session",
      context: "A tmux session can survive after the terminal closes.",
      invokeFallback: true
    });
    expect(ambiguous.route).toBe("explain");
    expect(ambiguous.context).toContain("tmux session");
    expect(ambiguous.fallback?.ok).toBe(true);
    expect(harness.server.calls).toHaveLength(1);
    expect(harness.server.calls[0].body).toContain("poc:session-computing");

    const sentence = await runSelection(harness, page, {
      requestId: "sentence-fallback",
      text: "You can resume your session after closing the terminal.",
      context: "You can resume your session after closing the terminal.",
      invokeFallback: true
    });
    expect(sentence.route).toBe("translation");
    expect(sentence.fallback?.ok).toBe(true);
    expect(harness.server.calls).toHaveLength(2);

    const delayed = runSelection(harness, page, {
      requestId: "superseded-a",
      text: "persistent",
      context: "persistent",
      delayMs: 120
    });
    await page.waitForTimeout(15);
    const current = await runSelection(harness, page, {
      requestId: "superseded-b",
      text: "tmux",
      context: "tmux"
    });
    const stale = await delayed;
    expect(current.route).toBe("local");
    expect(stale.route).toBe("superseded");

    await page.close();
  });
});

async function runSelection(harness, page, input) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, portName, input, pageUrl }) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ portName, input, pageUrl }) => {
        const lexical = await new Promise((resolve, reject) => {
          const port = chrome.runtime.connect({ name: portName });
          const timer = setTimeout(() => reject(new Error("Design Freeze port timeout")), 3000);
          port.onMessage.addListener((message) => {
            if (String(message?.requestId || "") !== String(input.requestId || "")) return;
            clearTimeout(timer);
            resolve(message);
            port.disconnect();
          });
          port.postMessage(input);
        });

        if (!input.invokeFallback || !["explain", "translation"].includes(lexical.route)) {
          return lexical;
        }

        const sourceText = lexical.route === "translation"
          ? input.text
          : JSON.stringify({
              intent: "selection-explain-poc",
              selectedText: input.text,
              context: lexical.context,
              candidates: lexical.candidates
            });

        const fallback = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          requestId: input.requestId + "-fallback",
          pageUrl,
          segments: [{ id: "selection-poc", text: sourceText }]
        });
        return { ...lexical, fallback };
      },
      args: [{ portName, input, pageUrl }]
    });
    return result;
  }, { tabId, portName: PORT, input, pageUrl: page.url() });
}
