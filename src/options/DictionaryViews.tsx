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
import { useOptionsI18n } from "./LocaleContext";
import type { I18n } from "../i18n/index.js";
import { localizedMessage, renderLocalizedMessage } from "../i18n/messages.js";
import type { LocalizedMessage } from "../i18n/messages.js";

type StatusWriter = (message: string | LocalizedMessage, error?: boolean) => void;
const catalogRows = getCatalogDictionaryRows as (entry: DictionaryRecord | null, options?: DictionaryRecord) => DictionaryRecord[];

export function BundledList({ packs }: { packs: DictionaryRecord[] }) {
  const i18n = useOptionsI18n();
  if (!packs.length) return <div id="bundledLexiconList" className="site-list dictionary-health-list" aria-live="polite">{i18n.t("dictionary.noBundled")}</div>;
  return <div id="bundledLexiconList" className="site-list dictionary-health-list" aria-live="polite">{packs.map(pack => {
    const view = getBundledPackPresentation(pack, i18n);
    return <div className="site-row dictionary-pack-row" key={String(pack.packId || pack.id)}><div className="site-summary"><div className="dictionary-pack-heading"><strong>{String(pack.label || pack.packId || pack.id)}</strong><HealthBadge view={view} /></div>{view.meta.length ? <div className="dictionary-pack-meta">{view.meta.map((item: string) => <span key={item}>{item}</span>)}</div> : null}{view.detail ? <small className="dictionary-pack-detail">{view.detail}</small> : null}</div></div>;
  })}</div>;
}

export function OfficialList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const i18n = useOptionsI18n();
  const declared = client.sources.flatMap((source: DictionaryRecord) => (source.packs || []).map((pack: DictionaryRecord) => ({ source, pack })));
  const [pending, setPending] = useState("");
  if (!declared.length) return <div id="dictionaryPacksList" className="site-list" aria-live="polite">{i18n.t("dictionary.noOfficial")}</div>;
  return <div id="dictionaryPacksList" className="site-list" aria-live="polite">{declared.map(({ source, pack }: { source: DictionaryRecord; pack: DictionaryRecord }) => {
    const id = String(pack.packId || ""), entry = snapshot.packState.packs[id];
    const title = String(pack.label || id);
    return <div className="site-row" key={id}><div className="site-summary"><strong>{title}</strong><small>{i18n.t(entry?.active ? "dictionary.officialInstalled" : "dictionary.officialNotInstalled")}</small></div><div className="site-actions"><button type="button" disabled={pending === id} onClick={event => { if (!event.nativeEvent.isTrusted) return; setPending(id); void client.installOfficial(source, pack).then(() => setStatus(localizedMessage("dictionary.installDone", { title }))).catch(error => setStatus(errorMessage(error, i18n), true)).finally(async () => { setPending(""); await refresh(); }); }}>{i18n.t(entry?.active ? "dictionary.updateReinstall" : "dictionary.install")}</button>{entry?.fallback ? <button type="button" onClick={() => void client.rollbackPack(id).then(() => setStatus(localizedMessage("dictionary.rollbackDone", { title }))).then(refresh).catch(error => setStatus(errorMessage(error, i18n), true))}>{i18n.t("dictionary.rollback")}</button> : null}</div></div>;
  })}</div>;
}

export function CuratedList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const i18n = useOptionsI18n();
  const [active, setActive] = useState("");
  const [messages, setMessages] = useState<Record<string, LocalizedMessage>>({});
  async function install(source: DictionaryRecord, dictionary: DictionaryRecord | null) {
    if (active) return;
    setActive(source.id); setMessages(current => ({ ...current, [source.id]: { key: "dictionary.preparing" } }));
    try {
      await client.installCurated(source, dictionary, message => setMessages(current => ({ ...current, [source.id]: message })));
      setStatus(localizedMessage("dictionary.curatedInstalled", { title: String(source.label) }));
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      const message = cancelled ? { key: "dictionary.installCancelled" as const } : errorMessage(error, i18n);
      setMessages(current => ({ ...current, [source.id]: message })); setStatus(message, !cancelled);
    } finally { setActive(""); await refresh(); }
  }
  return <div id="curatedDictionaryList" className="site-list" aria-live="polite">{(CURATED_DICTIONARIES as DictionaryRecord[]).map(source => {
    const mdx = source.importerType === CURATED_IMPORTER_TYPES.ECDICT_MDX_ZIP_V1;
    const dictionary = mdx ? snapshot.rich.find(item => item.id === source.output.packId) || null : null;
    const entry = mdx ? null : snapshot.packState.packs[source.output.packId] || null;
    const presentation = mdx ? getCuratedMdxInstallPresentation(source, dictionary, i18n) : getCuratedInstallPresentation(source, entry, i18n);
    const catalog = getDictionaryCatalogEntryForRecipe(source.id);
    const installedCatalog = mdx ? dictionary?.catalog : entry?.display?.catalog;
    const installedSize = mdx ? dictionary?.installedBytes : entry?.active?.totalBytes;
    return <div className="site-row dictionary-pack-row" data-recipe-id={source.id} data-pack-id={source.output.packId} data-trust-class={source.trustClass} key={source.id}>
      <div className="site-summary"><div className="dictionary-pack-heading"><strong>{source.label}</strong><HealthBadge view={{ label: presentation.badgeLabel, kind: presentation.kind }} /></div><small>{source.id === "ecdict-en-zh-curated" ? i18n.t("dictionary.curated.sourceDescription.ecdict-en-zh-curated") : i18n.t("dictionary.curatedHelp")}</small><Metadata rows={catalogRows(catalog, { installedCatalog, installedSize, i18n, ...(mdx ? { entryCount: dictionary?.entryCount || source.mdx.entryCount, resourceCount: dictionary?.resourceCount, resourceBytes: dictionary?.resourceBytes } : {}) })} /><Limitations entry={catalog} /><small className="dictionary-pack-detail" aria-live="polite">{messages[source.id] ? renderLocalizedMessage(i18n, messages[source.id]) : presentation.detail}</small></div>
      <div className="site-actions">{active === source.id ? <button type="button" aria-label={i18n.t("dictionary.cancelInstall", { title: String(source.label) })} onClick={() => void client.cancelCurated()}>{i18n.t("common.cancel")}</button> : presentation.status !== "identity-conflict" ? <><button type="button" aria-label={`${presentation.actionLabel} ${source.label}`} data-action={dictionary || entry ? "reinstall" : "install"} onClick={event => { if (event.nativeEvent.isTrusted) void install(source, dictionary); }}>{presentation.actionLabel}</button>{mdx && dictionary ? <button type="button" aria-label={i18n.t("dictionary.deleteNamed", { title: String(source.label) })} onClick={() => void client.uninstallRich(String(source.output.packId)).then(() => setStatus(localizedMessage("dictionary.deleted", { title: String(source.label) }))).then(refresh).catch(error => setStatus(errorMessage(error, i18n), true))}>{i18n.t("common.delete")}</button> : null}</> : null}</div>
    </div>;
  })}</div>;
}

export function InstalledPackList({ client, snapshot, refresh, setStatus }: {
  client: DictionaryClient; snapshot: DictionarySnapshot; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const i18n = useOptionsI18n();
  const entries = Object.entries(snapshot.packState.packs).filter(([, entry]) => entry && (entry.active || entry.display || entry.status === "needs-reinstall")).sort((a, b) => installedPackName(a[0], a[1], client.sources, i18n).localeCompare(installedPackName(b[0], b[1], client.sources, i18n)));
  return <div id="installedDictionaryList" className="site-list" aria-live="polite">{entries.length ? entries.map(([packId, entry], index) => {
    const name = installedPackName(packId, entry, client.sources, i18n), health = getDictionaryHealthPresentation(entry.status, i18n);
    const catalog = entry.display?.catalog ? getDictionaryCatalogEntry(entry.display.catalog.entryId) : null;
    return <div className="site-row dictionary-pack-row" role="group" data-pack-id={packId} aria-labelledby={`installed-dictionary-${index}`} key={packId}><div className="site-summary"><div className="dictionary-pack-heading"><strong id={`installed-dictionary-${index}`}>{name}</strong><HealthBadge view={health} /></div>{catalog ? <><Metadata rows={catalogRows(catalog, { installedCatalog: entry.display.catalog, installedSize: entry.active?.totalBytes, entryCount: entry.active?.recordCount, i18n })} /><Limitations entry={catalog} /></> : <div className="dictionary-pack-meta">{installedPackMeta(entry, i18n).map((item: string) => <span key={item}>{item}</span>)}</div>}{health.kind !== "success" ? <small className="dictionary-pack-detail">{health.detail}</small> : null}</div><div className="site-actions"><button type="button" aria-label={i18n.t("dictionary.deleteNamed", { title: name })} onClick={() => void client.uninstallPack(packId).then(() => setStatus(localizedMessage("dictionary.deleted", { title: name }))).then(refresh).catch(error => setStatus(errorMessage(error, i18n), true))}>{i18n.t("common.delete")}</button></div></div>;
  }) : i18n.t("dictionary.noInstalled")}</div>;
}

export function RichList({ client, dictionaries, refresh, setStatus }: {
  client: DictionaryClient; dictionaries: DictionaryRecord[]; refresh: () => Promise<void>; setStatus: StatusWriter;
}) {
  const i18n = useOptionsI18n();
  const [busyId, setBusyId] = useState("");
  const [progress, setProgress] = useState<Record<string, LocalizedMessage>>({});
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  async function action(id: string, task: () => Promise<unknown>, success: LocalizedMessage) {
    setBusyId(id);
    try { await task(); setStatus(success); await refresh(); }
    catch (error) { setStatus(renderLocalizedMessage(i18n, errorMessage(error, i18n)), true); }
    finally { setBusyId(""); }
  }
  async function attach(dictionary: DictionaryRecord, files: File[]) {
    if (!files.length) return;
    const id = String(dictionary.id); setBusyId(id); setProgress(current => ({ ...current, [id]: localizedMessage("dictionary.mddPreparing") }));
    try {
      const result = await client.attachMdd(dictionary, files, message => setProgress(current => ({ ...current, [id]: message })));
      setProgress(current => ({ ...current, [id]: localizedMessage("dictionary.mddAttached", { count: Number((result as DictionaryRecord).commit?.dictionary?.resourceCount || 0) }) }));
      setStatus(localizedMessage("dictionary.mddUpdated", { title: String(dictionary.title || "Rich MDict") })); await refresh();
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError";
      const message = localizedMessage(cancelled ? "dictionary.mddCancelled" : mddErrorKey(error));
      setProgress(current => ({ ...current, [id]: message })); setStatus(message, !cancelled);
    } finally { setBusyId(""); const input = inputRefs.current.get(id); if (input) input.value = ""; }
  }
  return <div id="richMdictInstalledList" className="site-list" aria-live="polite">{dictionaries.length ? dictionaries.map((dictionary, index) => {
    const id = String(dictionary.id || ""), title = String(dictionary.title || dictionary.fileName || "Rich MDict"), health = getDictionaryHealthPresentation(dictionary.status, i18n);
    const catalog = dictionary.catalog ? getDictionaryCatalogEntry(dictionary.catalog.entryId) : null;
    const installedBytes = Number(dictionary.installedBytes) || Number(dictionary.sourceSize || 0) + Number(dictionary.indexSize || 0) + Number(dictionary.resourceBytes || 0);
    const local = getLocalRichDictionaryRows(dictionary, installedBytes, i18n);
    return <div className="site-row dictionary-pack-row" data-dictionary-id={id} data-status={String(dictionary.status || "unknown")} role="group" aria-labelledby={`rich-dictionary-${index}`} key={id}><div className="site-summary"><div className="dictionary-pack-heading"><strong id={`rich-dictionary-${index}`}>{title}</strong><HealthBadge view={health} /></div>{catalog ? <><Metadata rows={catalogRows(catalog, { installedCatalog: dictionary.catalog, installedSize: installedBytes, installedSourceFileName: dictionary.fileName, installedSourceSize: dictionary.sourceSize, entryCount: dictionary.entryCount, resourceCount: dictionary.resourceCount, resourceBytes: dictionary.resourceBytes, includeDownload: false, i18n })} /><Limitations entry={catalog} /></> : <><Metadata rows={local.rows} />{local.detail ? <small className="dictionary-pack-detail">{local.detail}</small> : null}</>}{health.kind !== "success" ? <small className="dictionary-pack-detail">{health.detail}</small> : null}</div>
      <div className="site-actions">{dictionary.preferred ? <span className="rich-mdict-personal-preference" data-role="personal-preference" role="status">{i18n.t("dictionary.preferred")}</span> : <button type="button" data-action="promote-preferred" disabled={busyId === id} aria-label={i18n.t("dictionary.preferredAria", { action: i18n.t(dictionary.enabled === false ? "dictionary.enablePreferred" : "dictionary.setPreferred"), title })} onClick={() => void action(id, () => client.promoteRich(id), localizedMessage("dictionary.preferredSaved"))}>{i18n.t(dictionary.enabled === false ? "dictionary.enablePreferred" : "dictionary.setPreferred")}</button>}
        <PreferenceToggle action="enabled" label={i18n.t("dictionary.showSelection")} checked={dictionary.enabled !== false} disabled={busyId === id} change={checked => void action(id, () => client.updateRichPreferences(id, { enabled: checked }), localizedMessage("dictionary.visibilitySaved"))} />
        <PreferenceToggle action="expanded-by-default" label={i18n.t("dictionary.expandDefault")} checked={dictionary.expandedByDefault === true} disabled={busyId === id} change={checked => void action(id, () => client.updateRichPreferences(id, { expandedByDefault: checked }), localizedMessage("dictionary.expandSaved"))} />
        <button type="button" data-action="move-up" disabled={busyId === id || index === 0} onClick={() => void action(id, () => client.reorderRich(reorder(dictionaries, index, -1)), localizedMessage("dictionary.orderSaved"))}>{i18n.t("dictionary.moveUp")}</button><button type="button" data-action="move-down" disabled={busyId === id || index === dictionaries.length - 1} onClick={() => void action(id, () => client.reorderRich(reorder(dictionaries, index, 1)), localizedMessage("dictionary.orderSaved"))}>{i18n.t("dictionary.moveDown")}</button>
        <input ref={node => { if (node) inputRefs.current.set(id, node); else inputRefs.current.delete(id); }} type="file" multiple accept=".mdd" hidden data-action="attach-mdd-resources" onChange={event => void attach(dictionary, Array.from(event.target.files || []))} /><button type="button" data-action="attach-mdd-resources-button" disabled={busyId === id} aria-label={i18n.t("dictionary.attachMddAria", { title })} onClick={event => { if (event.nativeEvent.isTrusted) inputRefs.current.get(id)?.click(); }}>{i18n.t("dictionary.attachMdd")}</button>
        <button type="button" data-action="cancel-mdd-resources" hidden={busyId !== id} aria-label={i18n.t("dictionary.cancelMdd")} onClick={() => void client.cancelMdd()}>{i18n.t("dictionary.cancelMdd")}</button><small className="dictionary-pack-detail" data-role="mdd-resource-progress" aria-live="polite">{progress[id] ? renderLocalizedMessage(i18n, progress[id]) : ""}</small>
        <button type="button" data-action="uninstall" disabled={!id || busyId === id} aria-label={i18n.t("dictionary.deleteNamed", { title })} onClick={() => void action(id, () => client.uninstallRich(id), localizedMessage("dictionary.deleted", { title }))}>{i18n.t("common.delete")}</button></div></div>;
  }) : i18n.t("dictionary.noRich")}</div>;
}

export function Metadata({ rows }: { rows: DictionaryRecord[] }) {
  return rows.length ? <dl className="dictionary-v2-metadata">{rows.map((row, index) => <div className="dictionary-v2-metadata-item" key={`${String(row.label)}:${index}`}><dt>{String(row.label || "")}</dt><dd>{row.href ? <a href={String(row.href)} target="_blank" rel="noopener">{String(row.value || "")}</a> : String(row.value || "")}</dd></div>)}</dl> : null;
}
function Limitations({ entry }: { entry: DictionaryRecord | null }) {
  const i18n = useOptionsI18n();
  const translateKey = (key: string) => (i18n.t as (messageKey: string) => string)(key);
  const legalKey = entry?.id === "ecdict-en-zh-curated" ? "dictionary.limitation.legal.ecdictCsv"
    : entry?.id === "ecdict-en-zh-mdx-curated" ? "dictionary.limitation.legal.ecdictMdx" : "";
  const notes = [
    ...(legalKey ? [translateKey(legalKey)] : entry?.source?.legalLimitations || []),
    ...(entry?.knownLimitations || []).map((item: DictionaryRecord) => {
      const key = ({ "content-date-not-published": "dictionary.limitation.content-date-not-published", "curated-subset": "dictionary.limitation.curated-subset", "legacy-content-date": "dictionary.limitation.legacy-content-date", "no-mdd-resources": "dictionary.limitation.no-mdd-resources", "active-content-sanitized": "dictionary.limitation.active-content-sanitized" } as Record<string, string>)[String(item.id || "")];
      return key ? translateKey(key) : item.description;
    })
  ].filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 16);
  return notes.length ? <details className="dictionary-v2-limitations"><summary>{i18n.t("dictionary.limitations")}</summary><ul>{notes.map(note => <li key={note}>{note}</li>)}</ul></details> : null;
}
function HealthBadge({ view }: { view: DictionaryRecord }) { const i18n = useOptionsI18n(); return <span className="dictionary-health-badge" data-kind={String(view.kind)} aria-label={i18n.t("dictionary.healthAria", { status: String(view.label) })}>{String(view.label)}</span>; }
function PreferenceToggle({ action, label, checked, disabled, change }: { action: string; label: string; checked: boolean; disabled: boolean; change: (value: boolean) => void }) { return <label className="checkbox-label"><input type="checkbox" data-action={action} checked={checked} disabled={disabled} onChange={event => change(event.target.checked)} />{label}</label>; }
function reorder(items: DictionaryRecord[], index: number, delta: number) { const next = items.map(item => String(item.id)); const [id] = next.splice(index, 1); if (id) next.splice(index + delta, 0, id); return next; }
function mddErrorKey(error: unknown): "dictionary.mddInputError" | "dictionary.mddLimitError" | "dictionary.mddCorruptError" | "dictionary.mddError" {
  const code = String((error as { code?: string })?.code || "");
  if (code === "RICH_MDD_INPUT") return "dictionary.mddInputError";
  if (/LIMIT|QUOTA/u.test(code)) return "dictionary.mddLimitError";
  if (/CORRUPT|HASH|UNSUPPORTED/u.test(code)) return "dictionary.mddCorruptError";
  return "dictionary.mddError";
}
function errorMessage(error: unknown, _i18n: I18n): LocalizedMessage {
  if (error instanceof Error && error.name === "AbortError") return { key: "dictionary.client.cancelled" };
  const value = error as { code?: string; localized?: LocalizedMessage } | null;
  if (value?.localized) return value.localized;
  const code = String(value?.code || "");
  if (code === "DICTIONARY_READ_FAILED") return { key: "dictionary.client.readFailed" };
  if (code === "DICTIONARY_PERMISSION_DENIED") return { key: "dictionary.client.permissionDenied" };
  if (/BUSY/u.test(code)) return { key: "dictionary.client.busy" };
  if (/QUOTA|LIMIT/u.test(code)) return { key: "dictionary.client.storageLimit" };
  if (/HASH/u.test(code)) return { key: "dictionary.client.hashMismatch" };
  if (/PROVENANCE|REDIRECT/u.test(code)) return { key: "dictionary.client.provenanceMismatch" };
  if (/CORRUPT|INVALID/u.test(code)) return { key: "dictionary.client.integrityFailed" };
  if (/UNSUPPORTED/u.test(code)) return { key: "dictionary.client.formatUnsupported" };
  if (/WORKER/u.test(code)) return { key: "dictionary.client.workerFailed" };
  return { key: "dictionary.client.operationFailed" };
}
