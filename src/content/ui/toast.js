(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || app.modules.uiToast) return;

  const { getLayer } = app.modules.uiHost;
  const KIND_ICON = Object.freeze({
    info: "i",
    success: "✓",
    warning: "!",
    error: "!"
  });

  let toast;
  let icon;
  let messageNode;
  let timer;

  function ensureToast() {
    if (toast?.isConnected) return toast;

    toast = document.createElement("div");
    toast.className = "tf-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    icon = document.createElement("span");
    icon.className = "tf-toast-icon";
    icon.setAttribute("aria-hidden", "true");

    messageNode = document.createElement("span");
    messageNode.className = "tf-toast-message";

    toast.append(icon, messageNode);
    getLayer("toast").appendChild(toast);
    return toast;
  }

  function show(message, kind = "info") {
    const node = ensureToast();
    const normalizedKind = KIND_ICON[kind] ? kind : "info";

    node.dataset.kind = normalizedKind;
    node.setAttribute("aria-live", normalizedKind === "error" ? "assertive" : "polite");
    icon.textContent = KIND_ICON[normalizedKind];
    messageNode.textContent = String(message ?? "");
    node.dataset.visible = "true";

    clearTimeout(timer);
    timer = setTimeout(() => {
      if (node?.isConnected) node.dataset.visible = "false";
    }, 3200);
  }

  app.modules.uiToast = { show };
})();
