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
  const initialRead = useRef<Promise<Record<string, unknown>> | null>(null);
  const pendingWrite = useRef<{ request: number; locale: UiLocale } | null>(null);
  const i18n = useMemo(() => createI18n({ uiLocale: locale, browserLocale }), [browserLocale, locale]);

  useEffect(() => {
    active.current = true;
    const request = ++generation.current; setBusy(true); setStatus("");
    initialRead.current ??= chrome.storage.local.get(["uiLocale"]) as Promise<Record<string, unknown>>;
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
      if (pendingWrite.current?.locale === next) {
        setLocale(next); setReady(true);
        return;
      }
      generation.current += 1; pendingWrite.current = null; setLocale(next);
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
    pendingWrite.current = { request, locale: next };
    setBusy(true); setLocale(next); setStatus("");
    try {
      await chrome.storage.local.set({ uiLocale: next });
      if (active.current && request === generation.current) setStatus("settings.saved");
    } catch {
      if (active.current && request === generation.current) { setLocale(previous); setStatus("settings.writeError"); }
    } finally {
      if (pendingWrite.current?.request === request) pendingWrite.current = null;
      if (active.current && request === generation.current) setBusy(false);
    }
  }, [locale]);

  const retry = useCallback(() => { initialRead.current = null; setAttempt(value => value + 1); }, []);

  return { i18n, locale, ready, busy, status, save, retry };
}
