import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { I18n } from "../i18n/index.js";
import { initialMachineSettings, machineErrorText, machineTranslationClient, type MachineSettings, type MachineState } from "../options/machine-translation-client";

export function useMachineTranslation(i18n: I18n, enabled: boolean) {
  const client = useMemo(() => machineTranslationClient(), []);
  const [saved, setSaved] = useState<MachineState | null>(null), [draft, setDraft] = useState<MachineSettings>(initialMachineSettings);
  const [inherit, setInherit] = useState(true), [pageUrl, setPageUrl] = useState("");
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState(false);
  const mounted = useRef(false), generation = useRef(0), applying = useRef(false);
  function accept(state: MachineState) {
    setSaved(state); setDraft(state.selected || state.config); setInherit(!state.siteOverride);
    setConsent(state.consent === true);
  }
  const load = useCallback(async () => {
    const current = ++generation.current; setReady(false); setNotice(""); setError(false);
    try {
      const url = await client.activePage(), state = await client.read(url);
      if (!mounted.current || current !== generation.current) return;
      setPageUrl(url); accept(state); setReady(true);
      if (state.errorCode) { setError(true); setNotice(machineErrorText({ code: state.errorCode }, i18n)); }
    } catch (error) { if (mounted.current && current === generation.current) { setError(true); setNotice(machineErrorText(error, i18n)); } }
  }, [client, i18n]);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true; void load();
    return () => { mounted.current = false; generation.current++; };
  }, [enabled, load]);
  const dirty = Boolean(saved && ((inherit ? saved.siteOverride : !saved.siteOverride || JSON.stringify(draft) !== JSON.stringify(saved.selected || saved.config)) || draft.method === "free-online" && consent !== saved.consent));
  function change(patch: Partial<MachineSettings>) {
    setDraft(value => ({ ...value, ...patch })); setInherit(false); setNotice(""); setError(false);
    if (patch.method || patch.routing || patch.providerId) setConsent(false);
  }
  function restore() { if (!saved) return; setInherit(true); setDraft(saved.config); setConsent(saved.globalConsent); setNotice(""); setError(false); }
  async function apply() {
    if (!ready || !saved || applying.current) return false;
    if (!dirty && (draft.method !== "free-online" || saved.consent)) return true;
    applying.current = true; setBusy(true); setNotice(""); setError(false);
    try {
      // Start the permission request in the click handler, before any other await.
      const state = inherit && saved.siteOverride ? await client.inherit(pageUrl, consent) : await client.save(draft, consent, "site", pageUrl);
      if (!mounted.current) return false;
      if (state.errorCode) throw Object.assign(new Error("Invalid saved method"), { code: state.errorCode });
      accept(state); return true;
    } catch (error) { if (mounted.current) { setError(true); setNotice(machineErrorText(error, i18n)); } return false; }
    finally { applying.current = false; if (mounted.current) setBusy(false); }
  }
  return { saved, draft, inherit, ready, busy, consent, setConsent, notice, error, dirty, change, restore, load, apply,
    canTranslate: ready && Boolean(saved) && (!saved?.errorCode || dirty) && (draft.method !== "free-online" || consent) };
}
