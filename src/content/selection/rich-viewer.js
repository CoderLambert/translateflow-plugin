(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionRichViewer) return;
  const locale = app.modules.contentI18n;

  const ALLOWED_TAGS = new Set([
    "div", "span", "p", "br", "b", "strong", "i", "em", "u",
    "ul", "ol", "li", "table", "tr", "td", "th", "ruby", "rt", "rp"
  ]);
  const DROP_SUBTREE_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "form", "svg", "math",
    "video", "source", "input", "button", "select", "textarea", "link", "meta", "base"
  ]);
  const STYLE_PROPERTIES = new Set([
    "background-color", "border", "border-bottom", "border-color", "border-left",
    "border-right", "border-top", "border-width", "color", "display", "font-size",
    "font-style", "font-weight", "line-height", "margin", "margin-bottom",
    "margin-left", "margin-right", "margin-top", "padding", "padding-bottom",
    "padding-left", "padding-right", "padding-top", "text-align", "text-decoration",
    "vertical-align", "white-space"
  ]);
  const MAX_NODES = 8192;
  const MAX_DEPTH = 32;
  const VIEWER_CSS = `
:host { --tf-rich-blue: #1e90ff; --tf-rich-note: #777; display: block; min-width: 0; max-width: 100%; color: var(--tf-text-main, #3c463d); }
*, *::before, *::after { box-sizing: border-box; max-width: 100%; }
.tf-rich-viewer {
  box-sizing: border-box;
  max-width: 100%;
  max-height: 210px;
  overflow: auto;
  overflow-wrap: anywhere;
  color: inherit;
  font: inherit;
  line-height: 1.55;
  white-space: normal;
  scrollbar-width: thin;
}
.tf-rich-viewer:focus-visible { outline: 2px solid var(--tf-green-600, #6f9668); outline-offset: 2px; }
.tf-rich-viewer p { margin: 0 0 .45em; }
.tf-rich-viewer p:last-child { margin-bottom: 0; }
.tf-rich-viewer ul, .tf-rich-viewer ol { margin: .25em 0; padding-left: 1.5em; }
.tf-rich-viewer li { margin: .1em 0; }
.tf-rich-table-scroll { max-width: 100%; overflow-x: auto; }
.tf-rich-viewer table { max-width: 100%; border-collapse: collapse; }
.tf-rich-viewer td, .tf-rich-viewer th { border: 1px solid var(--tf-border-soft, rgba(58,75,59,.14)); padding: 2px 5px; vertical-align: top; }
.tf-rich-viewer th { font-weight: 700; }
.tf-rich-placeholder { display: inline-block; padding: 1px 5px; border: 1px dashed var(--tf-border-soft, #b9c2b4); border-radius: 4px; color: var(--tf-text-muted, #8a9187); font-size: .9em; }
.tf-rich-resource-image { display: block; max-width: min(100%, 320px); height: auto; object-fit: contain; }
.tf-rich-resource-audio { display: block; max-width: 100%; margin: .25em 0; }
.tf-rich-audio-load { font: inherit; cursor: pointer; background: transparent; }
.tf-rich-truncated { margin-top: .35em; color: var(--tf-text-muted, #8a9187); font-size: .9em; }
@media (prefers-color-scheme: dark) {
  :host { --tf-rich-blue: #83bfff; --tf-rich-note: #aab3aa; color: var(--tf-text-main, #e1e9de); }
  .tf-rich-viewer td, .tf-rich-viewer th { border-color: var(--tf-border-soft, rgba(221,231,212,.16)); }
}
@media (max-width: 360px) {
  .tf-rich-viewer table { font-size: .92em; }
}
`;

  function render(container, ast, fallbackText = "", { preserveNewlines = false, dictionaryId = "" } = {}) {
    if (!container) return false;
    const root = getShadowRoot(container);
    if (!root) return false;
    app.modules.richResourceResolver?.close(container);
    root.replaceChildren();

    const style = document.createElement("style");
    style.textContent = VIEWER_CSS;
    root.appendChild(style);

    const viewport = document.createElement("div");
    viewport.className = "tf-rich-viewer";
    viewport.setAttribute("role", "region");
    locale.bindAttribute(viewport, "aria-label", "content.rich.contentAria");
    viewport.tabIndex = 0;
    if (preserveNewlines) viewport.style.setProperty("white-space", "pre-wrap");
    root.appendChild(viewport);

    let count = { value: 0, truncated: Boolean(ast?.truncated) };
    const resources = [];
    const nodes = Array.isArray(ast?.nodes) ? ast.nodes : [];
    for (const node of nodes) {
      const rendered = renderNode(node, 0, count, resources);
      if (rendered) viewport.appendChild(rendered);
      if (count.value >= MAX_NODES) break;
    }
    if (!viewport.childNodes.length && String(fallbackText || "")) {
      viewport.appendChild(document.createTextNode(String(fallbackText).slice(0, 512 * 1024)));
    }
    if (count.truncated) {
      const note = document.createElement("div");
      note.className = "tf-rich-truncated";
      locale.bindText(note, "content.rich.truncated");
      viewport.appendChild(note);
    }
    container.replaceChildren(document.createTextNode(String(fallbackText || "").slice(0, 512 * 1024)));
    if (resources.length && dictionaryId) {
      app.modules.richResourceResolver?.attach(container, root, viewport, resources, dictionaryId);
    }
    return true;
  }

  function renderPlainText(container, text) {
    return render(container, { nodes: [{ type: "text", text: String(text || "") }] }, text, { preserveNewlines: true });
  }

  function renderNode(node, depth, count, resources) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH || count.value >= MAX_NODES) {
      count.truncated = true;
      return null;
    }
    count.value += 1;
    if (node.type === "text") {
      return document.createTextNode(String(node.text || "").slice(0, 512 * 1024));
    }
    if (node.type === "resource") {
      const path = app.modules.richResourcePath?.normalize?.(node.path) || "";
      if (!path || path !== node.path || !["image", "audio", "stylesheet"].includes(node.kind)) return null;
      const label = String(node.label || "").slice(0, 160);
      const item = { kind: node.kind, path, label, element: null };
      resources.push(item);
      if (node.kind === "stylesheet") return null;
      const placeholderNode = placeholder(node.kind === "image" ? "img" : "audio", label);
      item.element = placeholderNode;
      if (node.kind === "audio") placeholderNode.className += " tf-rich-audio-load";
      return placeholderNode;
    }
    if (node.type !== "element") return null;

    const tag = String(node.tag || "").toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return null;
    if (tag === "img" || tag === "audio") return placeholder(tag);
    if (!ALLOWED_TAGS.has(tag)) return renderChildren(node.children, depth + 1, count, resources);

    const element = document.createElement(tag);
    element.className = `tf-rich-node-${tag}`;
    applySafeAttributes(element, node.attrs);
    applySafeStyles(element, node.style);
    if (tag === "table") {
      const wrapper = document.createElement("div");
      wrapper.className = "tf-rich-table-scroll";
      wrapper.appendChild(element);
      appendChildren(element, node.children, depth, count, resources);
      return wrapper;
    }
    const placeholderKind = String(node.attrs?.["data-rich-placeholder"] || "");
    if (placeholderKind === "image" || placeholderKind === "audio") {
      const label = String(node.attrs?.["data-rich-label"] || "").slice(0, 160);
      locale.bindText(element,
        label ? (placeholderKind === "image" ? "content.rich.imageLabel" : "content.rich.audioLabel")
          : (placeholderKind === "image" ? "content.rich.imageMissing" : "content.rich.audioMissing"),
        label ? { label } : {});
    } else appendChildren(element, node.children, depth, count, resources);
    return element;
  }

  function renderChildren(children, depth, count, resources) {
    const fragment = document.createDocumentFragment();
    appendChildren(fragment, children, depth, count, resources);
    return fragment.childNodes.length ? fragment : null;
  }

  function appendChildren(parent, children, depth, count, resources) {
    for (const child of Array.isArray(children) ? children : []) {
      const rendered = renderNode(child, depth + 1, count, resources);
      if (rendered) parent.appendChild(rendered);
      if (count.value >= MAX_NODES) {
        count.truncated = true;
        break;
      }
    }
  }

  function applySafeAttributes(element, attrs) {
    if (!attrs || typeof attrs !== "object") return;
    const compactId = String(attrs["data-compact-id"] || "");
    if (/^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])$/u.test(compactId)) {
      element.setAttribute("data-compact-id", compactId);
    }
    const safeClasses = String(attrs.class || "")
      .split(/\s+/u)
      .filter((name) => /^[-_a-z][-_a-z0-9]{0,47}$/iu.test(name))
      .slice(0, 4);
    if (safeClasses.length) element.className += ` ${[...new Set(safeClasses)].join(" ")}`;
    const placeholderKind = String(attrs["data-rich-placeholder"] || "");
    if (placeholderKind === "image" || placeholderKind === "audio") {
      element.className += " tf-rich-placeholder";
      element.setAttribute("data-rich-placeholder", placeholderKind);
      locale.bindAttribute(element, "aria-label", placeholderKind === "image" ? "content.rich.imageMissing" : "content.rich.audioMissing");
    }
    for (const name of ["colspan", "rowspan"]) {
      const value = Number(attrs[name]);
      if ((element.tagName === "TD" || element.tagName === "TH") && Number.isInteger(value) && value >= 1 && value <= 50) {
        element.setAttribute(name, String(value));
      }
    }
  }

  function applySafeStyles(element, styles) {
    if (!styles || typeof styles !== "object") return;
    for (const [property, rawValue] of Object.entries(styles)) {
      const name = String(property).toLowerCase();
      const value = String(rawValue || "").trim();
      if (
        !STYLE_PROPERTIES.has(name) || value.length > 128 ||
        /[;{}<>\u0000-\u001f]/u.test(value) ||
        /(?:url|expression|javascript|vbscript|@import|behavior|binding)\s*[:(]/iu.test(value)
      ) continue;
      const safeValue = name === "font-size"
        ? `clamp(8px, ${value}, 48px)`
        : name === "color" && /^(?:dodgerblue|#1e90ff)$/iu.test(value)
          ? "var(--tf-rich-blue, dodgerblue)"
          : name === "color" && /^(?:gray|grey|#808080)$/iu.test(value)
            ? "var(--tf-rich-note, #777)"
            : value;
      element.style.setProperty(name, safeValue);
    }
  }

  function placeholder(kind, label = "") {
    const item = document.createElement("span");
    item.className = "tf-rich-placeholder";
    const image = kind === "img" || kind === "image";
    locale.bindAttribute(item, "aria-label", image ? "content.rich.imageMissing" : "content.rich.audioMissing");
    locale.bindText(item,
      label ? (image ? "content.rich.imageLabel" : "content.rich.audioLabel") : (image ? "content.rich.imageMissing" : "content.rich.audioMissing"),
      label ? { label } : {});
    return item;
  }

  function getShadowRoot(container) {
    if (container.shadowRoot) return container.shadowRoot;
    if (typeof container.attachShadow !== "function") return null;
    return container.attachShadow({ mode: "open" });
  }

  app.modules.selectionRichViewer = Object.freeze({ render, renderPlainText });
})();
