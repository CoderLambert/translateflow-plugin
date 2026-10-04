import {
  normalizeGlossaryEntry,
  normalizeGlossaryStore,
  normalizeSiteGlossaryStore,
  removeGlossaryEntry,
  upsertGlossaryEntry
} from "../shared/glossary.js";
import { normalizeOrigin } from "../shared/url.js";

export type GlossaryScope = "global" | "site";
export type GlossaryEntry = {
  id: string;
  source: string;
  target: string;
  caseSensitive: boolean;
  enabled: boolean;
};
export type GlossaryRow = {
  scope: GlossaryScope;
  origin: string;
  entry: GlossaryEntry;
};
export type GlossaryDraft = Omit<GlossaryEntry, "id"> & {
  id?: string;
  scope: GlossaryScope;
  origin: string;
  previousScope?: GlossaryScope;
  previousOrigin?: string;
};
type GlobalStore = { version: number; entries: GlossaryEntry[] };
type SiteStore = { version: number; sites: Record<string, GlossaryEntry[]> };

export function glossaryClient(api: typeof chrome = chrome) {
  async function rows(): Promise<GlossaryRow[]> {
    const { globalStore, siteStore } = await readStores();
    return [
      ...globalStore.entries.map((entry: GlossaryEntry) => ({ scope: "global" as const, origin: "", entry })),
      ...Object.entries(siteStore.sites).flatMap(([origin, entries]) =>
        (entries as GlossaryEntry[]).map(entry => ({ scope: "site" as const, origin, entry })))
    ];
  }

  async function save(draft: GlossaryDraft): Promise<GlossaryRow[]> {
    const entry = normalizeGlossaryEntry({
      id: draft.id || crypto.randomUUID(),
      source: draft.source,
      target: draft.target,
      caseSensitive: draft.caseSensitive,
      enabled: draft.enabled
    }) as GlossaryEntry | null;
    if (!entry) throw new Error("来源术语和目标译法不能为空。");
    const { globalStore, siteStore } = await readStores();
    const previousScope = draft.previousScope;
    const previousOrigin = previousScope === "site" ? normalizeOrigin(draft.previousOrigin || draft.origin) : "";

    if (draft.scope === "site") {
      const origin = normalizeOrigin(draft.origin);
      if (previousScope === "global") globalStore.entries = removeGlossaryEntry(globalStore.entries, entry.id);
      if (previousScope === "site" && previousOrigin && previousOrigin !== origin) {
        removeSiteEntry(siteStore, previousOrigin, entry.id);
      }
      siteStore.sites[origin] = upsertGlossaryEntry(siteStore.sites[origin] || [], entry);
    } else {
      if (previousScope === "site" && previousOrigin) removeSiteEntry(siteStore, previousOrigin, entry.id);
      globalStore.entries = upsertGlossaryEntry(globalStore.entries, entry);
    }
    await writeStores(globalStore, siteStore);
    return rows();
  }

  async function setEnabled(row: GlossaryRow, enabled: boolean): Promise<GlossaryRow[]> {
    const { globalStore, siteStore } = await readStores();
    if (row.scope === "global") {
      globalStore.entries = upsertGlossaryEntry(globalStore.entries, { ...row.entry, enabled });
    } else {
      siteStore.sites[row.origin] = upsertGlossaryEntry(siteStore.sites[row.origin] || [], { ...row.entry, enabled });
    }
    await writeStores(globalStore, siteStore);
    return rows();
  }

  async function remove(row: GlossaryRow): Promise<GlossaryRow[]> {
    const { globalStore, siteStore } = await readStores();
    if (row.scope === "global") globalStore.entries = removeGlossaryEntry(globalStore.entries, row.entry.id);
    else removeSiteEntry(siteStore, row.origin, row.entry.id);
    await writeStores(globalStore, siteStore);
    return rows();
  }

  async function readStores() {
    const stored = await api.storage.local.get(["glossary", "siteGlossaries"]);
    return {
      globalStore: normalizeGlossaryStore(stored.glossary) as GlobalStore,
      siteStore: normalizeSiteGlossaryStore(stored.siteGlossaries) as SiteStore
    };
  }

  async function writeStores(globalStore: GlobalStore, siteStore: SiteStore) {
    await api.storage.local.set({ glossary: globalStore, siteGlossaries: siteStore });
  }

  return { rows, save, setEnabled, remove };
}

function removeSiteEntry(siteStore: SiteStore, origin: string, id: string) {
  const entries = removeGlossaryEntry(siteStore.sites[origin] || [], id);
  if (entries.length) siteStore.sites[origin] = entries;
  else delete siteStore.sites[origin];
}

export type GlossaryClient = ReturnType<typeof glossaryClient>;
