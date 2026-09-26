import {
  normalizeGlossaryEntry,
  normalizeGlossaryStore,
  normalizeSiteGlossaryStore,
  removeGlossaryEntry,
  upsertGlossaryEntry
} from "../shared/glossary.js";
import { normalizeOrigin } from "../shared/url.js";

export async function initializeGlossaryUi({ setStatus }) {
  const $ = (id) => document.getElementById(id);
  const scope = $("glossaryScope");
  const origin = $("glossaryOrigin");
  const source = $("glossarySource");
  const target = $("glossaryTarget");
  const caseSensitive = $("glossaryCaseSensitive");
  const enabled = $("glossaryEnabled");
  const save = $("saveGlossaryEntry");
  const clear = $("clearGlossaryEditor");
  const list = $("glossaryList");

  if (!scope || !origin || !source || !target || !caseSensitive || !enabled || !save || !clear || !list) {
    return;
  }

  let editing = null;

  scope.addEventListener("change", syncScope);
  clear.addEventListener("click", clearEditor);
  save.addEventListener("click", saveEntry);

  syncScope();
  await refresh();

  async function saveEntry() {
    save.disabled = true;
    try {
      const entry = normalizeGlossaryEntry({
        id: editing?.id || crypto.randomUUID(),
        source: source.value,
        target: target.value,
        caseSensitive: caseSensitive.checked,
        enabled: enabled.checked
      });
      if (!entry) throw new Error("来源术语和目标译法不能为空。");

      const stored = await chrome.storage.local.get(["glossary", "siteGlossaries"]);
      const globalStore = normalizeGlossaryStore(stored.glossary);
      const siteStore = normalizeSiteGlossaryStore(stored.siteGlossaries);

      if (scope.value === "site") {
        const siteOrigin = normalizeOrigin(origin.value);
        const previousOrigin = editing?.scope === "site" ? editing.origin : "";

        if (previousOrigin && previousOrigin !== siteOrigin) {
          const previous = siteStore.sites[previousOrigin] || [];
          const cleaned = removeGlossaryEntry(previous, entry.id);
          if (cleaned.length) siteStore.sites[previousOrigin] = cleaned;
          else delete siteStore.sites[previousOrigin];
        }

        siteStore.sites[siteOrigin] = upsertGlossaryEntry(siteStore.sites[siteOrigin] || [], entry);
      } else {
        if (editing?.scope === "site") {
          const previous = siteStore.sites[editing.origin] || [];
          const cleaned = removeGlossaryEntry(previous, entry.id);
          if (cleaned.length) siteStore.sites[editing.origin] = cleaned;
          else delete siteStore.sites[editing.origin];
        }
        globalStore.entries = upsertGlossaryEntry(globalStore.entries, entry);
      }

      if (editing?.scope === "global" && scope.value === "site") {
        globalStore.entries = removeGlossaryEntry(globalStore.entries, entry.id);
      }

      await chrome.storage.local.set({
        glossary: globalStore,
        siteGlossaries: siteStore
      });

      clearEditor();
      await refresh();
      setStatus("术语已保存；相关网页会按新的有效术语配置重新翻译。");
    } catch (error) {
      setStatus(error?.message || String(error), true);
    } finally {
      save.disabled = false;
    }
  }

  async function refresh() {
    list.textContent = "正在读取术语表…";

    try {
      const stored = await chrome.storage.local.get(["glossary", "siteGlossaries"]);
      const globalStore = normalizeGlossaryStore(stored.glossary);
      const siteStore = normalizeSiteGlossaryStore(stored.siteGlossaries);
      const rows = [
        ...globalStore.entries.map((entry) => ({ scope: "global", origin: "", entry })),
        ...Object.entries(siteStore.sites).flatMap(([siteOrigin, entries]) => (
          entries.map((entry) => ({ scope: "site", origin: siteOrigin, entry }))
        ))
      ];

      list.replaceChildren();
      if (!rows.length) {
        list.textContent = "暂无术语。";
        return;
      }

      for (const item of rows) list.appendChild(createRow(item));
    } catch (error) {
      list.textContent = `读取术语表失败：${error?.message || error}`;
    }
  }

  function createRow(item) {
    const row = document.createElement("div");
    row.className = "site-row";

    const summary = document.createElement("div");
    summary.className = "site-summary";

    const title = document.createElement("strong");
    title.textContent = item.scope === "global" ? "全局" : item.origin;

    const detail = document.createElement("small");
    detail.textContent = [
      `${item.entry.source} → ${item.entry.target}`,
      item.entry.caseSensitive ? "区分大小写" : "忽略大小写",
      item.entry.enabled ? "已启用" : "已停用"
    ].join(" · ");

    summary.append(title, detail);

    const actions = document.createElement("div");
    actions.className = "site-actions";
    actions.append(
      actionButton("编辑", () => editEntry(item)),
      actionButton(item.entry.enabled ? "停用" : "启用", () => toggleEntry(item)),
      actionButton("删除", () => deleteEntry(item))
    );

    row.append(summary, actions);
    return row;
  }

  function editEntry(item) {
    editing = {
      id: item.entry.id,
      scope: item.scope,
      origin: item.origin
    };
    scope.value = item.scope;
    origin.value = item.origin;
    source.value = item.entry.source;
    target.value = item.entry.target;
    caseSensitive.checked = Boolean(item.entry.caseSensitive);
    enabled.checked = item.entry.enabled !== false;
    syncScope();
    source.focus();
  }

  async function toggleEntry(item) {
    await mutateItem(item, (entry) => ({ ...entry, enabled: !entry.enabled }));
    setStatus(item.entry.enabled ? "术语已停用。" : "术语已启用。");
  }

  async function deleteEntry(item) {
    await mutateItem(item, null);
    if (editing?.id === item.entry.id) clearEditor();
    setStatus("术语已删除。");
  }

  async function mutateItem(item, mutate) {
    const stored = await chrome.storage.local.get(["glossary", "siteGlossaries"]);
    const globalStore = normalizeGlossaryStore(stored.glossary);
    const siteStore = normalizeSiteGlossaryStore(stored.siteGlossaries);

    if (item.scope === "global") {
      globalStore.entries = mutate
        ? upsertGlossaryEntry(globalStore.entries, mutate(item.entry))
        : removeGlossaryEntry(globalStore.entries, item.entry.id);
    } else {
      const current = siteStore.sites[item.origin] || [];
      const next = mutate
        ? upsertGlossaryEntry(current, mutate(item.entry))
        : removeGlossaryEntry(current, item.entry.id);
      if (next.length) siteStore.sites[item.origin] = next;
      else delete siteStore.sites[item.origin];
    }

    await chrome.storage.local.set({
      glossary: globalStore,
      siteGlossaries: siteStore
    });
    await refresh();
  }

  function actionButton(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      Promise.resolve(handler()).catch((error) => {
        setStatus(error?.message || String(error), true);
      });
    });
    return button;
  }

  function syncScope() {
    origin.disabled = scope.value !== "site";
  }

  function clearEditor() {
    editing = null;
    scope.value = "global";
    origin.value = "";
    source.value = "";
    target.value = "";
    caseSensitive.checked = false;
    enabled.checked = true;
    syncScope();
  }
}
