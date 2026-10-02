/** @typedef {"auto" | "en" | "zh_CN"} UiLocale */
/** @typedef {"en" | "zh_CN"} Locale */

/** @param {unknown} value @returns {UiLocale} */
export function normalizeUiLocale(value) {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().replaceAll("-", "_").toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "zh_cn") return "zh_CN";
  return "auto";
}

/** Browser locale is only a signal; it never becomes a translation setting.
 * @param {unknown} uiLocale @param {unknown} browserLocale @returns {Locale}
 */
export function resolveLocale(uiLocale, browserLocale) {
  const explicit = normalizeUiLocale(uiLocale);
  if (explicit !== "auto") return explicit;
  if (typeof browserLocale !== "string") return "en";
  try {
    const browser = new Intl.Locale(browserLocale.trim().replaceAll("_", "-"));
    if (browser.language !== "zh") return "en";
    if (browser.script) return browser.script === "Hans" ? "zh_CN" : "en";
    return ["CN", "SG"].includes(browser.region || "") ? "zh_CN" : "en";
  } catch {
    return "en";
  }
}
