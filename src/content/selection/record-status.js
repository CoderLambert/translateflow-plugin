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
    label.className = "tf-selection-record-message";
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    locale.bindText(label, view.messageKey, view.messageArgs || {});
    node.appendChild(label);
    if (view.state === "saved") {
      const markerStatus = document.createElement("div");
      markerStatus.className = "tf-selection-record-marker";
      markerStatus.setAttribute("role", "status");
      const key = ({ enabled: "content.reading.siteMarkersOn", disabled: "content.reading.siteMarkersOff",
        "permission-required": "content.reading.siteMarkersPermission", unknown: "content.reading.siteMarkersUnknown" })[view.siteMarkerStatus] || "content.reading.siteMarkersUnknown";
      locale.bindText(markerStatus, key);
      node.appendChild(markerStatus);
    }
    const actions = document.createElement("div");
    actions.className = "tf-selection-actions tf-selection-record-actions";
    const add = (key, action) => {
      const button = app.modules.uiPrimitives.button({ text: locale.t(key), className: "tf-selection-action-quiet" });
      locale.bindText(button, key);
      button.addEventListener("click", (event) => action?.(event));
      actions.appendChild(button);
    };
    if (view.state === "invite") { add("content.reading.enableInCenter", handlers.open); add("content.reading.notNow", handlers.decline); }
    if (view.state === "manual") add("content.reading.saveResult", handlers.save);
    if (view.retryAvailable) add("content.reading.retrySave", handlers.retry);
    if (view.state === "saved") add("content.reading.openSiteMarkers", handlers.open);
    if (actions.childElementCount) node.appendChild(actions);
    const footer = panel.querySelector(":scope > .tf-selection-footer-actions");
    panel.insertBefore(node, footer || null);
    app.modules.selectionPopover?.reposition();
  }
  app.modules.selectionRecordStatus = Object.freeze({ update, clear });
})();
