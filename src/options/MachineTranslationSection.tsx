import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_NAMES } from "../shared/browser-translation.js";
import { useOptionsI18n } from "./LocaleContext";
import { initialMachineSettings, machineErrorText, machineTranslationClient, type MachineSettings, type MachineTestResult } from "./machine-translation-client";

export function MachineTranslationSection() {
  const i18n = useOptionsI18n(), client = useMemo(() => machineTranslationClient(), []);
  const [draft, setDraft] = useState<MachineSettings>(initialMachineSettings), [saved, setSaved] = useState<MachineSettings | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(false), [result, setResult] = useState<MachineTestResult | null>(null);
  const target = useRef("Simplified Chinese"), request = useRef(""), generation = useRef(0), mounted = useRef(true);
  const load = useCallback(async () => {
    const current = ++generation.current; setReady(false);
    try {
      const state = await client.read(); if (!mounted.current || current !== generation.current) return;
      setDraft(state.config); setSaved(state.errorCode ? null : state.config); target.current = state.targetLanguage;
      setConsent(state.config.mode === "free-online" && !state.errorCode); setError(Boolean(state.errorCode));
      setNotice(state.errorCode ? machineErrorText({ code: state.errorCode }, i18n) : ""); setReady(true);
    } catch (error) { if (mounted.current && current === generation.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
  }, [client, i18n]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; if (request.current) void client.cancel(request.current).catch(() => {}); };
  }, [client, load]);
  function change(patch: Partial<MachineSettings>) { setDraft(value => ({ ...value, ...patch })); setResult(null); setNotice(""); if (patch.providerId) setConsent(false); }
  async function save() {
    if (busy) return; setBusy(true); setError(false); setNotice("");
    try { const state = await client.save(draft, consent, "global"); if (mounted.current) { setSaved(state.config); setDraft(state.config); setNotice(i18n.t("mt.saved")); } }
    catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function test() {
    if (busy) return; setBusy(true); setError(false); setResult(null); setNotice(i18n.t("mt.testing"));
    const id = `mt-check:${crypto.randomUUID()}`; request.current = id;
    try { const value = await client.test(draft, consent, id, target.current); if (mounted.current && request.current === id) { setResult(value); setNotice(i18n.t("mt.tested", { milliseconds: value.elapsedMs })); } }
    catch (error) { if (mounted.current && request.current === id) { setError(true); setNotice(machineErrorText(error, i18n)); } }
    finally { if (request.current === id) request.current = ""; if (mounted.current) setBusy(false); }
  }
  async function cancel() { try { await client.cancel(request.current); } catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } } }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  return <section className="settings-card mt-settings" aria-labelledby="mt-heading" aria-busy={busy}>
    <h2 id="mt-heading">{i18n.t("mt.title")}</h2><p className="section-summary">{i18n.t("mt.scope")}</p>
    {!ready ? <><p role="status">{notice || i18n.t("mt.loading")}</p><button type="button" onClick={() => void load()}>{i18n.t("mt.retry")}</button></> : <>
      <label htmlFor="mt-mode">{i18n.t("mt.mode")}</label><select id="mt-mode" disabled={busy} value={draft.mode} onChange={event => change({ mode: event.target.value as MachineSettings["mode"] })}>
        <option value="legacy">{i18n.t("mt.legacy")}</option><option value="free-online">{i18n.t("mt.free")}</option>
      </select>
      {draft.mode === "free-online" ? <>
        <label htmlFor="mt-provider">{i18n.t("mt.provider")}</label><select id="mt-provider" disabled={busy} value={draft.providerId} onChange={event => change({ providerId: event.target.value })}>
          <option value="mt-microsoft-web">{i18n.t("mt.microsoft")}</option><option value="mt-tencent-transmart">{i18n.t("mt.tencent")}</option>
        </select>
        <label htmlFor="mt-source">{i18n.t("mt.source")}</label><select id="mt-source" disabled={busy} value={draft.sourceLanguage} onChange={event => change({ sourceLanguage: event.target.value })}>
          <option value="auto">{i18n.t("mt.auto")}</option>{Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <p className="hint">{i18n.t("mt.privacy")}</p><label className="checkbox-label"><input id="mt-consent" type="checkbox" disabled={busy} checked={consent} onChange={event => setConsent(event.target.checked)} />{i18n.t("mt.consent")}</label>
      </> : null}
      <p className="hint">{i18n.t("mt.independent")}</p>
      <div className="row"><button id="mt-save" type="button" disabled={busy || (draft.mode === "free-online" && !consent)} onClick={() => void save()}>{i18n.t("mt.save")}</button>
        {draft.mode === "free-online" ? <button id="mt-test" type="button" disabled={busy || !consent} onClick={() => void test()}>{i18n.t("mt.test")}</button> : null}
        {busy && request.current ? <button type="button" onClick={() => void cancel()}>{i18n.t("mt.cancel")}</button> : null}
      </div>
      {dirty ? <p className="hint">{i18n.t("mt.pending")}</p> : null}
      <p className={error ? "status error" : "status"} role="status" aria-live="polite">{notice}</p>
      {result ? <div className="mt-test-result"><small>{result.sourceLanguage} → {result.targetLanguage}</small><p>{result.sampleText}</p><p>{result.translatedText}</p></div> : null}
    </>}
  </section>;
}
