import { READING_INVALIDATION_PORT, READING_METHOD as M } from "../../shared/reading/constants.js";
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
  if (!current) current = createRuntime(createReadingRepository(), true, true);
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
export async function handleReadingMessage(message, sender) {
  const state = runtime(), result = await state.service.handle(message, sender);
  if (message?.method === M.SET_SITE_MARKERS && result?.ok === true) await state.subscriptions.publishSiteMarkers();
  return result;
}
export function prepareLearningAssistantTurn(sender, input, ground, options) { return runtime().service.prepareAssistantTurn(sender, input, ground, options); }
export function commitLearningAssistantTurn(session, artifact, options) { return runtime().service.commitAssistantTurn(session, artifact, options); }
export function cancelLearningAssistantTurn(session) { return runtime().service.cancelAssistantTurn(session); }
export function handleReadingPort(port) {
  if (port.name !== READING_INVALIDATION_PORT) return false;
  void runtime().subscriptions.connect(port);
  return true;
}
export function onReadingTabUpdated(tabId, changeInfo) {
  if (changeInfo?.status === "loading" || Object.hasOwn(changeInfo || {}, "url")) {
    const state = runtime(); state.service.onTabUpdated(tabId, changeInfo); state.subscriptions.closeTab(tabId);
  }
}
export function onReadingTabRemoved(tabId) { const state = runtime(); state.service.forgetTab(tabId); state.subscriptions.closeTab(tabId); }
export function onReadingPermissionsRemoved() { runtime().service.revoke(); runtime().subscriptions.close(); }
