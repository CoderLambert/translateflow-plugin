import { useCallback, useEffect, useRef, useState } from "react";
import type { GlossaryClient, GlossaryDraft, GlossaryRow, GlossaryScope } from "./glossary-client";
import { useOptionsI18n } from "./LocaleContext";
import type { I18n } from "../i18n/index.js";

const emptyDraft = (): GlossaryDraft => ({
  scope: "global", origin: "", source: "", target: "", caseSensitive: false, enabled: true
});

export function GlossarySection({ client, setStatus }: {
  client: GlossaryClient;
  setStatus: (message: string, error?: boolean) => void;
}) {
  const i18n = useOptionsI18n();
  const [rows, setRows] = useState<GlossaryRow[]>([]);
  const [draft, setDraft] = useState<GlossaryDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sourceRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError("");
    try {
      const value = await client.rows();
      if (request === generation.current) setRows(value);
    } catch (cause) {
      if (request === generation.current) setError(errorText(cause, i18n.t("options.glossary.readFailed")));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [client, i18n]);

  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]);

  function update<K extends keyof GlossaryDraft>(key: K, value: GlossaryDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  function clearEditor() { setDraft(emptyDraft()); }
  function edit(row: GlossaryRow) {
    setDraft({ ...row.entry, scope: row.scope, origin: row.origin, previousScope: row.scope, previousOrigin: row.origin });
    queueMicrotask(() => sourceRef.current?.focus());
  }
  async function commit() {
    setBusy(true);
    try {
      setRows(await client.save(draft)); clearEditor();
      setStatus(i18n.t("options.glossary.saved"));
    } catch (cause) { setStatus(errorText(cause, i18n.t("common.unknownError")), true); }
    finally { setBusy(false); }
  }
  async function toggle(row: GlossaryRow) {
    setBusy(true);
    try { setRows(await client.setEnabled(row, !row.entry.enabled)); setStatus(i18n.t(row.entry.enabled ? "options.glossary.disabled" : "options.glossary.enabledNotice")); }
    catch (cause) { setStatus(errorText(cause, i18n.t("common.unknownError")), true); }
    finally { setBusy(false); }
  }
  async function remove(row: GlossaryRow) {
    setBusy(true);
    try {
      setRows(await client.remove(row));
      if (draft.id === row.entry.id) clearEditor();
      setStatus(i18n.t("options.glossary.deleted"));
    } catch (cause) { setStatus(errorText(cause, i18n.t("common.unknownError")), true); }
    finally { setBusy(false); }
  }

  return <section id="glossary" tabIndex={-1}>
    <h2>{i18n.t("options.glossary.title")}</h2>
    <p className="hint">{i18n.t("options.glossary.help")}</p>
    <div className="profile-grid">
      <div><label htmlFor="glossaryScope">{i18n.t("options.glossary.scope")}</label><select id="glossaryScope" value={draft.scope} disabled={busy} onChange={event => update("scope", event.target.value as GlossaryScope)}><option value="global">{i18n.t("options.glossary.global")}</option><option value="site">{i18n.t("options.glossary.site")}</option></select></div>
      <div><label htmlFor="glossaryOrigin">{i18n.t("options.glossary.origin")}</label><input id="glossaryOrigin" value={draft.origin} onChange={event => update("origin", event.target.value)} type="text" placeholder="https://github.com" disabled={busy || draft.scope !== "site"} /></div>
    </div>
    <div className="profile-grid">
      <div><label htmlFor="glossarySource">{i18n.t("options.glossary.source")}</label><input ref={sourceRef} id="glossarySource" value={draft.source} onChange={event => update("source", event.target.value)} type="text" placeholder="pull request" disabled={busy} /></div>
      <div><label htmlFor="glossaryTarget">{i18n.t("options.glossary.target")}</label><input id="glossaryTarget" value={draft.target} onChange={event => update("target", event.target.value)} type="text" placeholder="pull request" disabled={busy} /></div>
    </div>
    <div className="inline-checks">
      <label className="checkbox-label"><input id="glossaryCaseSensitive" type="checkbox" checked={draft.caseSensitive} disabled={busy} onChange={event => update("caseSensitive", event.target.checked)} />{i18n.t("options.glossary.caseSensitive")}</label>
      <label className="checkbox-label"><input id="glossaryEnabled" type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => update("enabled", event.target.checked)} />{i18n.t("options.glossary.enabled")}</label>
    </div>
    <div className="actions"><button id="saveGlossaryEntry" className="primary" type="button" disabled={busy} onClick={() => void commit()}>{i18n.t("options.glossary.save")}</button><button id="clearGlossaryEditor" type="button" disabled={busy} onClick={clearEditor}>{i18n.t("options.glossary.clear")}</button></div>
    <div id="glossaryList" className="site-list" aria-busy={loading}>
      {loading ? i18n.t("options.glossary.loading") : error ? <><p role="alert">{error}</p><button type="button" onClick={() => void refresh()}>{i18n.t("common.retry")}</button></> : rows.length ? rows.map(row => <GlossaryRowView key={`${row.scope}:${row.origin}:${row.entry.id}`} row={row} busy={busy} edit={edit} toggle={toggle} remove={remove} i18n={i18n} />) : i18n.t("options.glossary.empty")}
    </div>
    <p className="hint">{i18n.t("options.glossary.helpCache")}</p>
  </section>;
}

function GlossaryRowView({ row, busy, edit, toggle, remove, i18n }: {
  row: GlossaryRow; busy: boolean;
  edit: (row: GlossaryRow) => void;
  toggle: (row: GlossaryRow) => Promise<void>;
  remove: (row: GlossaryRow) => Promise<void>;
  i18n: I18n;
}) {
  return <div className="site-row"><div className="site-summary"><strong>{row.scope === "global" ? i18n.t("options.glossary.global") : row.origin}</strong><small>{row.entry.source} → {row.entry.target} · {i18n.t(row.entry.caseSensitive ? "options.glossary.caseSensitive" : "options.glossary.ignoreCase")} · {i18n.t(row.entry.enabled ? "options.glossary.statusEnabled" : "options.glossary.statusDisabled")}</small></div><div className="site-actions"><button type="button" disabled={busy} onClick={() => edit(row)}>{i18n.t("common.edit")}</button><button type="button" disabled={busy} onClick={() => void toggle(row)}>{i18n.t(row.entry.enabled ? "common.disable" : "common.enable")}</button><button type="button" disabled={busy} onClick={() => void remove(row)}>{i18n.t("common.delete")}</button></div></div>;
}

function errorText(error: unknown, fallback: string) { return error instanceof Error ? error.message : String(error || fallback); }
