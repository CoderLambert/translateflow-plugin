import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { machineMethodLabel, machineServiceLabel, TranslationMethodFields } from "./TranslationMethodFields";
import { LANGUAGE_NAMES } from "../shared/browser-translation.js";
import { useOptionsI18n } from "./LocaleContext";
import { initialMachineSettings, machineErrorText, machineTranslationClient, type MachineSettings, type MachineTestResult, type TranslationPreferences } from "./machine-translation-client";

export function MachineTranslationSection() {
  const i18n = useOptionsI18n(), client = useMemo(() => machineTranslationClient(), []);
  const [draft, setDraft] = useState<MachineSettings>(initialMachineSettings), [saved, setSaved] = useState<MachineSettings | null>(null);
  const [preferences, setPreferences] = useState<TranslationPreferences>({ version: 1, textMethod: "free-online", wordMethod: "free-online" });
  const [savedPreferences, setSavedPreferences] = useState<TranslationPreferences | null>(null);
  const [availability, setAvailability] = useState({ ai: false, browser: false, dictionary: false });
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(false), [result, setResult] = useState<MachineTestResult | null>(null);
  const [health, setHealth] = useState<{ providerId: string; until: number }[]>([]);
  const target = useRef("Simplified Chinese"), request = useRef(""), generation = useRef(0), mounted = useRef(true);
  const load = useCallback(async () => {
    const current = ++generation.current; setReady(false);
    try {
      const state = await client.read(); if (!mounted.current || current !== generation.current) return;
      setPreferences(state.preferences); setSavedPreferences(state.preferences); setAvailability({ dictionary: false, ...state.availability });
      setHealth(state.health || []); setDraft(state.config); setSaved(state.errorCode ? null : state.config); target.current = state.targetLanguage;
      setConsent(state.globalConsent === true); setError(Boolean(state.errorCode));
      setNotice(state.errorCode ? machineErrorText({ code: state.errorCode }, i18n) : ""); setReady(true);
    } catch (error) { if (mounted.current && current === generation.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
  }, [client, i18n]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; if (request.current) void client.cancel(request.current).catch(() => {}); };
  }, [client, load]);
  function change(patch: Partial<MachineSettings>) { if (patch.method) setPreferences(value => ({ ...value, textMethod: patch.method! })); setDraft(value => ({ ...value, ...patch })); setResult(null); setNotice(""); setError(false); if (patch.providerId || patch.routing || patch.method) setConsent(false); }
  async function save() {
    if (busy) return; setBusy(true); setError(false); setNotice("");
    try { const state = await client.save(draft, consent, "global", "", preferences); if (mounted.current) { setSavedPreferences(state.preferences); setPreferences(state.preferences); setSaved(state.config); setDraft(state.config); setNotice(i18n.t("mt.saved")); } }
    catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function test() {
    if (busy) return; setBusy(true); setError(false); setResult(null); setNotice(i18n.t("mt.testing"));
    const id = `mt-check:${crypto.randomUUID()}`; request.current = id;
    try { const value = await client.test(draft, consent, id, target.current); if (mounted.current && request.current === id) { setResult(value); void client.read().then(state => { if (mounted.current) setHealth(state.health || []); }).catch(() => {}); setNotice(i18n.t("mt.tested", { milliseconds: value.elapsedMs })); } }
    catch (error) { if (mounted.current && request.current === id) { setError(true); setNotice(machineErrorText(error, i18n)); void client.read().then(state => { if (mounted.current) setHealth(state.health || []); }).catch(() => {}); } }
    finally { if (request.current === id) request.current = ""; if (mounted.current) setBusy(false); }
  }
  async function cancel() { try { await client.cancel(request.current); } catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } } }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
  const online = preferences.textMethod === "free-online" || preferences.wordMethod === "free-online";
  return <section className="settings-card mt-settings" aria-labelledby="mt-heading" aria-busy={busy}>
    <h2 id="mt-heading">{i18n.t("mt.title")}</h2><p className="section-summary">{i18n.t("mt.scope")}</p>
    {!ready ? <><p role="status">{notice || i18n.t("mt.loading")}</p><button type="button" onClick={() => void load()}>{i18n.t("mt.retry")}</button></> : <>
      {saved ? <p className="mt-current">{i18n.t("mt.current", { method: machineMethodLabel(saved, i18n) })}</p> : null}
      {dirty ? <p className="mt-pending" role="status">{i18n.t("mt.pending")}</p> : null}
      <fieldset className="mt-word-method"><legend>{i18n.t("mt.word")}</legend>
        {(["free-online", "dictionary", "browser-local", "ai"] as const).map(method => <label key={method}><input type="radio" name="word-method" disabled={busy} checked={preferences.wordMethod === method} onChange={() => { setPreferences(value => ({ ...value, wordMethod: method })); setNotice(""); }} />{i18n.t(`mt.method.${method}`)}</label>)}
      </fieldset>
      <p className="mt-current">{i18n.t("mt.savedWord")}：{savedPreferences ? i18n.t(`mt.method.${savedPreferences.wordMethod}`) : "—"}</p>
      <TranslationMethodFields id="mt" online={online} i18n={i18n} draft={draft} disabled={busy} change={change} />
      {online ? <>
        <details className="mt-more"><summary>{i18n.t("mt.more")}</summary>
          <label htmlFor="mt-source">{i18n.t("mt.source")}</label><select id="mt-source" disabled={busy} value={draft.sourceLanguage} onChange={event => change({ sourceLanguage: event.target.value })}>
            <option value="auto">{i18n.t("mt.auto")}</option>{Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </details>
        {error && health.some(p => p.until > Date.now()) ? <details className="mt-diagnostics"><summary>{i18n.t("mt.recovery")}</summary>
          {health.filter(p => p.until > Date.now()).map(p => <p key={p.providerId} className="hint">{i18n.t("mt.cooldown", { service: machineServiceLabel(p.providerId, i18n), seconds: Math.ceil((p.until - Date.now()) / 1000) })}</p>)}
          <button type="button" disabled={busy} onClick={() => change({ routing: "auto" })}>{i18n.t("mt.restoreAuto")}</button>
        </details> : null}
        <p className="hint">{i18n.t("mt.privacy")}</p><label className="checkbox-label"><input id="mt-consent" type="checkbox" disabled={busy} checked={consent} onChange={event => setConsent(event.target.checked)} />{i18n.t("mt.consent")}</label>
      </> : null}
      <p className="hint">{i18n.t("mt.resourceStatus", { ai: i18n.t(availability.ai ? "mt.ready" : "mt.notReady"), browser: i18n.t(availability.browser ? "mt.ready" : "mt.notReady"), dictionary: i18n.t(availability.dictionary ? "mt.ready" : "mt.notReady") })}</p>
      <p className="hint">{i18n.t("mt.independent")}</p>
      <div className="row"><button id="mt-save" className="primary" type="button" disabled={busy || (online && !consent)} onClick={() => void save()}>{i18n.t("mt.save")}</button>
        {online ? <button id="mt-test" type="button" disabled={busy || !consent} onClick={() => void test()}>{i18n.t("mt.test")}</button> : null}
        {busy && request.current ? <button type="button" onClick={() => void cancel()}>{i18n.t("mt.cancel")}</button> : null}
      </div>
      <p className={error ? "status error" : "status"} role="status" aria-live="polite">{notice}</p>
      {result ? <div className="mt-test-result"><small>{machineServiceLabel(result.providerId, i18n)} · {result.sourceLanguage} → {result.targetLanguage}</small><p>{result.sampleText}</p><p>{result.translatedText}</p></div> : null}
    </>}
  </section>;
}
