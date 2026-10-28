import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PAGE_MENU_CONTEXTS, PAGE_MENU_PATTERNS, PAGE_TRANSLATE_MENU_ID, ensurePageContextMenu, pageMenuTitle, registerContextMenuRouter } from "../src/background/context-menu.js";
import { COMMANDS, createCommandRouter } from "../src/background/commands.js";
import { CONTENT_MESSAGES } from "../src/shared/constants.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

function menusFixture({ createError = "" } = {}) {
  const created = [], listeners = [], warnings = [];
  globalThis.chrome = { runtime: { lastError: createError ? { message: createError } : undefined } };
  const menus = {
    create(properties, callback) { created.push(properties); callback?.(); },
    onClicked: { addListener(listener) { listeners.push(listener); } }
  };
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  return { menus, created, listeners, warnings, restore() { console.warn = originalWarn; delete globalThis.chrome; } };
}

test("the extension declares only the contextMenus permission needed for this entry", () => {
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*", "http://*/*", "https://*/*"]);
  assert.equal(manifest.optional_permissions, undefined);
});

test("the page menu is created once for ordinary web documents with the localized label", () => {
  const f = menusFixture();
  try {
    assert.equal(ensurePageContextMenu({ menus: f.menus, i18n: { getMessage: key => key === "translatePage" ? "翻译或更新当前页面" : "" } }), true);
    assert.deepEqual(f.created, [{ id: PAGE_TRANSLATE_MENU_ID, title: "翻译或更新当前页面",
      contexts: [...PAGE_MENU_CONTEXTS], documentUrlPatterns: [...PAGE_MENU_PATTERNS] }]);
    assert.ok(!PAGE_MENU_CONTEXTS.includes("action"), "the toolbar action menu is not a page translation entry");
    assert.deepEqual(f.warnings, []);
    assert.equal(ensurePageContextMenu({ menus: f.menus, i18n: { getMessage: () => "Label" } }), true);
    assert.equal(f.created.length, 2, "restart-safe creation is idempotent at the Chrome level, not by breaking on duplicates");
  } finally { f.restore(); }
});

test("duplicate registration is harmless and other menu errors are not silently hidden", () => {
  const duplicate = menusFixture({ createError: "Cannot create item with duplicate id translateflow-translate-page" });
  try {
    ensurePageContextMenu({ menus: duplicate.menus, i18n: { getMessage: () => "Label" } });
    assert.deepEqual(duplicate.warnings, []);
  } finally { duplicate.restore(); }
  const failed = menusFixture({ createError: "Synthetic unavailable" });
  try {
    ensurePageContextMenu({ menus: failed.menus, i18n: { getMessage: () => "Label" } });
    assert.equal(failed.warnings.length, 1); assert.match(failed.warnings[0], /context menu unavailable/u);
  } finally { failed.restore(); }
});

test("a missing or invalidated localization lookup keeps a usable English label", () => {
  assert.equal(pageMenuTitle({ getMessage: () => "" }), "Translate or update the current page");
  assert.equal(pageMenuTitle({ getMessage() { throw new Error("Extension context invalidated."); } }), "Translate or update the current page");
  assert.equal(pageMenuTitle(undefined), "Translate or update the current page");
});

test("a menu click translates the tab Chrome reported, without querying another window", async () => {
  const f = menusFixture();
  try {
    let queries = 0, routes = [];
    registerContextMenuRouter({ menus: f.menus, route: async (command, tab) => { routes.push({ command, tab }); } });
    assert.equal(f.listeners.length, 1);
    const tab = { id: 41, url: "https://example.com/article" };
    f.listeners[0]({ menuItemId: PAGE_TRANSLATE_MENU_ID, pageUrl: tab.url }, tab);
    f.listeners[0]({ menuItemId: "another-extension", pageUrl: tab.url }, tab);
    f.listeners[0]({ menuItemId: PAGE_TRANSLATE_MENU_ID }, undefined);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(routes, [{ command: COMMANDS.TRANSLATE_PAGE, tab }]);
    assert.equal(queries, 0);
  } finally { f.restore(); }
});

test("an explicit tab replaces the active-tab query and keeps protected pages rejected", async () => {
  const sent = [];
  let queries = 0, injections = 0;
  const route = createCommandRouter({
    queryActiveTab: async () => { queries += 1; return { id: 7, url: "https://other.example/" }; },
    sendContentMessage: async (tabId, message) => { sent.push({ tabId, message }); return { ok: true }; },
    injectContent: async () => { injections += 1; },
    createTaskId: () => "context-task"
  });
  assert.deepEqual(await route(COMMANDS.TRANSLATE_PAGE, { id: 52, url: "https://example.com/page" }), { ok: true });
  assert.deepEqual(sent, [{ tabId: 52, message: { type: CONTENT_MESSAGES.TRANSLATE_PAGE, taskId: "context-task" } }]);
  assert.equal(queries, 0); assert.equal(injections, 0);
  assert.deepEqual(await route(COMMANDS.TRANSLATE_PAGE, { id: 53, url: "chrome://extensions/" }), { ok: false, unsupported: true });
  assert.equal(sent.length, 1);
});

test("a failed context-menu route is reported instead of becoming an unhandled rejection", async () => {
  const f = menusFixture();
  const reported = [];
  try {
    registerContextMenuRouter({ menus: f.menus, route: async () => { throw new Error("Synthetic route failure"); }, report: error => reported.push(error) });
    f.listeners[0]({ menuItemId: PAGE_TRANSLATE_MENU_ID }, { id: 61, url: "https://example.com/" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reported.length, 1);
    assert.match(reported[0].message, /Synthetic route failure/u);
  } finally { f.restore(); }
});
