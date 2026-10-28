import { COMMANDS, routeCommand } from "./commands.js";

export const PAGE_TRANSLATE_MENU_ID = "translateflow-translate-page";
export const PAGE_MENU_PATTERNS = Object.freeze(["http://*/*", "https://*/*"]);
export const PAGE_MENU_CONTEXTS = Object.freeze(["page", "selection", "link", "image", "video", "audio", "editable", "frame"]);

// Chrome's documented message lookup is the only source for the menu label.
// The fallback keeps a usable menu if the locale catalog is unavailable.
export function pageMenuTitle(i18n = globalThis.chrome?.i18n) {
  try {
    const message = i18n?.getMessage?.("translatePage");
    if (typeof message === "string" && message.trim()) return message;
  } catch { /* Extension context may be gone; use the fallback label. */ }
  return "Translate or update the current page";
}

export function ensurePageContextMenu({
  menus = globalThis.chrome?.contextMenus, i18n = globalThis.chrome?.i18n
} = {}) {
  if (!menus?.create) return false;
  menus.create({
    id: PAGE_TRANSLATE_MENU_ID,
    title: pageMenuTitle(i18n),
    contexts: [...PAGE_MENU_CONTEXTS],
    documentUrlPatterns: [...PAGE_MENU_PATTERNS]
  }, () => {
    // Service workers restart often; an existing item is the expected state.
    const message = String(globalThis.chrome?.runtime?.lastError?.message || "");
    if (message && !/duplicate/iu.test(message)) console.warn(`[TranslateFlow] context menu unavailable: ${message}`);
  });
  return true;
}

export function registerContextMenuRouter({
  menus = globalThis.chrome?.contextMenus, route = routeCommand, report = () => {}
} = {}) {
  if (!menus?.onClicked?.addListener) return false;
  menus.onClicked.addListener((info, tab) => {
    if (info?.menuItemId !== PAGE_TRANSLATE_MENU_ID) return;
    if (!Number.isInteger(tab?.id)) return;
    route(COMMANDS.TRANSLATE_PAGE, tab).catch(report);
  });
  return true;
}
