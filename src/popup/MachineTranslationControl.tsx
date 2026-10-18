import { useEffect, useMemo, useRef, useState } from "react";
import type { I18n } from "../i18n/index.js";
import { initialMachineSettings, machineErrorText, machineTranslationClient, type MachineSettings } from "../options/machine-translation-client";

export function MachineTranslationControl({ i18n, disabled, onApplied, onTranslate }: {
  i18n: I18n; disabled: boolean; onApplied: () => Promise<unknown>; onTranslate: () => Promise<unknown>;
}) {
  const client = useMemo(() => machineTranslationClient(), []), mounted = useRef(true);
  const [pageUrl, setPageUrl] = useState(""), [selection, setSelection] = useState("inherit"), [applied, setApplied] = useState("inherit");
  const [base, setBase] = useState<MachineSettings>(initialMachineSettings), [busy, setBusy] = useState(false), [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(false);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    void (async () => {
      try {
        const url = await client.activePage(), state = await client.read(url);
        if (cancelled) return;
        setPageUrl(url); setBase(state.selected || state.config);
        const selected = state.siteOverride ? state.selected?.mode === "free-online" ? state.selected.providerId : "legacy" : "inherit";
        setSelection(selected); setApplied(selected); setConsent(state.selected?.mode === "free-online");
        if (state.errorCode) { setError(true); setNotice(machineErrorText({ code: state.errorCode }, i18n)); }
      } catch { if (!cancelled) { setError(true); setNotice(i18n.t("mt.unsupported")); } }
    })();
    return () => { cancelled = true; mounted.current = false; };
  }, [client, i18n]);
  async function apply(translate: boolean) {
    if (busy || disabled || !pageUrl) return; setBusy(true); setError(false); setNotice("");
    try {
      if (selection === "inherit") await client.inherit(pageUrl);
      else await client.save({ ...base, mode: selection === "legacy" ? "legacy" : "free-online",
        providerId: selection === "legacy" ? base.providerId : selection }, consent, "site", pageUrl);
      if (!mounted.current) return;
      setApplied(selection); setNotice(i18n.t("mt.saved")); await onApplied();
      if (translate && mounted.current) await onTranslate();
    } catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
    finally { if (mounted.current) setBusy(false); }
  }
  const free = selection.startsWith("mt-");
  return <details className="secondary-card tf-accordion mt-popup"><summary>{i18n.t("mt.title")}</summary><div className="secondary-content">
    <p className="supporting">{i18n.t("mt.siteHelp")}</p>
    <label htmlFor="mt-site-provider">{i18n.t("mt.provider")}</label><select id="mt-site-provider" className="tf-select" disabled={disabled || busy || !pageUrl} value={selection} onChange={event => { setSelection(event.target.value); setConsent(false); setNotice(""); }}>
      <option value="inherit">{i18n.t("mt.inherit")}</option><option value="legacy">{i18n.t("mt.legacy")}</option>
      <option value="mt-microsoft-web">{i18n.t("mt.microsoft")}</option><option value="mt-tencent-transmart">{i18n.t("mt.tencent")}</option>
    </select>
    {free ? <><p className="supporting">{i18n.t("mt.privacy")}</p><label className="mt-consent"><input type="checkbox" checked={consent} disabled={busy || disabled} onChange={event => setConsent(event.target.checked)} />{i18n.t("mt.consent")}</label></> : null}
    <div className="row"><button id="mt-site-save" className="tf-button tf-button--secondary" disabled={busy || disabled || !pageUrl || (free && !consent)} onClick={() => void apply(false)}>{i18n.t("mt.site")}</button>
      <button id="mt-site-translate" className="tf-button tf-button--primary" disabled={busy || disabled || !pageUrl || (free && !consent)} onClick={() => void apply(true)}>{i18n.t("mt.translate")}</button></div>
    {applied !== selection ? <p className="supporting">{i18n.t("mt.pending")}</p> : null}
    <p role="status" aria-live="polite" className={error ? "status-banner error" : "supporting"}>{notice}</p>
  </div></details>;
}
