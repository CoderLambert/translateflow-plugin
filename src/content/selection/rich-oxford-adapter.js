(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richOxfordAdapter) return;
  const sessions = new WeakMap(), active = new Set();
  const integer = (value) => typeof value === "string" && /^(?:[0-9]|1[0-5])$/u.test(value) ? Number(value) : null;
  const classes = (node) => String(node?.attrs?.class || "").split(/\s+/u);
  const has = (node, name) => classes(node).includes(name);
  function indexClass(node, prefix) {
    const values = classes(node).filter((name) => name.startsWith(prefix));
    return values.length === 1 ? integer(values[0].slice(prefix.length)) : null;
  }
  function project(node, token) {
    if (!node || token.duplicate) return;
    const hints = {};
    if (node.tag === "input" && indexClass(node, "o-pos-radio-") !== null) {
      const value = integer(token.attrs["data-pos-index"]); if (value !== null) hints.posIndex = value;
    }
    for (const [role, source, field] of [["o-pronunciation-set", "data-pronunciation-for", "pronunciationFor"], ["o-head-symbol-set", "data-head-symbols-for", "headSymbolsFor"]]) {
      if (!has(node, role)) continue;
      const value = integer(token.attrs[source]); if (value !== null) hints[field] = value;
    }
    if (Object.keys(hints).length) node.oxfordHints = hints;
  }
  function flatten(nodes) {
    const result = [];
    const visit = (items, depth) => { if (depth > 32) return; for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object") continue;
      if (result.length >= 32768) return; result.push(item); if (item.type === "element") visit(item.children, depth + 1);
    } };
    visit(nodes, 0); return result;
  }
  function hint(node, key) {
    const hints = node.oxfordHints;
    if (!hints || typeof hints !== "object" || Object.keys(hints).some((name) => !["posIndex", "pronunciationFor", "headSymbolsFor"].includes(name))) return null;
    if (Object.keys(hints).length !== 1) return null;
    const value = hints[key]; return Number.isInteger(value) && value >= 0 && value <= 15 ? value : null;
  }
  function recognize(nodes) {
    const all = flatten(nodes), switches = all.filter((node) => has(node, "o-pos-switch"));
    if (switches.length !== 1 || !all.some((node) => has(node, "o-word-line"))) return null;
    const direct = switches[0].children || [], radios = direct.filter((node) => node.tag === "input");
    const tabs = direct.filter((node) => node.tag === "nav" && has(node, "o-pos-tabs"));
    const boxes = direct.filter((node) => node.tag === "div" && has(node, "o-pos-panels"));
    if (!radios.length || radios.length > 16 || tabs.length !== 1 || boxes.length !== 1) return null;
    const relations = app.modules.richDictionaryControls.associations(nodes);
    if (relations.unavailable) return null;
    const panels = (boxes[0].children || []).filter((node) => node.type === "element");
    const labels = flatten(tabs[0].children).filter((node) => node.tag === "label");
    if (panels.length !== radios.length || labels.length !== radios.length || new Set(radios.map((node) => node.attrs?.["data-rich-radio-name"])).size !== 1) return null;
    const pairs = new Map();
    for (const radio of radios) {
      const index = hint(radio, "posIndex"), marker = indexClass(radio, "o-pos-radio-");
      if (index === null || marker !== index || pairs.has(index) || !relations.allowed.has(radio)) return null;
      const panel = panels.filter((node) => node.tag === "section" && has(node, "o-pos-panel") && indexClass(node, "o-for-pos-") === index);
      const label = labels.filter((node) => indexClass(node, "o-for-pos-") === index && relations.allowed.get(node) === relations.allowed.get(radio));
      if (panel.length !== 1 || label.length !== 1) return null;
      pairs.set(index, { radio, panel: panel[0] });
    }
    if (Array.from({ length: radios.length }, (_, index) => index).some((index) => !pairs.has(index))) return null;
    function sets(role, field) {
      const items = all.filter((node) => has(node, role)), mapped = new Map(), duplicate = new Set();
      for (const node of items) {
        const index = hint(node, field); if (index === null || !pairs.has(index) || (has(node, "o-pronunciation-set") && has(node, "o-head-symbol-set"))) continue;
        if (mapped.has(index)) { mapped.delete(index); duplicate.add(index); }
        else if (!duplicate.has(index)) mapped.set(index, node);
      }
      return { items, mapped };
    }
    const parents = new Map();
    for (const parent of all) for (const child of Array.isArray(parent.children) ? parent.children : []) parents.set(child, parent);
    const ownerWrap = (node) => { let parent = parents.get(node); for (let depth = 0; parent && depth < 32; depth += 1, parent = parents.get(parent)) if (has(parent, "o-symbol-wrap")) return parent; return null; };
    const tips = [];
    for (const wrap of all.filter((node) => has(node, "o-symbol-wrap"))) {
      const candidates = flatten(wrap.children).filter((node) => has(node, "o-symbol-tip") && ownerWrap(node) === wrap);
      if (candidates.length !== 1 || tips.length >= 256) continue;
      const text = app.modules.richDictionaryControls.plainText(candidates[0].children).trim();
      if (text && new TextEncoder().encode(text).length <= 1024) tips.push({ wrap, tip: candidates[0], text });
    }
    const illustrations = [];
    for (const summary of all.filter((node) => node.tag === "summary" && has(node, "o-unbox-tile"))) {
      const wrappers = flatten(summary.children).filter((node) => has(node, "o-unbox-tile-illustration"));
      if (wrappers.length !== 1) continue;
      const images = flatten(wrappers[0].children).filter((node) => node.type === "resource" && node.kind === "image");
      if (images.length !== 1) continue;
      const key = app.modules.richResourcePath.descriptorKey("image", images[0].path, images[0].presentation);
      if (key) illustrations.push({ summary, key });
    }
    return { version: "oxford10-v1", pairs, pronunciation: sets("o-pronunciation-set", "pronunciationFor"),
      symbols: sets("o-head-symbol-set", "headSymbolsFor"), tips, illustrations, extraNodes: (tips.length + illustrations.length) * 2 };
  }
  function bind({ host, viewport, nodes, elements, controls, identity, count, textBytes = 0 }) {
    close(host); const plan = recognize(nodes);
    if (!plan || count + plan.extraNodes > 32767) return null;
    const state = { host, viewport, root: host.shadowRoot, identity: Object.freeze({ ...identity }), plan, elements, controls, closed: false, popup: null, selected: null, count: count + plan.extraNodes, textBytes };
    sessions.set(host, state); active.add(state);
    const live = () => !state.closed && sessions.get(host) === state && host.shadowRoot === state.root;
    function sync(radio) {
      if (!live()) return;
      const pair = [...plan.pairs].find(([, value]) => value.radio === radio);
      const index = pair ? pair[0] : null;
      if (index !== state.selected) app.modules.richResourceResolver?.stopAudio(host);
      state.selected = index;
      for (const [pos, pair] of plan.pairs) {
        const panel = elements.get(pair.panel); if (!panel) continue;
        panel.hidden = pos !== index; panel.style.setProperty("display", pos === index ? "block" : "none", "important");
      }
      for (const [collection, display] of [[plan.pronunciation, "block"], [plan.symbols, "inline-flex"]]) {
        for (const node of collection.items) {
          const element = elements.get(node); if (!element) continue;
          const selected = index !== null && collection.mapped.get(index) === node;
          element.classList.toggle("o-active", selected); element.hidden = !selected;
          element.style.setProperty("display", selected ? display : "none", "important");
        }
      }
    }
    state.unsubscribe = controls.onChange((radio) => { if (controls.selected(radio)) sync(radio); });
    sync([...plan.pairs.values()].find((pair) => controls.selected(pair.radio))?.radio);
    for (const item of plan.tips) {
      const wrap = elements.get(item.wrap), tip = elements.get(item.tip); if (!wrap || !tip) continue;
      tip.hidden = true; tip.style.setProperty("display", "none", "important");
      const button = ownedButton("content.rich.showHint"); wrap.appendChild(button);
      button.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation(); if (!live()) return;
        if (state.popup?.opener === button) { closeHint(state); return; } closeHint(state);
        const textBytes = new TextEncoder().encode(item.text).length;
        if (state.count + 5 > 32767 || state.textBytes + textBytes > 2 * 1024 * 1024 || !admitsHint(state, textBytes)) return;
        const popup = document.createElement("div"); popup.className = "tf-rich-owned-hint"; popup.setAttribute("role", "dialog");
        popup.style.cssText = "display:block!important;position:relative;max-width:100%;padding:8px;border:1px solid var(--tf-border-soft,#d8ddd4);background:var(--tf-bg-subtle,#f7f5ef);color:var(--tf-text-main,#3c463d);border-radius:8px";
        const text = document.createElement("span"); text.textContent = item.text;
        const dismiss = ownedButton("content.rich.closeHint"); dismiss.addEventListener("click", () => closeHint(state));
        popup.append(text, dismiss); wrap.appendChild(popup); state.popup = { element: popup, opener: button }; dismiss.focus();
      });
    }
    for (const item of plan.illustrations) {
      const summary = elements.get(item.summary); if (!summary) continue;
      const button = ownedButton("content.rich.viewIllustration"); summary.appendChild(button);
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); if (live()) app.modules.richResourceResolver?.openImagePreview(host, item.key, button); });
    }
    state.prepare = (target) => {
      if (!live() || !viewport.contains(target)) return false;
      let match = [...plan.pairs.values()].find((pair) => elements.get(pair.panel)?.contains(target));
      if (!match) for (const collection of [plan.pronunciation, plan.symbols]) for (const [index, node] of collection.mapped) {
        if (elements.get(node)?.contains(target)) match = plan.pairs.get(index);
      }
      if (match) controls.select(match.radio);
      for (let node = target; node && node !== viewport; node = node.parentElement) if (node.tagName === "DETAILS") node.open = true;
      return true;
    };
    return state;
  }
  function admitsHint(state, hintBytes) {
    const maxNodes = 32768 - 5, maxBytes = 2 * 1024 * 1024 - hintBytes - 256;
    const body = state.host.closest?.(".tf-selection-rich-card-body");
    const hosts = body ? body.querySelectorAll(".tf-selection-rich-text") : [state.host];
    let nodes = 0, bytes = 0;
    const encoder = new TextEncoder();
    for (const host of hosts) {
      const viewport = host === state.host ? state.viewport : host.shadowRoot?.querySelector(".tf-rich-viewer");
      if (!viewport) continue;
      // TreeWalker measures actual dynamic hints/previews/SVG too, without a
      // recursive stack or materializing all descendants near the card limit.
      const walker = viewport.ownerDocument.createTreeWalker(viewport, 0xffffffff);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (++nodes > maxNodes) return false;
        if (node.nodeType !== 3) continue;
        const text = node.nodeValue || "";
        if (text.length > maxBytes - bytes) return false;
        bytes += encoder.encode(text).length;
        if (bytes > maxBytes) return false;
      }
    }
    return true;
  }
  function ownedButton(key) {
    const button = document.createElement("button"); button.type = "button"; button.className = "tf-rich-owned-action";
    button.style.cssText = "display:inline-block!important;border:1px solid var(--tf-border-soft,#d8ddd4);border-radius:6px;padding:2px 6px;margin:2px;font:inherit;color:inherit;background:var(--tf-bg-subtle,#f7f5ef);cursor:pointer";
    app.modules.contentI18n.bindText(button, key); return button;
  }
  function closeHint(state) {
    if (!state.popup) return false; const popup = state.popup; state.popup = null; popup.element.remove();
    if (popup.opener.isConnected) popup.opener.focus({ preventScroll: true }); return true;
  }
  function close(host) {
    const state = sessions.get(host); if (!state) return;
    state.closed = true; closeHint(state); state.unsubscribe?.(); active.delete(state); sessions.delete(host);
  }
  function closeAll() { for (const state of [...active]) close(state.host); }
  function closeDictionary(id) { for (const state of [...active]) if (state.identity.dictionaryId === id) close(state.host); }
  function dismissTransients(scope) {
    if (!scope) return false;
    let dismissed = false;
    for (const state of [...active].reverse()) {
      if (state.closed || !scope.contains(state.host)) continue;
      dismissed = Boolean(app.modules.richResourceResolver?.closeImagePreview(state.host)) || dismissed;
      dismissed = closeHint(state) || dismissed;
    }
    return dismissed;
  }
  function prepareTarget(host, target) { return sessions.get(host)?.prepare(target) || false; }
  function consumeEscape(event, scope) {
    for (const state of [...active].reverse()) {
      if (state.closed || !scope.contains(state.host)) continue;
      if (app.modules.richResourceResolver?.closeImagePreview(state.host) || closeHint(state)) {
        event.preventDefault(); event.stopImmediatePropagation?.(); return true;
      }
    }
    return false;
  }
  app.modules.richOxfordAdapter = Object.freeze({ project, recognize, bind, close, closeAll, closeDictionary, dismissTransients, prepareTarget, consumeEscape });
})();
