import { useCallback, useEffect, useRef, useState } from "react";
import { createI18n, normalizeUiLocale } from "../i18n/index.js";
import type { UiLocale } from "../i18n/index.js";

export function UiLocaleSection() {
  const [locale, setLocale] = useState<UiLocale>("auto"), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [statusKey, setStatusKey] = useState<"" | "settings.saved" | "settings.readError" | "settings.writeError">("");
  const active = useRef(false), generation = useRef(0);
  const initialRead = useRef<Promise<Record<string, unknown>> | null>(null);
  const i18n = createI18n({ uiLocale: locale, browserLocale: chrome.i18n.getUILanguage() });
  const load = useCallback(async (retry = false) => {
    const current = ++generation.current; setBusy(true);
    try {
      if (retry) initialRead.current = null;
      initialRead.current ??= chrome.storage.local.get(["uiLocale"]) as Promise<Record<string, unknown>>;
      const stored = await initialRead.current;
      if (active.current && current === generation.current) { setLocale(normalizeUiLocale(stored.uiLocale)); setReady(true); setStatusKey(""); }
    }
    catch { if (active.current && current === generation.current) { setReady(false); setStatusKey("settings.readError"); } }
    finally { if (active.current && current === generation.current) setBusy(false); }
  }, []);
  useEffect(() => {
    active.current = true; void load();
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local" || !Object.hasOwn(changes, "uiLocale") || !active.current) return;
      generation.current += 1; setLocale(normalizeUiLocale(changes.uiLocale?.newValue)); setReady(true); setStatusKey(""); setBusy(false);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active.current = false; generation.current += 1; chrome.storage.onChanged.removeListener(changed); };
  }, [load]);
  async function save(next: UiLocale) {
    const previous = locale, current = ++generation.current; setBusy(true); setLocale(next); setStatusKey("");
    try { await chrome.storage.local.set({ uiLocale: next }); if (active.current) setStatusKey("settings.saved"); }
    catch { if (active.current && current === generation.current) { setLocale(previous); setStatusKey("settings.writeError"); } }
    finally { if (active.current) setBusy(false); }
  }
  return <section id="uiLocaleControl" hidden={!ready && !statusKey} lang={i18n.locale === "zh_CN" ? "zh-CN" : "en"} aria-busy={busy}>
    <h2>{i18n.t("settings.title")}</h2><label htmlFor="uiLocale">{i18n.t("settings.title")}</label>
    <select id="uiLocale" aria-describedby="uiLocaleStatus" disabled={!ready || busy} value={locale} onChange={event => void save(normalizeUiLocale(event.target.value))}>
      <option value="auto">{i18n.t("settings.auto")}</option><option value="en">{i18n.t("settings.en")}</option><option value="zh_CN">{i18n.t("settings.zh_CN")}</option>
    </select>
    <p className="hint">{i18n.t("settings.help")}</p><p className="hint">{i18n.t("settings.manifestNote")}</p>
    <p id="uiLocaleStatus" role="status" aria-live="polite">{statusKey ? i18n.t(statusKey) : ""}</p>
    <button id="uiLocaleRetry" type="button" hidden={statusKey !== "settings.readError" && statusKey !== "settings.writeError"} disabled={busy} onClick={() => void load(true)}>{i18n.t("settings.retry")}</button>
  </section>;
}
