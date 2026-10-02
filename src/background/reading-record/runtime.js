import { READING_INVALIDATION_PORT } from "../../shared/reading/constants.js";
import { createReadingRepository } from "./repository.js";
import { createReadingService } from "./service.js";
import { createReadingSubscriptions } from "./subscriptions.js";

let current = null;
function createRuntime(repository, learningCenterAvailable, ownsRepository) {
  const service = createReadingService({ browser: globalThis.chrome, repository, learningCenterAvailable });
  const subscriptions = createReadingSubscriptions({ accessControl: service.accessControl, repository });
  const publishInvalidation = () => subscriptions.publish();
  repository?.setInvalidationPublisher?.(publishInvalidation);
  return { service, subscriptions, repository, ownsRepository, publishInvalidation };
}
function runtime() {
  // The repository factory is pure; native storage opens only for an authorized operation.
  if (!current) current = createRuntime(createReadingRepository(), false, true);
  return current;
}
// #234 supplies the owned collector; #235 enables the built fixed page.
export function configureReadingRuntime({ repository, learningCenterAvailable = false } = {}) {
  current?.subscriptions.close();
  current?.service.revoke();
  current?.repository?.setInvalidationPublisher?.(null);
  if (current?.ownsRepository) current.repository.close();
  const ownsRepository = repository === undefined;
  current = createRuntime(ownsRepository ? createReadingRepository() : repository, learningCenterAvailable, ownsRepository);
  return { publishInvalidation: current.publishInvalidation };
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
