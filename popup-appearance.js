import {
  DEFAULT_APPEARANCE_ID,
  TRANSLATION_APPEARANCES,
  normalizeAppearanceId,
  resolveAppearance
} from "./src/shared/appearance.js";
import { normalizeOrigin } from "./src/shared/url.js";

const select = document.getElementById("appearanceSelect");

if (select) {
  initialize().catch(() => {
    select.disabled = true;
    select.replaceChildren(new Option("不可用于当前页面", ""));
  });
}

async function initialize() {
  const site = await getActiveSite();
  const stored = await chrome.storage.local.get(["appearance", "siteProfiles"]);
  const defaultAppearance = normalizeAppearanceId(stored.appearance) || DEFAULT_APPEARANCE_ID;
  const siteProfile = stored.siteProfiles?.[site.origin] || {};
  const resolved = resolveAppearance(defaultAppearance, siteProfile.appearance);

  select.replaceChildren(
    new Option(`跟随默认 · ${labelFor(defaultAppearance)}`, ""),
    ...TRANSLATION_APPEARANCES.map((appearance) => new Option(appearance.label, appearance.id))
  );
  select.value = normalizeAppearanceId(siteProfile.appearance) || "";
  select.title = `当前：${resolved.label}（${resolved.source === "site" ? "本站" : "默认"}）`;
  select.addEventListener("change", () => saveSiteAppearance(site.origin, defaultAppearance));
}

async function saveSiteAppearance(origin, defaultAppearance) {
  select.disabled = true;
  try {
    const { siteProfiles = {} } = await chrome.storage.local.get(["siteProfiles"]);
    const current = siteProfiles?.[origin] || {};
    const appearance = normalizeAppearanceId(select.value);
    const nextProfile = { ...current };

    if (appearance) nextProfile.appearance = appearance;
    else delete nextProfile.appearance;

    const nextProfiles = { ...(siteProfiles || {}) };
    if (Object.keys(nextProfile).length) nextProfiles[origin] = nextProfile;
    else delete nextProfiles[origin];

    await chrome.storage.local.set({ siteProfiles: nextProfiles });
    const resolved = resolveAppearance(defaultAppearance, appearance);
    select.title = `当前：${resolved.label}（${resolved.source === "site" ? "本站" : "默认"}）`;
  } finally {
    select.disabled = false;
  }
}

async function getActiveSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error("unsupported page");
  return { origin: normalizeOrigin(tab.url) };
}

function labelFor(id) {
  return TRANSLATION_APPEARANCES.find((item) => item.id === id)?.label || "Standard";
}
