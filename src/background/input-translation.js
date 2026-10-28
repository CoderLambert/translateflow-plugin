import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { EXTENSION_PAGES } from "../shared/runtime-assets.js";
import { INPUT_TRANSLATION_PORT, INPUT_TRANSLATION_LIMITS, validInputTranslation, inputTranslationPrompt } from "../shared/input-translation.js";
import { getProviderHostPermissionPattern, resolveTranslationConfig } from "../shared/provider-config.js";
import { getConfig } from "./config.js";
import { runTranslationRequest, cancelTranslationRequest } from "./translation-requests.js";

let opening;
const active = new Set();
export function isInputTranslationSender(sender, allowPopup = false) {
  const pages = [EXTENSION_PAGES.inputTranslation, ...(allowPopup ? [EXTENSION_PAGES.popup] : [])];
  return sender?.id === chrome.runtime.id && sender?.tab?.incognito !== true &&
    (sender.frameId === undefined || sender.frameId === 0) && pages.some(page => sender.url === chrome.runtime.getURL(page));
}
export async function openInputTranslation() {
  if (opening) return opening;
  opening = (async () => {
    const url = chrome.runtime.getURL(EXTENSION_PAGES.inputTranslation);
    // Extension contexts are visible without the broad tabs permission. URL-filtered
    // tabs.query cannot reliably discover an extension-owned window.
    const contexts = typeof chrome.runtime.getContexts === "function"
      ? await chrome.runtime.getContexts({ documentUrls: [url] }) : null;
    const saved = contexts ? null : (await chrome.storage.session.get("inputTranslationWindowV1")).inputTranslationWindowV1;
    const existing = contexts ? contexts.find(item => !item.incognito && item.windowId >= 0 && item.tabId >= 0) : saved;
    if (existing) {
      try { await chrome.windows.update(existing.windowId, { focused: true }); await chrome.tabs.update(existing.tabId, { active: true }); return { opened: true }; }
      catch { /* The window may have closed during the query. */ }
    }
    const created = await chrome.windows.create({ url, type: "popup", width: 580, height: 760, focused: true, incognito: false });
    if (!contexts) await chrome.storage.session.set({ inputTranslationWindowV1: { windowId: created.id, tabId: created.tabs?.[0]?.id } });
    return { opened: true };
  })();
  try { return await opening; } finally { opening = null; }
}
export async function handleInputTranslationMessage(message, sender) {
  if (!isInputTranslationSender(sender, message.type === BACKGROUND_MESSAGES.INPUT_TRANSLATION_OPEN)) throw Object.assign(new Error("Unavailable"), { code: "FORBIDDEN" });
  if (message.type === BACKGROUND_MESSAGES.INPUT_TRANSLATION_OPEN) return openInputTranslation();
  const stored = await getConfig();
  return { targetLanguage: stored.targetLanguage, services: Object.values(stored.providerConnections).map(item => ({
    id: item.id, label: item.name, model: item.defaultModel, permission: getProviderHostPermissionPattern(item.baseUrl)
  })), defaultLabel: defaultLabel(stored), defaultPermission: stored.defaultService?.kind === "api-key" && stored.providerConnections[stored.defaultService.connectionId]
    ? getProviderHostPermissionPattern(stored.providerConnections[stored.defaultService.connectionId].baseUrl) : "" };
}
function defaultLabel(stored) {
  const service = stored.defaultService;
  if (service?.kind === "chatgpt-plan") return "ChatGPT";
  const connection = stored.providerConnections[service?.connectionId];
  return connection ? [connection.name, connection.defaultModel].filter(Boolean).join(" · ") : "";
}
export function handleInputTranslationPort(port, deps = {}) {
  if (port.name !== INPUT_TRANSLATION_PORT) return false;
  if (!isInputTranslationSender(port.sender) || active.size >= 8) { port.disconnect(); return true; }
  const state = { closed: false, started: false, stopped: false, id: crypto.randomUUID() };
  active.add(state);
  const cancel = () => { state.stopped = true; (deps.cancel || cancelTranslationRequest)(state.id); };
  const close = () => { state.closed = true; cancel(); active.delete(state); };
  const post = message => { if (!state.closed) try { port.postMessage(message); } catch { close(); } };
  port.onDisconnect.addListener(close);
  port.onMessage.addListener(message => {
    if (message?.type === "stop") { cancel(); return; }
    if (state.started) return;
    state.started = true;
    if (!validInputTranslation(message)) { post({ type: "error", code: "INPUT_LIMIT" }); active.delete(state); return; }
    // Pin the payload before any configuration/storage await.
    const request = structuredClone(message);
    void (async () => {
      try {
        const stored = await (deps.getConfig || getConfig)();
        if (state.stopped) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
        if (request.service && !Object.hasOwn(stored.providerConnections || {}, request.service)) throw Object.assign(new Error("Unknown connection"), { code: "CONNECTION_MISSING" });
        const config = resolveTranslationConfig({ ...stored, siteProfiles: {},
          ...(request.service ? { defaultService: { kind: "api-key", connectionId: request.service } } : {}) });
        config.targetLanguage = request.targetLanguage;
        config.prompt = inputTranslationPrompt(request);
        config.streaming = false;
        if (config.provider !== "chatgpt-plan" && !await chrome.permissions.contains({ origins: [getProviderHostPermissionPattern(config.apiBaseUrl)] })) throw Object.assign(new Error("Permission required"), { code: "PERMISSION" });
        if (state.stopped) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
        post({ type: "started", service: [config.providerLabel || config.provider, config.model].filter(Boolean).join(" · ") });
        const result = await (deps.run || runTranslationRequest)({ requestId: state.id,
          segments: [{ id: "input", text: request.text }], config });
        if (state.stopped) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
        const text = result?.[0]?.text;
        if (typeof text !== "string" || !text.trim() || text.length > INPUT_TRANSLATION_LIMITS.output) throw Object.assign(new Error("Invalid translation"), { code: "MALFORMED_RESPONSE" });
        post({ type: "complete", text });
      } catch (error) {
        post({ type: "error", code: state.stopped ? "CANCELLED" : String(error?.code || "FAILED") });
      } finally { active.delete(state); }
    })();
  });
  return true;
}
