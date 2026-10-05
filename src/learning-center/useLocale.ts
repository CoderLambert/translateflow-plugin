import { useCallback, useEffect, useRef, useState } from "react";
import { createI18n } from "../i18n/index.js";
import type { I18n } from "../i18n/index.js";
export function useLocale(): { i18n: I18n; ready: boolean; error: boolean; retry: () => void } {
  const [i18n, setI18n] = useState(() => createI18n({ browserLocale: chrome.i18n.getUILanguage() })), [ready, setReady] = useState(false), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  const generation = useRef(0), initialRead = useRef<Promise<Record<string, unknown>> | null>(null);
  useEffect(() => {
    let active = true;
    const apply = (uiLocale: unknown) => {
      if (active) { setI18n(createI18n({ uiLocale, browserLocale: chrome.i18n.getUILanguage() })); setReady(true); setError(false); }
    };
    const current = ++generation.current;
    initialRead.current ??= chrome.storage.local.get("uiLocale") as Promise<Record<string, unknown>>;
    initialRead.current.then(value => { if (current === generation.current) apply(value.uiLocale); }).catch(() => { if (active && current === generation.current) { setReady(false); setError(true); } });
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && Object.hasOwn(changes, "uiLocale")) { generation.current++; apply(changes.uiLocale?.newValue); }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active = false; generation.current++; chrome.storage.onChanged.removeListener(changed); };
  }, [attempt]);
  useEffect(() => { if (ready) { document.documentElement.lang = i18n.locale === "zh_CN" ? "zh-CN" : "en"; document.title = `TranslateFlow · ${i18n.t("learning.title")}`; } }, [i18n, ready]);
  const retry = useCallback(() => { initialRead.current = null; setAttempt(value => value + 1); }, []);
  return { i18n, ready, error, retry };
}
