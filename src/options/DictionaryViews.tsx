import { useRef, useState } from "react";
import { CURATED_DICTIONARIES, CURATED_IMPORTER_TYPES } from "../shared/curated-dictionaries.js";
import { getDictionaryCatalogEntry, getDictionaryCatalogEntryForRecipe } from "../shared/dictionary-catalog-v2.js";
import { getCuratedInstallPresentation, getCuratedMdxInstallPresentation } from "./curated-dictionary-presentation.js";
import type { DictionaryClient, DictionaryRecord, DictionarySnapshot } from "./dictionary-client";
import {
  getCatalogDictionaryRows, getDictionaryHealthPresentation, getLocalRichDictionaryRows
} from "./dictionary-library-v2-presentation.js";
import { installedPackMeta, installedPackName } from "./installed-pack-ui.js";
import { getBundledPackPresentation } from "./pack-ui.js";

type StatusWriter = (message: string, error?: boolean) => void;
const catalogRows = getCatalogDictionaryRows as (entry: DictionaryRecord | null, options?: DictionaryRecord) => DictionaryRecord[];

export function BundledList({ packs }: { packs: DictionaryRecord[] }) {
  if (!packs.length) return <div id="bundledLexiconList" className="site-list dictionary-health-list" aria-live="polite">当前版本没有可用的内置词典信息。</div>;
  return <div id="bundledLexiconList" className="site-list dictionary-health-list" aria-live="polite">{packs.map(pack => {
    const view = getBundledPackPresentation(pack);
    return <div className="site-row dictionary-pack-row" key={String(pack.packId || pack.id)}><div className="site-summary"><div className="dictionary-pack-heading"><strong>{String(pack.label || pack.packId || pack.id)}</strong><HealthBadge view={view} /></div>{view.meta.length ? <div className="dictionary-pack-meta">{view.meta.map((item: string) => <span key={item}>{item}</span>)}</div> : null}{view.detail ? <small className="dictionary-pack-detail">{view.detail}</small> : null}</div></div>;
  })}</div>;
}

export function OfficialList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const declared = client.sources.flatMap((source: DictionaryRecord) => (source.packs || []).map((pack: DictionaryRecord) => ({ source, pack })));
  const [pending, setPending] = useState("");
  if (!declared.length) return <div id="dictionaryPacksList" className="site-list" aria-live="polite">当前没有符合发布条件的官方词典。精选上游和本地导入词典会分别显示在各自栏目中。</div>;
  return <div id="dictionaryPacksList" className="site-list" aria-live="polite">{declared.map(({ source, pack }: { source: DictionaryRecord; pack: DictionaryRecord }) => {
    const id = String(pack.packId || ""), entry = snapshot.packState.packs[id];
    return <div className="site-row" key={id}><div className="site-summary"><strong>{String(pack.label || id)}</strong><small>{entry?.active ? "已安装；可更新、重装或删除。" : "尚未安装；下载只会在主动操作后开始。"}</small></div><div className="site-actions"><button type="button" disabled={pending === id} onClick={event => { if (!event.nativeEvent.isTrusted) return; setPending(id); void client.installOfficial(source, pack).then(() => setStatus(`${String(pack.label || id)} 已完成安装/更新。`)).catch(error => setStatus(errorText(error), true)).finally(async () => { setPending(""); await refresh(); }); }}>{entry?.active ? "更新 / 重装" : "安装"}</button>{entry?.fallback ? <button type="button" onClick={() => void client.rollbackPack(id).then(() => setStatus(`${String(pack.label || id)} 已回滚到上一健康版本。`)).then(refresh).catch(error => setStatus(errorText(error), true))}>回滚</button> : null}</div></div>;
  })}</div>;
}

export function CuratedList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const [active, setActive] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  async function install(source: DictionaryRecord, dictionary: DictionaryRecord | null) {
    if (active) return;
    setActive(source.id); setMessages(current => ({ ...current, [source.id]: "正在准备词典操作…" }));
    try {
      await client.installCurated(source, dictionary, message => setMessages(current => ({ ...current, [source.id]: message })));
      setStatus(`${String(source.label)} 已安装并可离线查词。`);
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      const message = cancelled ? "安装已取消；原有健康版本保持可用。" : errorText(error);
      setMessages(current => ({ ...current, [source.id]: message })); setStatus(message, !cancelled);
    } finally { setActive(""); await refresh(); }
  }
  return <div id="curatedDictionaryList" className="site-list" aria-live="polite">{(CURATED_DICTIONARIES as DictionaryRecord[]).map(source => {
    const mdx = source.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1;
    const dictionary = mdx ? snapshot.rich.find(item => item.id === source.output.packId) || null : null;
    const entry = mdx ? null : snapshot.packState.packs[source.output.packId] || null;
    const presentation = mdx ? getCuratedMdxInstallPresentation(source, dictionary) : getCuratedInstallPresentation(source, entry);
    const catalog = getDictionaryCatalogEntryForRecipe(source.id);
    const installedCatalog = mdx ? dictionary?.catalog : entry?.display?.catalog;
    const installedSize = mdx ? dictionary?.installedBytes : entry?.active?.totalBytes;
    return <div className="site-row dictionary-pack-row" data-recipe-id={source.id} data-pack-id={source.output.packId} data-trust-class={source.trustClass} key={source.id}>
      <div className="site-summary"><div className="dictionary-pack-heading"><strong>{source.label}</strong><HealthBadge view={{ label: presentation.badgeLabel, kind: presentation.kind }} /></div><small>{source.description}</small><Metadata rows={catalogRows(catalog, { installedCatalog, installedSize, ...(mdx ? { entryCount: dictionary?.entryCount || source.mdx.entryCount, resourceCount: dictionary?.resourceCount, resourceBytes: dictionary?.resourceBytes } : {}) })} /><Limitations entry={catalog} /><small className="dictionary-pack-detail" aria-live="polite">{messages[source.id] || presentation.detail}</small></div>
      <div className="site-actions">{active === source.id ? <button type="button" aria-label={`取消${source.label}安装`} onClick={() => void client.cancelCurated()}>取消</button> : presentation.status !== "identity-conflict" ? <><button type="button" aria-label={`${presentation.actionLabel} ${source.label}`} data-action={dictionary || entry ? "reinstall" : "install"} onClick={event => { if (event.nativeEvent.isTrusted) void install(source, dictionary); }}>{presentation.actionLabel}</button>{mdx && dictionary ? <button type="button" aria-label={`删除${source.label}`} onClick={() => void client.uninstallRich(String(source.output.packId)).then(() => setStatus(`${source.label} 已删除。`)).then(refresh).catch(error => setStatus(errorText(error), true))}>删除</button> : null}</> : null}</div>
    </div>;
  })}</div>;
}

export function InstalledPackList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const entries = Object.entries(snapshot.packState.packs).filter(([, entry]) => entry && (entry.active || entry.display || entry.status === "needs-reinstall")).sort((a, b) => installedPackName(a[0], a[1], client.sources).localeCompare(installedPackName(b[0], b[1], client.sources)));
  return <div id="installedDictionaryList" className="site-list" aria-live="polite">{entries.length ? entries.map(([packId, entry], index) => {
    const name = installedPackName(packId, entry, client.sources), health = getDictionaryHealthPresentation(entry.status);
    const catalog = entry.display?.catalog ? getDictionaryCatalogEntry(entry.display.catalog.entryId) : null;
    return <div className="site-row dictionary-pack-row" role="group" data-pack-id={packId} aria-labelledby={`installed-dictionary-${index}`} key={packId}><div className="site-summary"><div className="dictionary-pack-heading"><strong id={`installed-dictionary-${index}`}>{name}</strong><HealthBadge view={health} /></div>{catalog ? <><Metadata rows={catalogRows(catalog, { installedCatalog: entry.display.catalog, installedSize: entry.active?.totalBytes, entryCount: entry.active?.recordCount })} /><Limitations entry={catalog} /></> : <div className="dictionary-pack-meta">{installedPackMeta(entry).map((item: string) => <span key={item}>{item}</span>)}</div>}{health.kind !== "success" ? <small className="dictionary-pack-detail">{health.detail}</small> : null}</div><div className="site-actions"><button type="button" aria-label={`删除${name}`} onClick={() => void client.uninstallPack(packId).then(() => setStatus(`${name} 已删除。`)).then(refresh).catch(error => setStatus(errorText(error), true))}>删除</button></div></div>;
  }) : "暂无额外安装词典。可从上方下载精选上游词典，或从下方导入本地 StarDict / MDict 文件。"}</div>;
}

export function RichList({ client, dictionaries, refresh, setStatus }: {
  client: DictionaryClient; dictionaries: DictionaryRecord[]; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const [busyId, setBusyId] = useState("");
  const [progress, setProgress] = useState<Record<string, string>>({});
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  async function action(id: string, task: () => Promise<unknown>, success: string) {
    setBusyId(id);
    try { await task(); setStatus(success); await refresh(); }
    catch (error) { setStatus(errorText(error), true); }
    finally { setBusyId(""); }
  }
  async function attach(dictionary: DictionaryRecord, files: File[]) {
    if (!files.length) return;
    const id = String(dictionary.id); setBusyId(id); setProgress(current => ({ ...current, [id]: "准备导入 MDD 资源…" }));
    try {
      const result = await client.attachMdd(dictionary, files, message => setProgress(current => ({ ...current, [id]: message })));
      setProgress(current => ({ ...current, [id]: `已附加 ${Number((result as DictionaryRecord).commit?.dictionary?.resourceCount || 0)} 个 MDD 文件。` }));
      setStatus(`${String(dictionary.title || "富文本词典")} 的本地资源已更新。`); await refresh();
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      const message = cancelled ? "已取消，原有资源保留。" : mddError(error);
      setProgress(current => ({ ...current, [id]: message })); setStatus(message, !cancelled);
    } finally { setBusyId(""); const input = inputRefs.current.get(id); if (input) input.value = ""; }
  }
  return <div id="richMdictInstalledList" className="site-list" aria-live="polite">{dictionaries.length ? dictionaries.map((dictionary, index) => {
    const id = String(dictionary.id || ""), title = String(dictionary.title || dictionary.fileName || "Rich MDict"), health = getDictionaryHealthPresentation(dictionary.status);
    const catalog = dictionary.catalog ? getDictionaryCatalogEntry(dictionary.catalog.entryId) : null;
    const installedBytes = Number(dictionary.installedBytes) || Number(dictionary.sourceSize || 0) + Number(dictionary.indexSize || 0) + Number(dictionary.resourceBytes || 0);
    const local = getLocalRichDictionaryRows(dictionary, installedBytes);
    return <div className="site-row dictionary-pack-row" data-dictionary-id={id} data-status={String(dictionary.status || "unknown")} role="group" aria-labelledby={`rich-dictionary-${index}`} key={id}><div className="site-summary"><div className="dictionary-pack-heading"><strong id={`rich-dictionary-${index}`}>{title}</strong><HealthBadge view={health} /></div>{catalog ? <><Metadata rows={catalogRows(catalog, { installedCatalog: dictionary.catalog, installedSize: installedBytes, installedSourceFileName: dictionary.fileName, installedSourceSize: dictionary.sourceSize, entryCount: dictionary.entryCount, resourceCount: dictionary.resourceCount, resourceBytes: dictionary.resourceBytes, includeDownload: false })} /><Limitations entry={catalog} /></> : <><Metadata rows={local.rows} />{local.detail ? <small className="dictionary-pack-detail">{local.detail}</small> : null}</>}{health.kind !== "success" ? <small className="dictionary-pack-detail">{health.detail}</small> : null}</div>
      <div className="site-actions">{dictionary.preferred ? <span className="rich-mdict-personal-preference" data-role="personal-preference" role="status">你的个人首选</span> : <button type="button" data-action="promote-preferred" disabled={busyId === id} aria-label={`${dictionary.enabled === false ? "启用并设为首选" : "设为首选"}：${title}`} onClick={() => void action(id, () => client.promoteRich(id), "已将这本词典设为个人首选；划词时会优先展开。")}>{dictionary.enabled === false ? "启用并设为首选" : "设为首选"}</button>}
        <PreferenceToggle action="enabled" label="在划词结果显示" checked={dictionary.enabled !== false} disabled={busyId === id} change={checked => void action(id, () => client.updateRichPreferences(id, { enabled: checked }), "划词显示偏好已保存。")} />
        <PreferenceToggle action="expanded-by-default" label="默认展开释义（首选自动展开）" checked={dictionary.expandedByDefault === true} disabled={busyId === id} change={checked => void action(id, () => client.updateRichPreferences(id, { expandedByDefault: checked }), "Rich card 展开偏好已保存。")} />
        <button type="button" data-action="move-up" disabled={busyId === id || index === 0} onClick={() => void action(id, () => client.reorderRich(reorder(dictionaries, index, -1)), "富文本词典顺序已保存。")} >上移</button><button type="button" data-action="move-down" disabled={busyId === id || index === dictionaries.length - 1} onClick={() => void action(id, () => client.reorderRich(reorder(dictionaries, index, 1)), "富文本词典顺序已保存。")} >下移</button>
        <input ref={node => { if (node) inputRefs.current.set(id, node); else inputRefs.current.delete(id); }} type="file" multiple accept=".mdd" hidden data-action="attach-mdd-resources" onChange={event => void attach(dictionary, Array.from(event.target.files || []))} /><button type="button" data-action="attach-mdd-resources-button" disabled={busyId === id} aria-label={`为${title}添加或替换 MDD 附件`} onClick={event => { if (event.nativeEvent.isTrusted) inputRefs.current.get(id)?.click(); }}>添加/替换 MDD 资源</button>
        <button type="button" data-action="cancel-mdd-resources" hidden={busyId !== id} onClick={() => void client.cancelMdd()}>取消资源导入</button><small className="dictionary-pack-detail" data-role="mdd-resource-progress" aria-live="polite">{progress[id] || ""}</small>
        <button type="button" data-action="uninstall" disabled={!id || busyId === id} aria-label={`删除${title}`} onClick={() => void action(id, () => client.uninstallRich(id), `${title} 已删除。`)}>删除</button></div></div>;
  }) : "尚未安装富文本 MDict 词典。"}</div>;
}

export function Metadata({ rows }: { rows: DictionaryRecord[] }) {
  return rows.length ? <dl className="dictionary-v2-metadata">{rows.map((row, index) => <div className="dictionary-v2-metadata-item" key={`${String(row.label)}:${index}`}><dt>{String(row.label || "")}</dt><dd>{row.href ? <a href={String(row.href)} target="_blank" rel="noopener">{String(row.value || "")}</a> : String(row.value || "")}</dd></div>)}</dl> : null;
}
function Limitations({ entry }: { entry: DictionaryRecord | null }) {
  const notes = [...(entry?.source?.legalLimitations || []), ...(entry?.knownLimitations || []).map((item: DictionaryRecord) => item.description)].filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 16);
  return notes.length ? <details className="dictionary-v2-limitations"><summary>来源与使用说明</summary><ul>{notes.map(note => <li key={note}>{note}</li>)}</ul></details> : null;
}
function HealthBadge({ view }: { view: DictionaryRecord }) { return <span className="dictionary-health-badge" data-kind={String(view.kind)} aria-label={`词典状态：${String(view.label)}`}>{String(view.label)}</span>; }
function PreferenceToggle({ action, label, checked, disabled, change }: { action: string; label: string; checked: boolean; disabled: boolean; change: (value: boolean) => void }) { return <label className="checkbox-label"><input type="checkbox" data-action={action} checked={checked} disabled={disabled} onChange={event => change(event.target.checked)} />{label}</label>; }
function reorder(items: DictionaryRecord[], index: number, delta: number) { const next = items.map(item => String(item.id)); const [id] = next.splice(index, 1); if (id) next.splice(index + delta, 0, id); return next; }
function mddError(error: unknown) { const code = String((error as { code?: string })?.code || ""); if (code === "RICH_MDD_INPUT") return "MDD 文件名需与已安装 MDX 同名，并按 .1.mdd、.2.mdd 连续编号。"; if (/LIMIT|QUOTA/u.test(code)) return "MDD 文件或本地空间超过当前安全上限，原有附件保留。"; if (/CORRUPT/u.test(code)) return "MDD 文件损坏、附件检查失败或资源类型不受支持，原有附件保留。"; return errorText(error, "MDD 资源导入失败，原有附件保留。"); }
function errorText(error: unknown, fallback = "词典操作失败。") { return error instanceof Error ? error.message : String(error || fallback); }
