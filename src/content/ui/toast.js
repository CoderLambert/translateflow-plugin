(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || app.modules.uiToast) return;

  const { getLayer } = app.modules.uiHost;
  let toast;
  let timer;

  function ensureToast() {
    if (toast?.isConnected) return toast;
    toast = document.createElement("div");
    toast.className = "tf-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    getLayer("toast").appendChild(toast);
    return toast;
  }

  function show(message, kind = "info") {
    const node = ensureToast();
    node.dataset.kind = kind;
    node.textContent = message;
    node.dataset.visible = "true";
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (node?.isConnected) node.dataset.visible = "false";
    }, 3200);
  }

  app.modules.uiToast = { show };
})();
