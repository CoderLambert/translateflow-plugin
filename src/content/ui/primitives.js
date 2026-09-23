(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.uiHost || app.modules.uiPrimitives) return;

  function button({ text = "", label = "", icon = false, className = "" } = {}) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = classes("tf-ui-button", icon && "tf-ui-icon-button", className);
    node.textContent = text;
    if (label) node.setAttribute("aria-label", label);
    return node;
  }

  function surface({ className = "", role = "" } = {}) {
    const node = document.createElement("section");
    node.className = classes("tf-ui-surface", className);
    if (role) node.setAttribute("role", role);
    return node;
  }

  function select({ label = "", value = "", options = [], className = "" } = {}) {
    const node = document.createElement("select");
    node.className = classes("tf-ui-select", className);
    if (label) node.setAttribute("aria-label", label);

    for (const raw of options) {
      const option = document.createElement("option");
      const entry = typeof raw === "object" && raw !== null
        ? raw
        : { value: raw, label: raw };
      option.value = String(entry.value ?? "");
      option.textContent = String(entry.label ?? entry.value ?? "");
      option.disabled = Boolean(entry.disabled);
      if (String(value) === option.value) option.selected = true;
      node.appendChild(option);
    }
    return node;
  }

  function menu({ className = "", label = "" } = {}) {
    const node = document.createElement("div");
    node.className = classes("tf-ui-menu", className);
    node.setAttribute("role", "menu");
    if (label) node.setAttribute("aria-label", label);
    return node;
  }

  function status({ className = "", live = "polite" } = {}) {
    const node = document.createElement("div");
    node.className = classes("tf-ui-status", className);
    if (live) node.setAttribute("aria-live", live);
    return node;
  }

  function setStatus(node, text, kind = "info") {
    if (!node) return;
    node.textContent = text ?? "";
    node.dataset.kind = kind;
  }

  function badge({ text = "", kind = "neutral", className = "" } = {}) {
    const node = document.createElement("span");
    node.className = classes("tf-ui-badge", className);
    node.dataset.kind = kind;
    node.textContent = text;
    return node;
  }

  function progress({ value = 0, max = 1, label = "", className = "" } = {}) {
    const node = document.createElement("div");
    node.className = classes("tf-ui-progress", className);
    node.setAttribute("role", "progressbar");
    if (label) node.setAttribute("aria-label", label);
    const bar = document.createElement("div");
    bar.className = "tf-ui-progress-bar";
    node.appendChild(bar);
    setProgress(node, value, max);
    return node;
  }

  function setProgress(node, value, max = 1) {
    if (!node) return;
    const safeMax = Math.max(1, Number(max) || 1);
    const safeValue = Math.min(safeMax, Math.max(0, Number(value) || 0));
    const ratio = safeValue / safeMax;
    node.setAttribute("aria-valuemin", "0");
    node.setAttribute("aria-valuemax", String(safeMax));
    node.setAttribute("aria-valuenow", String(safeValue));
    node.dataset.state = ratio >= 1 ? "complete" : "active";
    const bar = node.firstElementChild;
    if (bar?.style) bar.style.width = `${Math.round(ratio * 100)}%`;
  }

  function classes(...values) {
    return values.filter(Boolean).join(" ");
  }

  app.modules.uiPrimitives = {
    button,
    surface,
    select,
    menu,
    status,
    setStatus,
    badge,
    progress,
    setProgress
  };
})();
