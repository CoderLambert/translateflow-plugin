(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.quickControlElements) return;
  const { button } = app.modules.uiPrimitives, t = key => app.modules.contentI18n.t(key);
  function action(text, className, handler) {
    const node = button({ text, className });
    node.addEventListener("click", event => handler?.(event));
    return node;
  }
  function field(labelText) {
    const root = document.createElement("label"); root.className = "tf-quick-field";
    const label = document.createElement("span"); label.className = "tf-quick-field-label"; label.textContent = labelText;
    const select = document.createElement("select"); select.className = "tf-ui-select";
    root.append(label, select); return { root, select };
  }
  function option(value, label) {
    const node = document.createElement("option"); node.value = String(value); node.textContent = String(label); return node;
  }
  function textEntry(handler) {
    const node = button({ className: "tf-quick-text-entry", label: t("input.title") });
    const mark = document.createElement("span"); mark.className = "tf-quick-text-icon"; mark.textContent = "Aa"; mark.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span"); copy.className = "tf-quick-text-copy";
    const title = document.createElement("strong"); title.textContent = t("input.title");
    const hint = document.createElement("small"); hint.textContent = t("input.quickHint"); copy.append(title, hint);
    const arrow = document.createElement("span"); arrow.textContent = "↗"; arrow.setAttribute("aria-hidden", "true");
    node.append(mark, copy, arrow);
    node.addEventListener("click", async event => {
      if (!event.isTrusted || node.disabled) return;
      node.disabled = true; try { await handler?.(event); } finally { node.disabled = false; }
    });
    return node;
  }
  app.modules.quickControlElements = { action, field, option, textEntry };
})();
