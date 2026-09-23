(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || app.modules.uiPrimitives) return;

  function button({ text = "", label = "", icon = false, className = "" } = {}) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = ["tf-ui-button", icon ? "tf-ui-icon-button" : "", className].filter(Boolean).join(" ");
    node.textContent = text;
    if (label) node.setAttribute("aria-label", label);
    return node;
  }

  function surface({ className = "", role = "" } = {}) {
    const node = document.createElement("section");
    node.className = ["tf-ui-surface", className].filter(Boolean).join(" ");
    if (role) node.setAttribute("role", role);
    return node;
  }

  function status({ className = "", live = "polite" } = {}) {
    const node = document.createElement("div");
    node.className = ["tf-ui-status", className].filter(Boolean).join(" ");
    if (live) node.setAttribute("aria-live", live);
    return node;
  }

  function setStatus(node, text, kind = "info") {
    if (!node) return;
    node.textContent = text ?? "";
    node.dataset.kind = kind;
  }

  app.modules.uiPrimitives = { button, surface, status, setStatus };
})();
