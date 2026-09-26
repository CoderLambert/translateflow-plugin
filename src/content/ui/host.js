(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.uiTokens || app.modules.uiHost) return;

  const { constants } = app.modules.runtime;
  const { css } = app.modules.uiTokens;
  const featureCss = [
    app.modules.uiQuickControlStyles?.css
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

  function getHost() {
    return ensureHost().host;
  }

  function getShadowRoot() {
    return ensureHost().shadow;
  }

  app.modules.uiHost = { getHost, getShadowRoot, getLayer, ownsNode };
})();
