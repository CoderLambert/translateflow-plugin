export const TEXT_METHODS = Object.freeze(["ai", "browser-local", "free-online"]);
export const WORD_METHODS = Object.freeze(["free-online", "dictionary", "browser-local", "ai"]);

export function preferenceError() {
  return Object.assign(new Error("翻译偏好无效，请重新打开设置。"), { code: "PREFERENCES_CONFIG" });
}
export function normalizeTranslationPreferences(value) {
  if (!value || value.version !== 1 || !TEXT_METHODS.includes(value.textMethod) || !WORD_METHODS.includes(value.wordMethod) ||
      Object.keys(value).some(key => !["version", "textMethod", "wordMethod"].includes(key))) throw preferenceError();
  return { version: 1, textMethod: value.textMethod, wordMethod: value.wordMethod };
}
export function selectedTranslationMethod(stored, site, surface = "page", temporaryMethod = "") {
  const preferences = normalizeTranslationPreferences(stored.translationPreferences);
  const word = surface === "selection-word";
  if (temporaryMethod) {
    if (!(word ? WORD_METHODS : TEXT_METHODS).includes(temporaryMethod)) throw preferenceError();
    return temporaryMethod;
  }
  if (word) return preferences.wordMethod;
  if (site?.textMethod !== undefined && !TEXT_METHODS.includes(site.textMethod)) throw preferenceError();
  return site?.textMethod || preferences.textMethod;
}
