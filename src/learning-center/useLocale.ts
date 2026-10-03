import { useEffect, useState } from "react";
import { createI18n } from "../i18n/index.js";
import type { I18n } from "../i18n/index.js";
export function useLocale(): { i18n: I18n; ready: boolean; error: boolean; retry: () => void } {
  const [i18n, setI18n] = useState(() => createI18n()), [ready, setReady] = useState(false), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, generation = 0;
    const apply = (uiLocale: unknown) => {
      if (active) { setI18n(createI18n({ uiLocale, browserLocale: chrome.i18n.getUILanguage() })); setReady(true); setError(false); }
    };
    const current = generation;
    chrome.storage.local.get("uiLocale").then(value => { if (current === generation) apply(value.uiLocale); }).catch(() => { if (active) setError(true); });
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes.uiLocale) { generation++; apply(changes.uiLocale.newValue); }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, [attempt]);
  useEffect(() => { document.documentElement.lang = i18n.locale === "zh_CN" ? "zh-CN" : "en"; document.title = `TranslateFlow · ${i18n.t("learning.title")}`; }, [i18n]);
  return { i18n, ready, error, retry: () => setAttempt(value => value + 1) };
}
