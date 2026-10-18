import { browserLanguage } from "./browser-translation.js";
export const NATIVE_PORT = "tf-browser-native-v1";
export const NATIVE_PENDING_KEY = "tfBrowserNativePreparationV1";
export const NATIVE_ACTIONS = Object.freeze(["capability", "detectDecision", "detectSelection", "prepare", "execute"]);
export function nativePair(value) {
  const sourceLanguage = browserLanguage(value?.sourceLanguage), targetLanguage = browserLanguage(value?.targetLanguage);
  if (!sourceLanguage || !targetLanguage) throw new Error("BROWSER_LANGUAGE");
  return { sourceLanguage, targetLanguage };
}
export function nativeRequest(action, value = {}) {
  if (!NATIVE_ACTIONS.includes(action)) throw new Error("BROWSER_PROTOCOL");
  if (action === "detectDecision" || action === "detectSelection") {
    if (typeof value.text !== "string" || value.text.length > 4000 || (value.context !== undefined && (typeof value.context !== "string" || value.context.length > 4000))) throw new Error("BROWSER_PROTOCOL");
    return { text: value.text, ...(action === "detectSelection" ? { context: value.context || "" } : {}), cacheOnly: value.cacheOnly === true };
  }
  const pair = nativePair(value.pair);
  if (action !== "execute") {
    if (value.verifyText !== undefined && (typeof value.verifyText !== "string" || value.verifyText.length > 160)) throw new Error("BROWSER_PROTOCOL");
    return { pair, ...(action === "prepare" ? { verifyText: value.verifyText || "" } : {}) };
  }
  if (!Array.isArray(value.segments) || value.segments.length !== 1) throw new Error("BROWSER_PROTOCOL");
  const segment = value.segments[0];
  if (typeof segment?.id !== "string" || segment.id.length > 128 || typeof segment.text !== "string" || !/^(?=[\s\S]*\p{L})[\p{L}\p{M}\p{N}.'’_+\-#]{1,160}$/u.test(segment.text)) throw new Error("BROWSER_SCOPE");
  return { pair, segments: [{ id: segment.id, text: segment.text }] };
}
export function nativeErrorCode(cause) {
  const code = cause?.code || cause?.message;
  return typeof code === "string" && /^(?:BROWSER_[A-Z_]+|CANCELLED|CONFIG_SNAPSHOT_EXPIRED)$/.test(code) ? code : "BROWSER_UNAVAILABLE";
}
