import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createI18n, normalizeUiLocale } from "../i18n/index.js";
import type { I18n, UiLocale } from "../i18n/index.js";

export function useLocale(): { i18n: I18n; ready: boolean; error: boolean; retry: () => void } {
  const browserLocale = chrome.i18n.getUILanguage();
  const [locale, setLocale] = useState<UiLocale>("auto");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const initialRead = useRef<Promise<Record<string, unknown>> | null>(null);
  const i18n = useMemo(() => createI18n({ uiLocale: locale, browserLocale }), [browserLocale, locale]);

  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    setReady(false); setError(false);
    initialRead.current ??= chrome.storage.local.get("uiLocale") as Promise<Record<string, unknown>>;
    initialRead.current.then(value => {
      if (!active || request !== generation.current) return;
      setLocale(normalizeUiLocale(value.uiLocale)); setReady(true);
    }).catch(() => {
      if (!active || request !== generation.current) return;
      setError(true);
    });
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (!active || area !== "local" || !Object.hasOwn(changes, "uiLocale")) return;
      generation.current += 1;
      setLocale(normalizeUiLocale(changes.uiLocale?.newValue)); setReady(true); setError(false);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active = false; generation.current += 1; chrome.storage.onChanged.removeListener(changed); };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = i18n.locale === "zh_CN" ? "zh-CN" : "en";
  }, [i18n, ready]);

  const retry = useCallback(() => { initialRead.current = null; setAttempt(value => value + 1); }, []);
  return { i18n, ready, error, retry };
}
