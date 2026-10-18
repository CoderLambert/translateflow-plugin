(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richNavigationActions) return;
  const buttons = new WeakMap();
  const fragment = (value) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/u.test(value);
  const headword = (value) => typeof value === "string" && value.length > 0 && value.length <= 256 && value === value.trim() &&
    !/[\u0000-\u001f\u007f-\u009f:/\\?#%]/u.test(value) && !/^\.{1,2}$/u.test(value);
  function validate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (Object.keys(value).some((key) => !["kind", "headword", "fragment"].includes(key))) return null;
    if (value.kind === "fragment" && value.headword === undefined && fragment(value.fragment)) return { kind: "fragment", fragment: value.fragment };
    if (value.kind === "entry" && headword(value.headword) && (value.fragment === "" || fragment(value.fragment))) {
      return { kind: "entry", headword: value.headword, fragment: value.fragment };
    }
    return null;
  }
  function parse(value) {
    if (typeof value !== "string" || value.length > 4096) return null;
    if (value.startsWith("#")) return validate({ kind: "fragment", fragment: value.slice(1) });
    if (!value.startsWith("entry://")) return null;
    const tail = value.slice(8), split = tail.indexOf("#");
    const target = split < 0 ? tail : tail.slice(0, split);
    try { return validate({ kind: "entry", headword: decodeURIComponent(target), fragment: split < 0 ? "" : tail.slice(split + 1) }); }
    catch { return null; }
  }
  function button(action) {
    const safe = validate(action);
    if (!safe) return null;
    const node = document.createElement("button");
    node.type = "button"; node.className = "tf-rich-fragment-link";
    node.dataset.richAction = safe.kind;
    if (safe.kind === "fragment") node.dataset.richFragmentTarget = safe.fragment;
    buttons.set(node, safe);
    return node;
  }
  function targets(hosts, value) {
    if (!fragment(value)) return [];
    const matches = [];
    for (const host of hosts || []) {
      const root = host.shadowRoot || host;
      for (const node of root.querySelectorAll?.("[data-rich-target-id]") || []) {
        if (node.dataset.richTargetId === value) matches.push(node);
        if (matches.length >= 32768) return matches;
      }
    }
    return matches;
  }
  function locate(hosts, value) {
    const matches = targets(hosts, value);
    const node = matches[0];
    if (node) {
      const host = node.getRootNode?.().host;
      if (host) app.modules.richOxfordAdapter?.prepareTarget(host, node);
      node.scrollIntoView?.({ block: "nearest", behavior: "auto" }); node.tabIndex = -1;
      node.focus?.({ preventScroll: true });
    }
    return { found: Boolean(node), duplicates: Math.max(0, matches.length - 1) };
  }
  function bind(viewport, onAction) {
    viewport.addEventListener("click", (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
      const node = path.find((item) => buttons.has(item));
      if (!node || !viewport.contains(node)) return;
      event.preventDefault(); event.stopPropagation();
      const action = validate(buttons.get(node));
      if (!action) return;
      if (typeof onAction === "function") onAction(action);
      else if (action.kind === "fragment") locate([viewport], action.fragment);
    });
  }
  app.modules.richNavigationActions = Object.freeze({ parse, validate, fragment, headword, button, bind, locate });
})();
