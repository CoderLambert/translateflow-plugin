(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.structured) return;

  const { constants, cleanText } = app.modules.runtime;
  const { TRANSLATION_CLASS, EXTENSION_UI_ATTR } = constants;
  const TAGS = Object.freeze({
    A: "a", STRONG: "strong", B: "strong", EM: "em", I: "em",
    CODE: "code", KBD: "kbd", MARK: "mark"
  });
  const MARKER_RE = /⟦TF:(\d+):(S|E)⟧/g;

  function encodeElement(root) {
    const descriptors = [];
    let rich = false;
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
      if (!(node instanceof Element)) return "";
      if (node.matches(`.${TRANSLATION_CLASS}, [${EXTENSION_UI_ATTR}]`)) return "";
      const tag = TAGS[node.tagName];
      if (!tag) return [...node.childNodes].map(walk).join("");
      rich = true;
      const id = descriptors.length;
      const descriptor = { tag };
      if (tag === "code" || tag === "kbd") descriptor.protectedText = String(node.textContent || "");
      if (tag === "a") {
        const href = safeHref(node.getAttribute("href"));
        if (href) descriptor.href = href;
        const title = String(node.getAttribute("title") || "").trim();
        if (title) descriptor.title = title.slice(0, 500);
      }
      descriptors.push(descriptor);
      return `⟦TF:${id}:S⟧${[...node.childNodes].map(walk).join("")}⟦TF:${id}:E⟧`;
    }
    const encoded = [...root.childNodes].map(walk).join("");
    return { text: rich ? cleanTextPreservingMarkers(encoded) : cleanText(encoded), rich, descriptors };
  }

  function renderTranslation(translation, structured) {
    const text = String(translation || "");
    if (!structured?.rich || !Array.isArray(structured.descriptors)) return document.createTextNode(text);
    try { return renderMarked(text, structured.descriptors); }
    catch { return document.createTextNode(stripMarkers(text)); }
  }

  function renderMarked(text, descriptors) {
    const fragment = document.createDocumentFragment();
    const stack = [{ id: -1, node: fragment }];
    let last = 0;
    MARKER_RE.lastIndex = 0;
    let match;
    while ((match = MARKER_RE.exec(text))) {
      appendText(stack.at(-1).node, text.slice(last, match.index));
      const id = Number(match[1]);
      const kind = match[2];
      const descriptor = descriptors[id];
      if (!descriptor) throw new Error("unknown marker");
      if (kind === "S") {
        const node = document.createElement(descriptor.tag);
        if (descriptor.tag === "a") {
          if (descriptor.href) node.setAttribute("href", descriptor.href);
          if (descriptor.title) node.setAttribute("title", descriptor.title);
        }
        stack.at(-1).node.appendChild(node);
        stack.push({ id, node });
      } else {
        if (stack.length < 2 || stack.at(-1).id !== id) throw new Error("unbalanced marker");
        const current = stack.pop();
        if (descriptor.protectedText != null) {
          current.node.replaceChildren(document.createTextNode(descriptor.protectedText));
        }
      }
      last = MARKER_RE.lastIndex;
    }
    appendText(stack.at(-1).node, text.slice(last));
    if (stack.length !== 1) throw new Error("unclosed marker");
    if (/⟦TF:[^⟧]*⟧/.test(fragment.textContent || "")) throw new Error("malformed marker");
    return fragment;
  }

  function appendText(parent, text) { if (text) parent.appendChild(document.createTextNode(text)); }
  function stripMarkers(text) { return String(text || "").replace(/⟦TF:[^⟧]*⟧/g, ""); }
  function safeHref(raw) {
    const value = String(raw || "").trim();
    if (!value || /^(?:javascript|data|vbscript):/i.test(value)) return "";
    return value;
  }
  function cleanTextPreservingMarkers(text) { return String(text || "").replace(/[\t\r\n ]+/g, " ").trim(); }

  app.modules.structured = {
    encodeElement, renderTranslation, stripMarkers, safeHref,
    supportedTags: Object.freeze([...new Set(Object.values(TAGS))])
  };
})();
