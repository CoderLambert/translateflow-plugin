import type { I18n } from "../i18n/index.js";
import { machineMethodLabel, TranslationMethodFields } from "../options/TranslationMethodFields";
import type { useMachineTranslation } from "./useMachineTranslation";

export function MachineTranslationControl({ i18n, disabled, method }: {
  i18n: I18n; disabled: boolean; method: ReturnType<typeof useMachineTranslation>;
}) {
  const saved = method.saved?.selected || method.saved?.config;
  return <section className="secondary-card mt-popup" aria-labelledby="mt-site-title" aria-busy={!method.ready || method.busy}>
    <h2 id="mt-site-title">{i18n.t("mt.title")}</h2><p className="supporting">{i18n.t("mt.siteHelp")}</p>
    {saved ? <p className="supporting mt-current">{i18n.t("mt.current", { method: machineMethodLabel(saved, i18n) })}{!method.saved?.siteOverride ? ` · ${i18n.t("mt.inherit")}` : ""}</p> : null}
    {method.saved?.preferences ? <p className="supporting">{i18n.t("mt.word")}：{i18n.t(`mt.method.${method.saved.preferences.wordMethod}`)} · <a href="options.html#general" target="_blank" rel="noreferrer">{i18n.t("mt.globalSettings")}</a></p> : null}
    {method.ready ? <>
      {method.dirty ? <p className="mt-pending" role="status">{i18n.t("mt.pending")}{method.inherit ? ` · ${i18n.t("mt.inherit")}` : ""}</p> : null}
      {method.inherit && method.dirty ? <><p className="supporting">{i18n.t("mt.restorePending")}</p><button type="button" className="mt-link" disabled={disabled} onClick={() => method.change({})}>{i18n.t("mt.editSite")}</button></> : <TranslationMethodFields id="mt-site" i18n={i18n} draft={method.draft} disabled={disabled} change={method.change} />}
      {method.draft.method === "free-online" ? <><p className="supporting">{i18n.t("mt.privacy")}</p><label className="mt-consent"><input type="checkbox" checked={method.consent} disabled={disabled} onChange={event => method.setConsent(event.target.checked)} />{i18n.t("mt.consent")}</label></> : null}
      {method.saved?.consent && !method.consent ? <button type="button" className="mt-link" disabled={disabled} onClick={() => void method.withdraw()}>{i18n.t("mt.withdraw")}</button> : null}
      {method.saved?.siteOverride || !method.inherit ? <button type="button" className="mt-link" disabled={disabled} onClick={method.restore}>{i18n.t("mt.inherit")}</button> : null}
    </> : <button type="button" disabled={method.busy} onClick={() => void method.load()}>{i18n.t("mt.retry")}</button>}
    <p role="status" aria-live="polite" className={method.error ? "status-banner error" : "supporting"}>{method.notice || (!method.ready && !method.error ? i18n.t("mt.loading") : "")}</p>
  </section>;
}
