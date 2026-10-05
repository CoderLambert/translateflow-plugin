(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || !app?.modules.uiPrimitives || !app?.modules.contentI18n || app.modules.selectionRecordStatus) return;
  const locale = app.modules.contentI18n;
  let node = null;
  function clear() { locale.unbindTree(node); node?.remove(); node = null; }
  function update(view, handlers = {}) {
    clear();
    const panel = app.modules.uiHost.getShadowRoot().querySelector(".tf-selection-panel");
    if (!panel || panel.hidden || !view) return;
    node = document.createElement("section");
    node.className = "tf-selection-record-status";
    node.dataset.state = view.state;
    const label = document.createElement("div");
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    locale.bindText(label, view.messageKey, view.messageArgs || {});
    node.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";
    const add = (key, action) => {
      const button = app.modules.uiPrimitives.button({ text: locale.t(key), className: "tf-selection-action-quiet" });
      locale.bindText(button, key);
      button.addEventListener("click", (event) => action?.(event));
      actions.appendChild(button);
    };
    if (view.state === "invite") { add("content.reading.enableInCenter", handlers.open); add("content.reading.notNow", handlers.decline); }
    if (view.state === "manual") add("content.reading.saveResult", handlers.save);
    if (view.retryAvailable) add("content.reading.retrySave", handlers.retry);
    if (actions.childElementCount) node.appendChild(actions);
    panel.appendChild(node);
    app.modules.selectionPopover?.reposition();
  }
  app.modules.selectionRecordStatus = Object.freeze({ update, clear });
})();
