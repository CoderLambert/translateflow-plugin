import { normalizePresetId } from "../shared/presets.js";
import { normalizeOrigin } from "../shared/url.js";

const SESSION_KEY = "temporaryPresetOverrides";

export async function getTemporaryPresetOverride(pageUrl) {
  const origin = normalizeOrigin(pageUrl);
  const stored = await chrome.storage.session.get([SESSION_KEY]);
  const overrides = normalizeOverrides(stored[SESSION_KEY]);

  if (!Object.prototype.hasOwnProperty.call(overrides, origin)) {
    return { active: false, presetId: "", origin };
  }

  return {
    active: true,
    presetId: normalizePresetId(overrides[origin]),
    origin
  };
}

export async function setTemporaryPresetOverride(pageUrl, value) {
  const origin = normalizeOrigin(pageUrl);
  const stored = await chrome.storage.session.get([SESSION_KEY]);
  const overrides = normalizeOverrides(stored[SESSION_KEY]);
  const normalizedValue = String(value ?? "").trim().toLowerCase();

  if (!normalizedValue || normalizedValue === "inherit") {
    delete overrides[origin];
  } else if (normalizedValue === "none") {
    overrides[origin] = "";
  } else {
    const presetId = normalizePresetId(normalizedValue);
    if (!presetId) throw new Error(`未知翻译模式：${value}`);
    overrides[origin] = presetId;
  }

  if (Object.keys(overrides).length) {
    await chrome.storage.session.set({ [SESSION_KEY]: overrides });
  } else {
    await chrome.storage.session.remove([SESSION_KEY]);
  }

  return getTemporaryPresetOverride(pageUrl);
}

export async function clearTemporaryPresetOverride(pageUrl) {
  return setTemporaryPresetOverride(pageUrl, "inherit");
}

function normalizeOverrides(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}
