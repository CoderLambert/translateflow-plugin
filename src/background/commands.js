import { CONTENT_MESSAGES, CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../shared/constants.js";

export const COMMANDS = Object.freeze({
  TRANSLATE_PAGE: "translate-page",
  TOGGLE_TRANSLATIONS: "toggle-translations",
  TOGGLE_QUICK_CONTROL: "toggle-quick-control"
});

const COMMAND_MESSAGE = Object.freeze({
  [COMMANDS.TRANSLATE_PAGE]: CONTENT_MESSAGES.TRANSLATE_PAGE,
  [COMMANDS.TOGGLE_TRANSLATIONS]: CONTENT_MESSAGES.TOGGLE_TRANSLATIONS,
  [COMMANDS.TOGGLE_QUICK_CONTROL]: CONTENT_MESSAGES.QUICK_CONTROL_TOGGLE
});

export function registerCommandRouter() {
  chrome.commands.onCommand.addListener((command) => {
    routeCommand(command).catch(() => {});
  });
}

export async function routeCommand(command) {
  const type = COMMAND_MESSAGE[command];
  if (!type) return { ok: false, ignored: true };

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !isSupportedPage(tab.url)) return { ok: false, unsupported: true };

  const message = type === CONTENT_MESSAGES.TRANSLATE_PAGE
    ? { type, taskId: crypto.randomUUID() }
    : { type };

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await injectTranslateFlow(tab.id);
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

export function isSupportedPage(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

async function injectTranslateFlow(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: [...CONTENT_STYLE_FILES] });
  await chrome.scripting.executeScript({ target: { tabId }, files: [...CONTENT_SCRIPT_FILES] });
}
