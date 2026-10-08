(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.uiTokens || app.modules.uiHost) return;

  const { constants } = app.modules.runtime;
  const { css } = app.modules.uiTokens;
  const featureCss = [
    app.modules.uiQuickControlStyles?.css,
    app.modules.uiSelectionAiDetailStyles?.css,
    app.modules.uiSelectionEmptyStateStyles?.css,
    app.modules.uiSelectionLexicalStyles?.css,
    app.modules.uiReadingReturnStyles?.css
  ].filter(Boolean).join("\n");
  let host;
  let shadow;
  let layers;

  function ensureHost() {
    if (host?.isConnected && shadow) return { host, shadow };

    host = document.createElement("div");
    host.id = "translateflow-ui-root";
    host.setAttribute(constants.EXTENSION_UI_ATTR, "root");
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("inset", "0", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "none", "important");

    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${css}\n${featureCss}\n.tf-ui-layer { position: fixed; inset: 0; pointer-events: none; }\n.tf-ui-layer > * { pointer-events: auto; }`;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    layers = new Map();
    return { host, shadow };
  }

  function getLayer(name = "default") {
    ensureHost();
    if (layers.has(name)) return layers.get(name);
    const layer = document.createElement("div");
    layer.className = "tf-ui-layer";
    layer.dataset.layer = name;
    shadow.appendChild(layer);
    layers.set(name, layer);
    return layer;
  }

  function ownsNode(node) {
    ensureHost();
    if (!(node instanceof Node)) return false;
    if (node === host || host.contains(node)) return true;
    return node.getRootNode?.() === shadow;
  }

  function focusablePageTarget(target) {
    if (!target || target.nodeType !== 1 || target.ownerDocument !== document
      || target === document.body || target === document.documentElement
      || !target.isConnected || typeof target.focus !== "function" || ownsNode(target)) return null;
    if (target.matches?.(":disabled") || target.closest?.("[hidden], [inert]")) return null;
    return target;
  }

  function createFocusReturn() {
    let target = null;
    return {
      capture(activeElement) { target = focusablePageTarget(activeElement) || target; },
      clear() { target = null; },
      restore() {
        const candidate = focusablePageTarget(target);
        target = null;
        if (!candidate) return;
        try { candidate.focus({ preventScroll: true }); } catch { /* The page may remove it. */ }
      }
    };
  }

  function isEventInsidePanel(event, panel) {
    if (!panel || panel.hidden || !event) return false;
    if (typeof event.composedPath === "function" && event.composedPath().includes(panel)) return true;
    return panel.contains(panel.getRootNode()?.activeElement);
  }

  function getHost() {
    return ensureHost().host;
  }

  function getShadowRoot() {
    return ensureHost().shadow;
  }

  app.modules.uiHost = { getHost, getShadowRoot, getLayer, ownsNode, createFocusReturn, isEventInsidePanel };
})();
