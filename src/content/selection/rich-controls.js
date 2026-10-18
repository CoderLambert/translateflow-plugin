(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richDictionaryControls) return;
  const ID = /^[a-z0-9_-]{1,80}$/iu;

  function tokenAttributes(token) {
    const attrs = token.attrs;
    if (token.duplicate || String(attrs.type || "").toLowerCase() !== "radio" ||
        !ID.test(attrs.id || "") || !ID.test(attrs.name || "")) return null;
    return { "data-rich-target-id": attrs.id, "data-rich-radio-name": attrs.name,
      "data-rich-radio-checked": Object.hasOwn(attrs, "checked") ? "1" : "0" };
  }

  // This relation is checked on the parsed tree and again on the viewer's input.
  // No source id/name becomes a document-global control or arbitrary attribute.
  function associations(nodes) {
    const ids = new Map(), groups = new Map(), labels = [], radios = [];
    let count = 0, rejectedRadio = false;
    function visit(items, depth) {
      if (depth > 32) return;
      for (const node of Array.isArray(items) ? items : []) {
        if (++count > 32768) return;
        if (node?.type !== "element") continue;
        if (node.attrs?.["data-rich-control-unavailable"] === "radio") rejectedRadio = true;
        const id = String(node.attrs?.["data-rich-target-id"] || "");
        if (ID.test(id)) ids.set(id, ids.has(id) ? null : node);
        if (node.tag === "input") {
          const name = String(node.attrs?.["data-rich-radio-name"] || "");
          const checked = node.attrs?.["data-rich-radio-checked"];
          const item = { node, id, name, checked: checked === "1", valid: ID.test(id) && ID.test(name) &&
            (checked === "0" || checked === "1") && Array.isArray(node.children) && !node.children.length, labels: [] };
          radios.push(item);
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name).push(item);
        } else if (node.tag === "label") labels.push(node);
        visit(node.children, depth + 1);
      }
    }
    visit(nodes, 0);
    const byId = new Map(radios.filter((item) => ids.get(item.id) === item.node).map((item) => [item.id, item]));
    for (const label of labels) {
      const item = byId.get(String(label.attrs?.["data-rich-label-for"] || ""));
      if (item) item.labels.push(label);
    }
    const allowed = new Map();
    for (const group of groups.values()) {
      if (group.some((item) => !item.valid || ids.get(item.id) !== item.node || !item.labels.length) ||
          group.filter((item) => item.checked).length > 1) continue;
      for (const item of group) {
        allowed.set(item.node, item);
        for (const label of item.labels) allowed.set(label, item);
      }
    }
    return { allowed, radios, labels, unavailable: rejectedRadio || radios.some((item) => !allowed.has(item.node)) };
  }

  function normalize(nodes) {
    const plan = associations(nodes);
    let degraded = false;
    for (const node of [...plan.radios.map((item) => item.node), ...plan.labels]) {
      if (plan.allowed.has(node)) continue;
      degraded = true;
      const kind = node.tag === "input" ? "radio" : "label";
      node.tag = "span";
      if (node.attrs) {
        delete node.attrs["data-rich-radio-name"];
        delete node.attrs["data-rich-radio-checked"];
        delete node.attrs["data-rich-label-for"];
        node.attrs["data-rich-control-unavailable"] = kind;
      }
    }
    return { degraded: degraded || plan.unavailable, unavailable: plan.unavailable };
  }

  function createView(nodes) {
    const plan = associations(nodes), inputs = new Map(), labels = new Map(), listeners = new Set();
    function element(node) {
      const item = plan.allowed.get(node);
      if (!item) return null;
      const el = document.createElement(node.tag);
      if (node.tag === "input") {
        el.type = "radio"; el.id = item.id; el.name = item.name; el.checked = item.checked; el.tabIndex = -1;
        inputs.set(item, el);
      } else {
        el.htmlFor = item.id;
        if (!labels.has(item)) labels.set(item, []);
        labels.get(item).push(el);
      }
      return el;
    }
    function finish() {
      let complete = true;
      const groups = new Map();
      for (const item of plan.radios) {
        if (!plan.allowed.has(item.node)) continue;
        if (!groups.has(item.name)) groups.set(item.name, []);
        groups.get(item.name).push(item);
      }
      for (const group of groups.values()) {
        if (group.some((item) => !inputs.has(item) || !labels.get(item)?.length)) {
          complete = false;
          for (const item of group) {
            inputs.get(item)?.remove();
            for (const label of labels.get(item) || []) label.htmlFor = "";
          }
          continue;
        }
        const sync = () => {
          const selected = group.find((item) => inputs.get(item).checked) || group[0];
          for (const item of group) for (const label of labels.get(item)) {
            label.setAttribute("role", "radio");
            label.setAttribute("aria-checked", String(inputs.get(item).checked));
            label.tabIndex = item === selected && label === labels.get(item)[0] ? 0 : -1;
          }
        };
        for (const item of group) {
          inputs.get(item).addEventListener("change", () => { sync(); for (const listener of listeners) listener(item.node); });
          for (const label of labels.get(item)) label.addEventListener("keydown", (event) => {
            const index = group.indexOf(item);
            let next = index;
            if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % group.length;
            else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index + group.length - 1) % group.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = group.length - 1;
            else if (![" ", "Enter"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            inputs.get(group[next]).click();
            sync(); labels.get(group[next])[0].focus({ preventScroll: true });
          });
        }
        sync();
      }
      return complete;
    }
    return { element, finish, select(node) { const item = plan.allowed.get(node); const input = inputs.get(item); if (!input) return false; input.click(); return true; },
      selected: (node) => Boolean(inputs.get(plan.allowed.get(node))?.checked),
      onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }, unavailable: plan.unavailable, plainText: () => plainText(nodes) };
  }

  function plainText(nodes) {
    const parts = []; let chars = 0, count = 0;
    const blocked = new Set(["script", "style", "form", "iframe", "object", "svg", "math", "button", "select", "textarea"]);
    const visit = (items, depth) => {
      if (depth > 32) return;
      for (const node of Array.isArray(items) ? items : []) {
        if (++count > 32768 || chars >= 2 * 1024 * 1024) return;
        if (node?.type === "text") {
          const text = String(node.text || "").slice(0, 2 * 1024 * 1024 - chars);
          parts.push(text); chars += text.length;
        } else if (node?.type === "element" && !blocked.has(String(node.tag || "").toLowerCase())) {
          visit(node.children, depth + 1);
          if (chars < 2 * 1024 * 1024) { parts.push("\n"); chars += 1; }
        }
      }
    };
    visit(nodes, 0); return parts.join("");
  }

  function unavailableNotice(viewport, locale) {
    const note = document.createElement("div"); note.className = "tf-rich-truncated";
    locale.bindText(note, "content.rich.controlsUnavailable"); viewport.appendChild(note);
  }

  app.modules.richDictionaryControls = Object.freeze({ tokenAttributes, associations, normalize, createView, unavailableNotice, plainText });
})();
