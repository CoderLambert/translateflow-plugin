import { normalizeUiLocale } from "../i18n/index.js";
import type { I18n, UiLocale } from "../i18n/index.js";

export function UiLocaleSection({ i18n, locale, ready, busy, status, save, retry }: {
  i18n: I18n; locale: UiLocale; ready: boolean; busy: boolean;
  status: "" | "settings.saved" | "settings.readError" | "settings.writeError";
  save: (locale: UiLocale) => Promise<void>; retry: () => void;
}) {
  return <section id="uiLocaleControl" aria-busy={busy}>
    <h2>{i18n.t("settings.title")}</h2><label htmlFor="uiLocale">{i18n.t("settings.title")}</label>
    <select id="uiLocale" aria-describedby="uiLocaleStatus" disabled={!ready || busy} value={locale} onChange={event => void save(normalizeUiLocale(event.target.value))}>
      <option value="auto">{i18n.t("settings.auto")}</option><option value="en">{i18n.t("settings.en")}</option><option value="zh_CN">{i18n.t("settings.zh_CN")}</option>
    </select>
    <p className="hint">{i18n.t("settings.help")}</p><p className="hint">{i18n.t("settings.manifestNote")}</p>
    <p id="uiLocaleStatus" role="status" aria-live="polite">{status ? i18n.t(status) : ""}</p>
    <button id="uiLocaleRetry" type="button" hidden={status !== "settings.readError" && status !== "settings.writeError"} disabled={busy} onClick={retry}>{i18n.t("settings.retry")}</button>
  </section>;
}
