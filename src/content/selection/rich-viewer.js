(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.contentI18n || app.modules.selectionRichViewer) return;
  const locale = app.modules.contentI18n;

  const ALLOWED_TAGS = new Set([
    "div", "span", "p", "br", "b", "strong", "i", "em", "u",
    "ul", "ol", "li", "table", "tr", "td", "th", "ruby", "rt", "rp", "a",
    "details", "summary"
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
  const MAX_NODES = 32768;
  const MAX_CONTENT_NODES = MAX_NODES - 1;
  const MAX_DEPTH = 32;
  const MAX_TEXT_BYTES = 2 * 1024 * 1024;
  const MAX_RESOURCE_DESCRIPTORS = 1024;
  const VIEWER_CSS = `
:host { --tf-rich-blue: #1e90ff; --tf-rich-note: #777; display: block; min-width: 0; max-width: 100%; color: var(--tf-text-main, #3c463d); }
*, *::before, *::after { box-sizing: border-box; max-width: 100%; }
.tf-rich-viewer {
  box-sizing: border-box;
  max-width: 100%;
  overflow: visible;
  overflow-wrap: anywhere;
  color: inherit;
  font: inherit;
  line-height: 1.55;
  white-space: normal;
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
.tf-rich-viewer .o-symbol-wrap { display: inline-flex; align-items: center; margin: 0 .12em; line-height: 1; vertical-align: middle; }
.tf-rich-viewer .o-symbol-token > .tf-rich-resource-image { display: inline-block; width: auto; height: 1.05em; max-width: 3em; max-height: 1.05em; margin: 0; border-radius: 0; object-fit: contain; vertical-align: text-bottom; }
.tf-rich-viewer .o-pronunciation-set, .tf-rich-viewer .o-head-symbol-set { display: none; }
.tf-rich-viewer .o-pronunciation-set.o-active { display: block; }
.tf-rich-viewer .o-head-symbol-set.o-active { display: inline-flex; }
.tf-rich-viewer details.o-unbox-panel { margin: .55em 0; border: 1px solid var(--tf-border-soft, #d8ddd4); border-radius: 9px; background: var(--tf-bg-subtle, #f7f5ef); }
.tf-rich-viewer details.o-unbox-panel > summary.o-unbox-tile { display: flex; align-items: center; min-width: 0; width: 100%; height: auto; min-height: 34px; margin: 0; padding: 6px 9px; border-radius: 9px; cursor: pointer; list-style: none; }
.tf-rich-viewer details.o-unbox-panel > summary.o-unbox-tile::-webkit-details-marker { display: none; }
.tf-rich-viewer details.o-unbox-panel > summary.o-unbox-tile::before { content: "›"; flex: 0 0 auto; margin-right: 7px; color: var(--tf-green-700, #557b52); font-size: 1.15em; line-height: 1; transition: transform 120ms ease; }
.tf-rich-viewer details.o-unbox-panel[open] > summary.o-unbox-tile::before { transform: rotate(90deg); }
.tf-rich-viewer details.o-unbox-panel .o-unbox-tile-icon, .tf-rich-viewer details.o-unbox-panel .o-unbox-tile-illustration { display: none; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-tile-title { display: flex; flex-flow: row wrap; align-items: baseline; gap: .2em .45em; min-width: 0; text-align: left; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-tile-simp, .tf-rich-viewer details.o-unbox-panel .o-unbox-tile-eng { margin: 0; color: inherit; font: inherit; line-height: 1.3; white-space: normal; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-tile-simp { font-weight: 700; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-tile-eng { color: var(--tf-text-muted, #747d73); font-size: .82em; }
.tf-rich-viewer details.o-unbox-panel > .o-unbox-body { display: none; margin: 0; padding: 8px 10px 10px; border-top: 1px solid var(--tf-border-soft, #d8ddd4); background: transparent; font: inherit; }
.tf-rich-viewer details.o-unbox-panel[open] > .o-unbox-body { display: block; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-body-header { padding: 0 0 .4em; background: transparent; font: inherit; font-weight: 700; line-height: 1.35; }
.tf-rich-viewer details.o-unbox-panel .o-unbox-body-content { padding: 0; }
.tf-rich-placeholder { display: inline-flex; align-items: center; gap: .36em; min-height: 26px; padding: 3px 8px; border: 1px solid var(--tf-border-soft, #d8ddd4); border-radius: 999px; background: var(--tf-bg-subtle, #f1ece2); color: var(--tf-text-muted, #747d73); font-size: .84em; line-height: 1.25; vertical-align: middle; }
.tf-rich-placeholder[data-rich-resource-kind="image"]::before { content: "▧"; color: var(--tf-green-700, #557b52); font-size: .92em; }
.tf-rich-placeholder[data-state="loading"] { opacity: .72; }
.tf-rich-placeholder[data-state="error"] { border-color: color-mix(in srgb, var(--tf-color-danger, #bd5550) 28%, var(--tf-border-soft, #d8ddd4)); color: var(--tf-color-danger, #9c514d); }
.tf-rich-inline-symbol-placeholder { min-height: 0; padding: 0 .12em; border: 0; border-radius: 2px; background: transparent; font-size: 1em; line-height: 1; vertical-align: middle; }
.tf-rich-inline-symbol-placeholder::before { display: none; }
.tf-rich-pronunciation-label { display: inline-flex; align-items: center; min-height: 26px; margin: 0 .12em; padding: 3px 7px; border-radius: 999px; background: var(--tf-green-50, #f5f8f2); color: var(--tf-green-800, #3f613f); font-size: .78em; font-weight: 700; line-height: 1; vertical-align: middle; }
.tf-rich-resource-image { display: block; max-width: min(100%, 360px); height: auto; margin: .45em 0; border-radius: 8px; object-fit: contain; }
.tf-rich-resource-image-oxford-inline { display: inline-block; width: auto; height: 1em; max-width: 4em; max-height: 1em; margin: 0 .12em; vertical-align: middle; object-fit: contain; }
.tf-rich-resource-audio { display: inline-block; width: min(100%, 280px); height: 32px; margin: .18em .3em .18em 0; vertical-align: middle; }
.tf-rich-audio-load { min-height: 28px; padding: 4px 10px; border-color: color-mix(in srgb, var(--tf-green-600, #6f9668) 30%, var(--tf-border-soft, #d8ddd4)); background: var(--tf-green-50, #f5f8f2); color: var(--tf-green-800, #3f613f); font: inherit; font-size: .82em; font-weight: 700; cursor: pointer; }
.tf-rich-audio-load::before { content: "◖))"; font-size: .9em; letter-spacing: -.16em; transform: translateX(-.08em); }
.tf-rich-audio-load:hover { border-color: var(--tf-green-600, #6f9668); background: var(--tf-green-100, #edf3e8); }
.tf-rich-audio-load:focus-visible { outline: 2px solid var(--tf-green-500, #8caf82); outline-offset: 2px; }
.tf-rich-audio-load:disabled { cursor: progress; opacity: .7; }
.tf-rich-fragment-link { border: 0; padding: 0; color: var(--tf-rich-blue); font: inherit; text-decoration: underline; cursor: pointer; background: transparent; }
.tf-rich-truncated { margin-top: .35em; color: var(--tf-text-muted, #8a9187); font-size: .9em; }
@media (prefers-color-scheme: dark) {
  :host { --tf-rich-blue: #83bfff; --tf-rich-note: #aab3aa; color: var(--tf-text-main, #e1e9de); }
  .tf-rich-viewer td, .tf-rich-viewer th { border-color: var(--tf-border-soft, rgba(221,231,212,.16)); }
}
@media (max-width: 360px) {
  .tf-rich-viewer table { font-size: .92em; }
}
`;

  function render(container, ast, fallbackText = "", { preserveNewlines = false, dictionaryId = "", packageVersion = "" } = {}) {
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
    viewport.addEventListener("click", (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      const button = path.find((node) => node instanceof HTMLButtonElement && node.hasAttribute("data-rich-fragment-target")) || null;
      if (!button || !viewport.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      const targetId = String(button.dataset.richFragmentTarget || "");
      const target = [...viewport.querySelectorAll("[data-rich-target-id]")]
        .find((node) => node.dataset.richTargetId === targetId);
      if (!target) return;
      target.scrollIntoView({ block: "nearest", behavior: "auto" });
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
    if (preserveNewlines) viewport.style.setProperty("white-space", "pre-wrap");
    root.appendChild(viewport);

    const fallbackSource = String(fallbackText || "");
    const boundedFallback = clipUtf8Text(fallbackSource, MAX_TEXT_BYTES);
    let count = {
      value: 0,
      textBytes: 0,
      truncated: Boolean(ast?.truncated) || boundedFallback.length < fallbackSource.length
    };
    const resources = [];
    const resourceMap = new Map();
    const nodes = Array.isArray(ast?.nodes) ? ast.nodes : [];
    for (let index = 0; index < nodes.length; index += 1) {
      const rendered = renderNode(nodes[index], 0, count, resources, resourceMap);
      if (rendered) viewport.appendChild(rendered);
      if (count.value >= MAX_CONTENT_NODES) {
        if (index < nodes.length - 1) count.truncated = true;
        break;
      }
    }
    if (!viewport.childNodes.length && boundedFallback) {
      viewport.appendChild(document.createTextNode(boundedFallback));
    }
    if (count.truncated) {
      const note = document.createElement("div");
      note.className = "tf-rich-truncated";
      locale.bindText(note, "content.rich.truncated");
      viewport.appendChild(note);
    }
    container.replaceChildren(document.createTextNode(boundedFallback));
    if (resources.length && dictionaryId) {
      app.modules.richResourceResolver?.attach(container, root, viewport, resources, dictionaryId, packageVersion);
    }
    return true;
  }

  function renderPlainText(container, text) {
    return render(container, { nodes: [{ type: "text", text: String(text || "") }] }, text, { preserveNewlines: true });
  }

  function renderNode(node, depth, count, resources, resourceMap) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH ||
        (node.type === "element" && depth >= MAX_DEPTH) || count.value >= MAX_CONTENT_NODES) {
      count.truncated = true;
      return null;
    }
    count.value += 1;
    if (node.type === "text") {
      const text = String(node.text || "");
      const remaining = Math.max(0, MAX_TEXT_BYTES - count.textBytes);
      const bounded = clipUtf8Text(text, remaining);
      count.textBytes += utf8ByteLength(bounded);
      if (bounded.length < text.length) count.truncated = true;
      return document.createTextNode(bounded);
    }
    if (node.type === "resource") {
      const path = app.modules.richResourcePath?.normalize?.(node.path) || "";
      if (!path || path !== node.path || !["image", "audio", "stylesheet"].includes(node.kind)) return null;
      const label = String(node.label || "").slice(0, 160);
      const presentation = resourcePresentation(node.presentation, node.kind, path);
      const key = `${node.kind}\u0000${path}\u0000${presentation}`;
      let item = resourceMap.get(key);
      if (!item) {
        if (resources.length >= MAX_RESOURCE_DESCRIPTORS) {
          count.truncated = true;
          return placeholder(node.kind === "image" ? "img" : "audio", label);
        }
        item = { kind: node.kind, path, label, presentation, elements: [] };
        resourceMap.set(key, item);
        resources.push(item);
      } else if (!item.label && label) item.label = label;
      if (node.kind === "stylesheet") return null;
      const placeholderNode = placeholder(node.kind === "image" ? "img" : "audio", label, presentation);
      if (node.kind === "image" && presentation) decorateOxfordPlaceholder(placeholderNode, presentation);
      item.elements.push(placeholderNode);
      if (node.kind === "audio") placeholderNode.className += " tf-rich-audio-load";
      return placeholderNode;
    }
    if (node.type !== "element") return null;

    const tag = String(node.tag || "").toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return null;
    if (tag === "img" || tag === "audio") return placeholder(tag);
    if (tag === "a") {
      const target = String(node.attrs?.["data-rich-fragment-target"] || "");
      if (!/^[a-z0-9_-]{1,80}$/iu.test(target)) return renderChildren(node.children, depth + 1, count, resources, resourceMap);
      const link = document.createElement("button");
      link.type = "button";
      link.className = "tf-rich-fragment-link";
      link.dataset.richFragmentTarget = target;
      applySafeStyles(link, node.style);
      appendChildren(link, node.children, depth, count, resources, resourceMap);
      return link;
    }
    if (!ALLOWED_TAGS.has(tag)) return renderChildren(node.children, depth + 1, count, resources, resourceMap);

    const element = document.createElement(tag);
    element.className = `tf-rich-node-${tag}`;
    applySafeAttributes(element, node.attrs);
    applySafeStyles(element, node.style);
    if (tag === "table") {
      const wrapper = document.createElement("div");
      wrapper.className = "tf-rich-table-scroll";
      wrapper.appendChild(element);
      appendChildren(element, node.children, depth, count, resources, resourceMap);
      return wrapper;
    }
    const pronunciation = safePronunciationKind(tag, node.attrs);
    if (pronunciation) {
      const shortKey = pronunciation === "british" ? "content.rich.britishPronunciationShort" : "content.rich.americanPronunciationShort";
      const descriptionKey = pronunciation === "british" ? "content.rich.britishPronunciationDescription" : "content.rich.americanPronunciationDescription";
      element.setAttribute("role", "img");
      locale.bindText(element, shortKey);
      locale.bindAttribute(element, "aria-label", descriptionKey);
      locale.bindAttribute(element, "title", descriptionKey);
      return element;
    }
    const placeholderKind = String(node.attrs?.["data-rich-placeholder"] || "");
    if (placeholderKind === "image" || placeholderKind === "audio") {
      const label = String(node.attrs?.["data-rich-label"] || "").slice(0, 160);
      locale.bindText(element,
        label ? (placeholderKind === "image" ? "content.rich.imageLabel" : "content.rich.audioLabel")
          : (placeholderKind === "image" ? "content.rich.imageMissing" : "content.rich.audioMissing"),
        label ? { label } : {});
    } else appendChildren(element, node.children, depth, count, resources, resourceMap);
    return element;
  }

  function renderChildren(children, depth, count, resources, resourceMap) {
    const fragment = document.createDocumentFragment();
    appendChildren(fragment, children, depth, count, resources, resourceMap);
    return fragment.childNodes.length ? fragment : null;
  }

  function appendChildren(parent, children, depth, count, resources, resourceMap) {
    const items = Array.isArray(children) ? children : [];
    for (let index = 0; index < items.length; index += 1) {
      const rendered = renderNode(items[index], depth + 1, count, resources, resourceMap);
      if (rendered) parent.appendChild(rendered);
      if (count.value >= MAX_CONTENT_NODES) {
        if (index < items.length - 1) count.truncated = true;
        break;
      }
    }
  }

  function clipUtf8Text(value, maximumBytes) {
    const text = String(value || "");
    let bytes = 0;
    let end = 0;
    while (end < text.length) {
      const code = text.codePointAt(end);
      const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (bytes + size > maximumBytes) break;
      bytes += size;
      end += code > 0xffff ? 2 : 1;
    }
    return text.slice(0, end);
  }

  function utf8ByteLength(value) {
    let bytes = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function applySafeAttributes(element, attrs) {
    if (!attrs || typeof attrs !== "object") return;
    const compactId = String(attrs["data-compact-id"] || "");
    if (/^(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])$/u.test(compactId)) {
      element.setAttribute("data-compact-id", compactId);
    }
    const targetId = String(attrs["data-rich-target-id"] || "");
    if (/^[a-z0-9_-]{1,80}$/iu.test(targetId)) element.dataset.richTargetId = targetId;
    const safeClasses = String(attrs.class || "")
      .split(/\s+/u)
      .filter((name) => /^[-_a-z][-_a-z0-9]{0,47}$/iu.test(name))
      .slice(0, 4);
    if (safeClasses.length) element.className += ` ${[...new Set(safeClasses)].join(" ")}`;
    const pronunciation = safePronunciationKind(element.tagName.toLowerCase(), attrs);
    if (pronunciation) element.setAttribute("data-rich-pronunciation", pronunciation);
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

  function safePronunciationKind(tag, attrs) {
    if (tag !== "span" || !attrs || typeof attrs !== "object") return "";
    const classes = String(attrs.class || "").split(/\s+/u);
    if (!classes.includes("tf-rich-pronunciation-label")) return "";
    const value = String(attrs["data-rich-pronunciation"] || "");
    return value === "british" || value === "american" ? value : "";
  }

  function resourcePresentation(value, kind, path) {
    if (kind === "image" && value === "oxford-opposition" && path === "img/OPP.png") return value;
    if (kind === "image" && value === "oxford-key" && (path === "img/Ox3000_key_L.png" || path === "img/Ox3000_key_S.png")) return value;
    if (kind === "audio" && (value === "pronunciation-british" || value === "pronunciation-american")) return value;
    return "";
  }

  function decorateOxfordPlaceholder(element, presentation) {
    const opposition = presentation === "oxford-opposition";
    const fallbackKey = opposition ? "content.rich.oxfordOppositionFallback" : "content.rich.oxfordKeyFallback";
    const descriptionKey = opposition ? "content.rich.oxfordOppositionDescription" : "content.rich.oxfordKeyDescription";
    element.className += " tf-rich-inline-symbol-placeholder";
    locale.bindText(element, fallbackKey);
    element.setAttribute("role", "img");
    locale.bindAttribute(element, "aria-label", descriptionKey);
    locale.bindAttribute(element, "title", descriptionKey);
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

  function placeholder(kind, label = "", presentation = "") {
    const item = document.createElement("span");
    item.className = "tf-rich-placeholder";
    const image = kind === "img" || kind === "image";
    item.dataset.richResourceKind = image ? "image" : "audio";
    if (presentation) item.dataset.richPresentation = presentation;
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
