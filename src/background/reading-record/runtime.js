import { READING_INVALIDATION_PORT } from "../../shared/reading/constants.js";
import { createReadingService } from "./service.js";
import { createReadingSubscriptions } from "./subscriptions.js";

let current = null;
function runtime() {
  // Lazy creation keeps registration synchronous and imports free from chrome/storage side effects.
  if (!current) {
    const service = createReadingService({ browser: globalThis.chrome });
    current = { service, subscriptions: createReadingSubscriptions({ accessControl: service.accessControl, repository: null }) };
  }
  return current;
}
// #233 replaces only the repository; #234 supplies the owned collector, #235 enables the built fixed page.
export function configureReadingRuntime({ repository, learningCenterAvailable = false } = {}) {
  current?.subscriptions.close();
  current?.service.revoke();
  const service = createReadingService({ browser: globalThis.chrome, repository, learningCenterAvailable });
  const subscriptions = createReadingSubscriptions({ accessControl: service.accessControl, repository });
  current = { service, subscriptions };
  return { publishInvalidation: () => subscriptions.publish() };
}
export function isReadingMessage(message) { return typeof message?.method === "string" && message.method.startsWith("reading."); }
export function handleReadingMessage(message, sender) { return runtime().service.handle(message, sender); }
export function handleReadingPort(port) {
  if (port.name !== READING_INVALIDATION_PORT) return false;
  void runtime().subscriptions.connect(port);
  return true;
}
export function onReadingTabUpdated(tabId, changeInfo) {
  if (changeInfo?.status === "loading" || Object.hasOwn(changeInfo || {}, "url")) {
    const state = runtime(); state.service.invalidateTab(tabId); state.subscriptions.closeTab(tabId);
  }
}
export function onReadingTabRemoved(tabId) { const state = runtime(); state.service.forgetTab(tabId); state.subscriptions.closeTab(tabId); }
export function onReadingPermissionsRemoved() { runtime().service.revoke(); runtime().subscriptions.close(); }
