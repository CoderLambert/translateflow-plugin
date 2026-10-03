import { useEffect, useRef, useState } from "react";
import type { I18n } from "../../i18n/index.js";
import { ReadingClient } from "../client/reading";
import type { Exclusion } from "../client/reading";
import { siteKey as validateSiteKey } from "../../shared/reading/validation.js";
import { Button, Notice } from "../components/common";
export function Management({ client, i18n, revision, disabled, selectedSite }: { client: ReadingClient; i18n: I18n; revision: number; disabled: boolean; selectedSite: string | null }) {
  const [items, setItems] = useState<Exclusion[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [site, setSite] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(false), [message, setMessage] = useState("");
  const epoch = useRef(0);
  async function load(more = false) {
    const generation = ++epoch.current; setBusy(true); setError(false);
    try {
      const page = await client.exclusions(more ? cursor : null);
      if (epoch.current === generation) { setItems(old => more ? [...old, ...page.items] : page.items); setCursor(page.nextCursor); }
    } catch { if (epoch.current === generation) setError(true); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [client, revision]);
  async function patch(origin: string, excluded: boolean) {
    if (busy || disabled) return;
    let normalized: string;
    try { normalized = validateSiteKey(origin.trim(), "siteKey"); } catch { setMessage(i18n.t("learning.siteInvalid")); return; }
    setBusy(true); setMessage("");
    try {
      const current = await client.site(normalized);
      await client.setSite(normalized, excluded, current.sitePolicyRevision);
      setMessage(i18n.t(excluded ? "learning.excluded" : "learning.siteSaved"));
      await load();
    } catch { setMessage(i18n.t("learning.actionError")); }
    finally { setBusy(false); }
  }
  return <details className="management"><summary>{i18n.t("learning.exclusions")}</summary>
    <form onSubmit={event => { event.preventDefault(); void patch(site, true); }}>
      <label htmlFor="site-origin">{i18n.t("learning.site")}</label>
      <div className="actions"><input id="site-origin" value={site} onChange={event => setSite(event.target.value)} type="url" required />
        <button disabled={disabled || busy}>{i18n.t("learning.exclude")}</button></div>
    </form>
    {selectedSite && <Button disabled={disabled || busy} onClick={() => void patch(selectedSite, true)}>{i18n.t("learning.exclude")} · {selectedSite}</Button>}
    {message && <Notice>{message}</Notice>}
    {error ? <><Notice error>{i18n.t("learning.loadError")}</Notice><Button onClick={() => void load()}>{i18n.t("learning.retry")}</Button></>
      : !items.length && !busy ? <p>{i18n.t("learning.noExclusions")}</p> : null}
    <ul>{items.map(item => <li key={item.siteKey}><span>{item.siteKey}</span> <Button disabled={disabled || busy} onClick={() => void patch(item.siteKey, false)}>{i18n.t("learning.restoreSite")}</Button></li>)}</ul>
    {cursor && <Button disabled={disabled || busy} onClick={() => void load(true)}>{i18n.t("learning.more")}</Button>}
  </details>;
}
