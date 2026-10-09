import { chatGPTPlanController } from "./chatgpt-plan.js";

export async function handleChatGPTPlanAction(action, controller = chatGPTPlanController, input = {}) {
  if (action === "status") return { status: await controller.authStatus() };
  if (action === "models") return controller.listModels();
  if (action === "connect" || action === "add") {
    await controller.ensureConnected();
    const modelSelectionCleared = await clearChatGPTPlanModelSelections();
    try {
      return { ...(await controller.startAuth({ addAccount: action === "add" })), modelSelectionCleared };
    } catch (error) {
      if (modelSelectionCleared) error.modelSelectionCleared = true;
      throw error;
    }
  }
  if (action === "select") {
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    if (!accountId || accountId.length > 128) {
      const error = new Error("Select a valid saved ChatGPT account.");
      error.code = "CHATGPT_ACCOUNT_INVALID";
      throw error;
    }
    await controller.ensureConnected();
    await controller.selectAccount(accountId);
    return { selected: true, modelSelectionCleared: await clearChatGPTPlanModelSelections() };
  }
  if (action === "logout") {
    const result = await controller.logout();
    return { ...result, modelSelectionCleared: await clearChatGPTPlanModelSelections() };
  }
  const error = new Error("The ChatGPT subscription action is not supported.");
  error.code = "CHATGPT_ACTION_INVALID";
  throw error;
}

export async function clearChatGPTPlanModelSelections(storage = chrome.storage.local) {
  const stored = await storage.get(["provider", "chatgptPlanModel", "siteProfiles"]);
  const globalProvider = providerId(stored.provider);
  const patch = {};
  if (String(stored.chatgptPlanModel || "")) patch.chatgptPlanModel = "";

  const profiles = stored.siteProfiles && typeof stored.siteProfiles === "object" && !Array.isArray(stored.siteProfiles)
    ? stored.siteProfiles : {};
  const nextProfiles = { ...profiles };
  let profilesChanged = false;
  for (const [origin, raw] of Object.entries(profiles)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const profileProvider = providerId(raw.provider || globalProvider);
    if (profileProvider !== "chatgpt-plan" || !String(raw.model || "")) continue;
    const next = { ...raw };
    delete next.model;
    nextProfiles[origin] = next;
    profilesChanged = true;
  }
  if (profilesChanged) patch.siteProfiles = nextProfiles;
  if (Object.keys(patch).length) await storage.set(patch);
  return Object.keys(patch).length > 0;
}

function providerId(value) { return String(value || "deepseek").trim().toLowerCase(); }
