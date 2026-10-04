import { useCallback, useEffect, useRef, useState } from "react";
import type { GlossaryClient, GlossaryDraft, GlossaryRow, GlossaryScope } from "./glossary-client";

const emptyDraft = (): GlossaryDraft => ({
  scope: "global", origin: "", source: "", target: "", caseSensitive: false, enabled: true
});

export function GlossarySection({ client, setStatus }: {
  client: GlossaryClient;
  setStatus: (message: string, error?: boolean) => void;
}) {
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
      if (request === generation.current) setError(errorText(cause, "读取术语表失败"));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [client]);

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
      setStatus("术语已保存；相关网页会按新的有效术语配置重新翻译。");
    } catch (cause) { setStatus(errorText(cause), true); }
    finally { setBusy(false); }
  }
  async function toggle(row: GlossaryRow) {
    setBusy(true);
    try { setRows(await client.setEnabled(row, !row.entry.enabled)); setStatus(row.entry.enabled ? "术语已停用。" : "术语已启用。"); }
    catch (cause) { setStatus(errorText(cause), true); }
    finally { setBusy(false); }
  }
  async function remove(row: GlossaryRow) {
    setBusy(true);
    try {
      setRows(await client.remove(row));
      if (draft.id === row.entry.id) clearEditor();
      setStatus("术语已删除。");
    } catch (cause) { setStatus(errorText(cause), true); }
    finally { setBusy(false); }
  }

  return <section id="glossary" tabIndex={-1}>
    <h2>术语表</h2>
    <p className="hint">全局术语应用于所有网页；站点术语仅应用于指定 Origin，并可覆盖同名全局术语。</p>
    <div className="profile-grid">
      <div><label htmlFor="glossaryScope">作用范围</label><select id="glossaryScope" value={draft.scope} disabled={busy} onChange={event => update("scope", event.target.value as GlossaryScope)}><option value="global">全局</option><option value="site">指定站点</option></select></div>
      <div><label htmlFor="glossaryOrigin">站点 Origin</label><input id="glossaryOrigin" value={draft.origin} onChange={event => update("origin", event.target.value)} type="text" placeholder="https://github.com" disabled={busy || draft.scope !== "site"} /></div>
    </div>
    <div className="profile-grid">
      <div><label htmlFor="glossarySource">来源术语</label><input ref={sourceRef} id="glossarySource" value={draft.source} onChange={event => update("source", event.target.value)} type="text" placeholder="pull request" disabled={busy} /></div>
      <div><label htmlFor="glossaryTarget">目标译法</label><input id="glossaryTarget" value={draft.target} onChange={event => update("target", event.target.value)} type="text" placeholder="拉取请求" disabled={busy} /></div>
    </div>
    <div className="inline-checks">
      <label className="checkbox-label"><input id="glossaryCaseSensitive" type="checkbox" checked={draft.caseSensitive} disabled={busy} onChange={event => update("caseSensitive", event.target.checked)} />区分大小写</label>
      <label className="checkbox-label"><input id="glossaryEnabled" type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => update("enabled", event.target.checked)} />启用</label>
    </div>
    <div className="actions"><button id="saveGlossaryEntry" className="primary" type="button" disabled={busy} onClick={() => void commit()}>保存术语</button><button id="clearGlossaryEditor" type="button" disabled={busy} onClick={clearEditor}>清空编辑器</button></div>
    <div id="glossaryList" className="site-list" aria-busy={loading}>
      {loading ? "正在读取术语表…" : error ? <><p role="alert">{error}</p><button type="button" onClick={() => void refresh()}>重试</button></> : rows.length ? rows.map(row => <GlossaryRowView key={`${row.scope}:${row.origin}:${row.entry.id}`} row={row} busy={busy} edit={edit} toggle={toggle} remove={remove} />) : "暂无术语。"}
    </div>
    <p className="hint">修改、停用或删除有效术语会生成新的相关缓存版本；空术语表保持旧缓存兼容。</p>
  </section>;
}

function GlossaryRowView({ row, busy, edit, toggle, remove }: {
  row: GlossaryRow; busy: boolean;
  edit: (row: GlossaryRow) => void;
  toggle: (row: GlossaryRow) => Promise<void>;
  remove: (row: GlossaryRow) => Promise<void>;
}) {
  return <div className="site-row"><div className="site-summary"><strong>{row.scope === "global" ? "全局" : row.origin}</strong><small>{row.entry.source} → {row.entry.target} · {row.entry.caseSensitive ? "区分大小写" : "忽略大小写"} · {row.entry.enabled ? "已启用" : "已停用"}</small></div><div className="site-actions"><button type="button" disabled={busy} onClick={() => edit(row)}>编辑</button><button type="button" disabled={busy} onClick={() => void toggle(row)}>{row.entry.enabled ? "停用" : "启用"}</button><button type="button" disabled={busy} onClick={() => void remove(row)}>删除</button></div></div>;
}

function errorText(error: unknown, fallback = "操作失败") { return error instanceof Error ? error.message : String(error || fallback); }
