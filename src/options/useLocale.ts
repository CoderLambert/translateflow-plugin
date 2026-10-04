import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createI18n, normalizeUiLocale } from "../i18n/index.js";
import type { I18n, UiLocale } from "../i18n/index.js";

type LocaleStatus = "" | "settings.saved" | "settings.readError" | "settings.writeError";

export function useLocale(): {
  i18n: I18n; locale: UiLocale; ready: boolean; busy: boolean; status: LocaleStatus;
  save: (locale: UiLocale) => Promise<void>; retry: () => void;
} {
  const browserLocale = chrome.i18n.getUILanguage();
  const [locale, setLocale] = useState<UiLocale>("auto");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LocaleStatus>("");
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false), generation = useRef(0);
  const pendingWrite = useRef<{ locale: UiLocale; generation: number } | null>(null);
  const locallySavedLocale = useRef<UiLocale | null>(null);
  const initialRead = useRef<Promise<Record<string, unknown>> | null>(null);
  const i18n = useMemo(() => createI18n({ uiLocale: locale, browserLocale }), [browserLocale, locale]);

  useEffect(() => {
    active.current = true;
    const request = ++generation.current; setBusy(true); setStatus("");
    initialRead.current ??= chrome.storage.local.get("uiLocale") as Promise<Record<string, unknown>>;
    initialRead.current.then(value => {
      if (!active.current || request !== generation.current) return;
      setLocale(normalizeUiLocale(value.uiLocale)); setReady(true); setStatus("");
    }).catch(() => {
      if (!active.current || request !== generation.current) return;
      setReady(false); setStatus("settings.readError");
    }).finally(() => { if (active.current && request === generation.current) setBusy(false); });
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (!active.current || area !== "local" || !Object.hasOwn(changes, "uiLocale")) return;
      const next = normalizeUiLocale(changes.uiLocale?.newValue);
      setLocale(next);
      // Chrome notifies this page about its own successful write before the
      // Promise returned by storage.local.set settles. Do not invalidate that
      // save's completion or clear its success status. Other pages still
      // consume the change through their independent listener.
      if (pendingWrite.current?.locale === next || locallySavedLocale.current === next) {
        setReady(true);
        return;
      }
      generation.current += 1;
      pendingWrite.current = null;
      locallySavedLocale.current = null;
      setReady(true); setBusy(false); setStatus("");
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active.current = false; generation.current += 1; chrome.storage.onChanged.removeListener(changed); };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = i18n.locale === "zh_CN" ? "zh-CN" : "en";
  }, [i18n, ready]);

  const save = useCallback(async (next: UiLocale) => {
    const previous = locale, request = ++generation.current;
    locallySavedLocale.current = null;
    pendingWrite.current = { locale: next, generation: request };
    setBusy(true); setLocale(next); setStatus("");
    try {
      await chrome.storage.local.set({ uiLocale: next });
      if (active.current && request === generation.current) {
        locallySavedLocale.current = next;
        setStatus("settings.saved");
      }
    } catch {
      if (active.current && request === generation.current) { locallySavedLocale.current = null; setLocale(previous); setStatus("settings.writeError"); }
    } finally {
      if (pendingWrite.current?.generation === request) pendingWrite.current = null;
      if (active.current && request === generation.current) setBusy(false);
    }
  }, [locale]);

  const retry = useCallback(() => { initialRead.current = null; setAttempt(value => value + 1); }, []);

  return { i18n, locale, ready, busy, status, save, retry };
}
