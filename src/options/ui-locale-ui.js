import { createI18n, normalizeUiLocale } from "../i18n/index.js";

/** Native Options adapter. Reads/writes only uiLocale through the existing page storage boundary. */
export async function initializeUiLocaleUi({ container, storage, changes, browserLocale }) {
  if (!container) throw new TypeError("Missing interface language container");
  container.hidden = true;
  const document = container.ownerDocument;
  const title = document.createElement("h2");
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.id = "uiLocale";
  label.htmlFor = select.id;
  for (const value of ["auto", "en", "zh_CN"]) {
    const option = document.createElement("option");
    option.value = value;
    select.append(option);
  }
  const help = document.createElement("p");
  const note = document.createElement("p");
  const status = document.createElement("p");
  status.id = "uiLocaleStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  select.setAttribute("aria-describedby", "uiLocaleStatus");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.id = "uiLocaleRetry";
  container.replaceChildren(title, label, select, help, note, status, retry);

  let uiLocale = "auto";
  let ready = false;
  let busy = false;
  let disposed = false;
  let changeGeneration = 0;
  let statusKey = "";

  function render() {
    if (disposed) return;
    const i18n = createI18n({ uiLocale, browserLocale });
    container.lang = i18n.locale === "zh_CN" ? "zh-CN" : "en";
    title.textContent = i18n.t("settings.title");
    label.textContent = i18n.t("settings.title");
    for (const option of select.options) option.textContent = i18n.t(`settings.${option.value}`);
    select.value = uiLocale;
    select.disabled = !ready || busy;
    container.setAttribute("aria-busy", String(busy));
    help.textContent = i18n.t("settings.help");
    note.textContent = i18n.t("settings.manifestNote");
    status.textContent = statusKey ? i18n.t(statusKey) : "";
    retry.textContent = i18n.t("settings.retry");
    retry.hidden = statusKey !== "settings.readError" && statusKey !== "settings.writeError";
    retry.disabled = busy;
    container.hidden = false;
  }

  async function load() {
    const generation = changeGeneration;
    busy = true;
    try {
      const stored = await storage.get(["uiLocale"]);
      if (disposed) return;
      // A delivered change wins over an older pending get response.
      if (generation === changeGeneration) uiLocale = normalizeUiLocale(stored?.uiLocale);
      ready = true;
      statusKey = "";
    } catch {
      if (disposed) return;
      if (generation === changeGeneration) {
        ready = false;
        statusKey = "settings.readError";
      }
    } finally {
      busy = false;
      render();
    }
  }

  async function save() {
    const generation = changeGeneration;
    const next = normalizeUiLocale(select.value);
    busy = true;
    render();
    try {
      await storage.set({ uiLocale: next });
      if (disposed) return;
      // Native storage change listeners publish the committed value to all pages.
      // Injected storage implementations without an event still update this page.
      if (changeGeneration === generation) uiLocale = next;
      statusKey = "settings.saved";
    } catch {
      if (disposed) return;
      statusKey = "settings.writeError";
    } finally {
      busy = false;
      render();
    }
  }

  const onSelect = () => { if (ready && !busy) void save(); };
  const onRetry = () => { void load(); };
  const onChanged = (changed, area) => {
    if (area !== "local" || !Object.hasOwn(changed, "uiLocale") || disposed) return;
    changeGeneration += 1;
    uiLocale = normalizeUiLocale(changed.uiLocale.newValue);
    ready = true;
    statusKey = "";
    render();
  };
  select.addEventListener("change", onSelect);
  retry.addEventListener("click", onRetry);
  changes.addListener(onChanged);
  await load();
  return () => {
    disposed = true;
    select.removeEventListener("change", onSelect);
    retry.removeEventListener("click", onRetry);
    changes.removeListener(onChanged);
  };
}
