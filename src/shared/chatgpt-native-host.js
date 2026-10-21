export const CHATGPT_PLAN_NATIVE_HOST = "com.coderlambert.translateflow";
export const CHATGPT_PLAN_NATIVE_PERMISSION = "nativeMessaging";
export const CHATGPT_PLAN_MIN_HOST_VERSION = "0.8.0";
export const CHATGPT_PLAN_HOST_DOWNLOAD_URL = "https://github.com/CoderLambert/translateflow-plugin/releases/latest";
export const CHATGPT_PLAN_DEV_GUIDE_URL = "https://github.com/CoderLambert/translateflow-plugin/blob/main/docs/CHATGPT_DEVELOPMENT_BUILD.md";

// Only the separately built, explicitly identified unpacked developer edition exposes this experiment.
// Accept manifest input rather than reading chrome.* inside a shared pure module.
export function isChatGPTPlanDeveloperBuild(manifest) {
  return Boolean(manifest && typeof manifest.version === "string" &&
    manifest.version_name === `${manifest.version}-dev` &&
    manifest.optional_permissions?.includes("nativeMessaging"));
}

export function requireChatGPTPlanDeveloperBuild(manifest) {
  if (isChatGPTPlanDeveloperBuild(manifest)) return;
  const error = new Error("ChatGPT subscription is available only in the GitHub developer build. Your existing settings are preserved.");
  error.code = "CHATGPT_PLAN_DEV_ONLY";
  throw error;
}

export function compareHostVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function supportedHostVersion(value, minimum = CHATGPT_PLAN_MIN_HOST_VERSION) {
  if (value === "dev") return true;
  const comparison = compareHostVersions(value, minimum);
  return comparison !== null && comparison >= 0;
}

export function validHostVersion(value) {
  return value === "dev" || parseVersion(value) !== null;
}

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
