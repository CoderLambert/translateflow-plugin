(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.selectionRecordStatus) return;
  let node = null;
  function clear() { node?.remove(); node = null; }
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
    label.textContent = view.message;
    node.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "tf-selection-actions";
    const add = (text, action) => {
      const button = app.modules.uiPrimitives.button({ text, className: "tf-selection-action-quiet" });
      button.addEventListener("click", (event) => action?.(event));
      actions.appendChild(button);
    };
    if (view.state === "invite") { add("在学习中心开启阅读记录", handlers.open); add("暂不", handlers.decline); }
    if (view.state === "manual") add("保存本次结果", handlers.save);
    if (view.retryAvailable) add("重试保存", handlers.retry);
    if (actions.childElementCount) node.appendChild(actions);
    panel.appendChild(node);
    app.modules.selectionPopover?.reposition();
  }
  app.modules.selectionRecordStatus = Object.freeze({ update, clear });
})();
