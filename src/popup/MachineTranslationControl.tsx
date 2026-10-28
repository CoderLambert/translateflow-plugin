import type { I18n } from "../i18n/index.js";
import { machineMethodLabel, TranslationMethodFields } from "../options/TranslationMethodFields";
import type { useMachineTranslation } from "./useMachineTranslation";

export function MachineTranslationControl({ i18n, disabled, method }: {
  i18n: I18n; disabled: boolean; method: ReturnType<typeof useMachineTranslation>;
}) {
  const saved = method.saved?.selected || method.saved?.config;
  return <section className="secondary-card mt-popup" aria-labelledby="mt-site-title" aria-busy={!method.ready && !method.error || method.busy}>
    <div className="method-heading">
      <h2 id="mt-site-title">{i18n.t("mt.title")}</h2>
      {saved ? <span className={`method-scope${method.dirty ? " is-pending mt-pending" : ""}`} role="status" title={i18n.t("mt.current", { method: machineMethodLabel(saved, i18n) })}>
        {i18n.t(method.dirty ? "mt.pending" : method.saved?.siteOverride ? "popup.siteOnly" : "mt.inherit")}
      </span> : null}
    </div>
    <p className="supporting method-help">{i18n.t("popup.methodScope")}</p>
    {method.ready ? <>
      {method.inherit && method.dirty ? <div className="method-restore"><p className="supporting">{i18n.t("mt.restorePending")}</p><button type="button" className="mt-link" disabled={disabled} onClick={() => method.change({})}>{i18n.t("mt.editSite")}</button></div> : <TranslationMethodFields id="mt-site" i18n={i18n} draft={method.draft} disabled={disabled} change={method.change} />}
      {method.draft.method === "free-online" ? <div className="method-consent"><p className="supporting">{i18n.t("mt.privacy")}</p><label className="mt-consent"><input type="checkbox" checked={method.consent} disabled={disabled} onChange={event => method.setConsent(event.target.checked)} />{i18n.t("mt.consent")}</label></div> : null}
      {method.saved?.consent && !method.consent ? <button type="button" className="mt-link" disabled={disabled} onClick={() => void method.withdraw()}>{i18n.t("mt.withdraw")}</button> : null}
      {method.saved?.siteOverride || !method.inherit ? <button type="button" className="mt-link" disabled={disabled} onClick={method.restore}>{i18n.t("mt.inherit")}</button> : null}
    </> : method.error ? <button type="button" className="tf-button tf-button--secondary" disabled={method.busy} onClick={() => void method.load()}>{i18n.t("mt.retry")}</button> : <div className="method-loading" aria-hidden="true" />}
    {method.saved?.preferences ? <div className="method-footer"><span>{i18n.t("mt.word")} · {i18n.t(`mt.method.${method.saved.preferences.wordMethod}`)}</span><a href="options.html#general" target="_blank" rel="noreferrer">{i18n.t("mt.globalSettings")}</a></div> : null}
    <p role="status" aria-live="polite" className="supporting">{method.error ? "" : method.notice || (!method.ready ? i18n.t("mt.loading") : "")}</p>
  </section>;
}
