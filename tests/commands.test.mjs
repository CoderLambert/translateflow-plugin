import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONTENT_MESSAGES } from "../src/shared/constants.js";
import { COMMANDS, createCommandRouter, isSupportedPage } from "../src/background/commands.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");

test("manifest exposes exactly the three v0.8 commands with conflict-conscious defaults", () => {
  assert.deepEqual(Object.keys(manifest.commands).sort(), Object.values(COMMANDS).sort());
  assert.equal(manifest.permissions.includes("activeTab"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*"]);

  assert.deepEqual(manifest.commands[COMMANDS.TRANSLATE_PAGE].suggested_key, {
    default: "Ctrl+Shift+Y",
    mac: "MacCtrl+Shift+Y"
  });
  assert.deepEqual(manifest.commands[COMMANDS.TOGGLE_TRANSLATIONS].suggested_key, {
    default: "Ctrl+Shift+K",
    mac: "MacCtrl+Shift+K"
  });
  assert.deepEqual(manifest.commands[COMMANDS.TOGGLE_QUICK_CONTROL].suggested_key, {
    default: "Ctrl+Shift+Period",
    mac: "MacCtrl+Shift+Period"
  });

  const keys = Object.values(manifest.commands).flatMap((entry) => Object.values(entry.suggested_key || {}));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.some((value) => value.includes("Ctrl+Alt")), false);
  assert.equal(keys.includes("Alt+Shift+T"), false);
});

test("Settings documents command management and all three default actions", () => {
  assert.match(optionsHtml, /chrome:\/\/extensions\/shortcuts/);
  assert.match(optionsHtml, /翻译 \/ 更新当前页/);
  assert.match(optionsHtml, /显示 \/ 隐藏译文/);
  assert.match(optionsHtml, /切换 Quick Control/);
  assert.match(optionsHtml, /Ctrl\+Shift\+Y/);
  assert.match(optionsHtml, /Ctrl\+Shift\+K/);
  assert.match(optionsHtml, /Ctrl\+Shift\+\./);
});

test("command routing accepts only normal web pages", () => {
  assert.equal(isSupportedPage("https://example.com/docs"), true);
  assert.equal(isSupportedPage("http://localhost:3000"), true);
  assert.equal(isSupportedPage("chrome://extensions/"), false);
  assert.equal(isSupportedPage("file:///tmp/test.html"), false);
  assert.equal(isSupportedPage("not a url"), false);
});

test("command router sends each shipped action through its existing content message", async () => {
  const cases = [
    [COMMANDS.TRANSLATE_PAGE, { type: CONTENT_MESSAGES.TRANSLATE_PAGE, taskId: "task-fixed" }],
    [COMMANDS.TOGGLE_TRANSLATIONS, { type: CONTENT_MESSAGES.TOGGLE_TRANSLATIONS }],
    [COMMANDS.TOGGLE_QUICK_CONTROL, { type: CONTENT_MESSAGES.QUICK_CONTROL_TOGGLE }]
  ];

  for (const [command, expectedMessage] of cases) {
    const sent = [];
    let injected = 0;
    const route = createCommandRouter({
      queryActiveTab: async () => ({ id: 17, url: "https://example.com/article" }),
      sendContentMessage: async (tabId, message) => {
        sent.push({ tabId, message });
        return { ok: true, routed: command };
      },
      injectContent: async () => { injected += 1; },
      createTaskId: () => "task-fixed"
    });

    const result = await route(command);
    assert.deepEqual(result, { ok: true, routed: command });
    assert.deepEqual(sent, [{ tabId: 17, message: expectedMessage }]);
    assert.equal(injected, 0);
  }
});

test("command router injects the existing bundle once when first delivery fails, then retries the same action", async () => {
  const sent = [];
  const injected = [];
  let attempts = 0;
  const route = createCommandRouter({
    queryActiveTab: async () => ({ id: 23, url: "https://example.com/first-use" }),
    sendContentMessage: async (tabId, message) => {
      attempts += 1;
      sent.push({ tabId, message });
      if (attempts === 1) throw new Error("Receiving end does not exist.");
      return { ok: true };
    },
    injectContent: async (tabId) => { injected.push(tabId); },
    createTaskId: () => "first-use-task"
  });

  assert.deepEqual(await route(COMMANDS.TRANSLATE_PAGE), { ok: true });
  assert.deepEqual(injected, [23]);
  assert.deepEqual(sent, [
    { tabId: 23, message: { type: CONTENT_MESSAGES.TRANSLATE_PAGE, taskId: "first-use-task" } },
    { tabId: 23, message: { type: CONTENT_MESSAGES.TRANSLATE_PAGE, taskId: "first-use-task" } }
  ]);
});

test("command router rejects protected pages before send/injection and ignores unknown commands", async () => {
  let queries = 0;
  let sends = 0;
  let injections = 0;
  const route = createCommandRouter({
    queryActiveTab: async () => {
      queries += 1;
      return { id: 31, url: "chrome://extensions/" };
    },
    sendContentMessage: async () => { sends += 1; },
    injectContent: async () => { injections += 1; }
  });

  assert.deepEqual(await route(COMMANDS.TRANSLATE_PAGE), { ok: false, unsupported: true });
  assert.equal(queries, 1);
  assert.equal(sends, 0);
  assert.equal(injections, 0);

  assert.deepEqual(await route("unknown-command"), { ok: false, ignored: true });
  assert.equal(queries, 1);
});
