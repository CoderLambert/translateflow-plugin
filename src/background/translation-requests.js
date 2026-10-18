import { executeTranslation } from './translation-gateway.js';
import { createTranslationCoordinator } from './cache/translation-coordinator.js';

const coordinator = createTranslationCoordinator(executeTranslation);
export const runTranslationRequest = input => coordinator.run(input);
export const cancelTranslationRequest = requestId => coordinator.cancel(requestId);
export const cancelTextTranslations = pageUrl => coordinator.cancelText(pageUrl);
export const cancelMachineTranslations = tabId => coordinator.cancelMachine(tabId);
export { buildTranslationRequestKey } from './cache/translation-coordinator.js';
