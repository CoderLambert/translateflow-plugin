(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.structured) return;

  const { constants, cleanText } = app.modules.runtime;
  const { TRANSLATION_CLASS, EXTENSION_UI_ATTR, SOURCE_EXCLUDED_SELECTOR } = constants;
  const TAGS = Object.freeze({
    A: "a", STRONG: "strong", B: "strong", EM: "em", I: "em",
    CODE: "code", KBD: "kbd", MARK: "mark"
  });
  const MARKER_RE = /⟦TF:(\d+):(S|E)⟧/g;

  function encodeElement(root) {
    const descriptors = [];
    let rich = false;
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return sourceDecision(node.parentElement).action === 'skip-self' ? '' : node.nodeValue || "";
      if (!(node instanceof Element)) return "";
      if (sourceDecision(node).action === 'prune') return "";
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

  function encodeParts(parts) {
    const descriptors = [], opened = []; let text = '';
    const close = () => { const item = opened.pop(); text += `⟦TF:${item.id}:E⟧`; };
    for (const part of parts) {
      const chain = part.marks || [];
      let common = 0;
      while (common < opened.length && opened[common].element === chain[common]) common++;
      while (opened.length > common) close();
      for (const element of chain.slice(common)) {
        const tag = TAGS[element.tagName];
        if (!tag) continue;
        const descriptor = { tag };
        if (tag === 'code' || tag === 'kbd') descriptor.protectedText = '';
        if (tag === 'a') {
          const href = safeHref(element.getAttribute('href'));
          if (href) descriptor.href = href;
          const title = String(element.getAttribute('title') || '').trim();
          if (title) descriptor.title = title.slice(0, 500);
        }
        const id = descriptors.push(descriptor) - 1;
        opened.push({ element, id }); text += `⟦TF:${id}:S⟧`;
      }
      const value = part.node.nodeValue.slice(part.from, part.to);
      text += value;
      for (const { id } of opened) if (descriptors[id].protectedText != null) descriptors[id].protectedText += value;
    }
    while (opened.length) close();
    return { text: cleanTextPreservingMarkers(text), rich: descriptors.length > 0, descriptors };
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
  function isFullyClipped(node, style) {
    // Screen-reader-only content often remains display:block/visibility:visible.
    // Check the actual clipping region, independently of class names or ARIA.
    const rect = style?.clip?.match(/^rect\(([^()]*)\)$/);
    if (rect && ["absolute", "fixed"].includes(style.position)) {
      const edges = rect[1].trim().split(/[,\s]+/).map(value => /^-?[\d.]+px$/.test(value) ? Number.parseFloat(value) : NaN);
      if (edges.length === 4 && edges.every(Number.isFinite) && (edges[2] <= edges[0] || edges[1] <= edges[3])) return true;
    }
    const inset = style?.clipPath?.match(/^inset\(([^()]*)\)$/)?.[1].split(/\s+round\s+/)[0].trim().split(/\s+/);
    if (!inset?.length || inset.length > 4 || inset.some(value => !/^-?(?:0|(?:\d+\.?\d*|\.\d+)(?:px|%))$/.test(value))) return false;
    // Clip lengths use the untransformed border box, not viewport geometry.
    const width = node.offsetWidth, height = node.offsetHeight;
    if (!(width > 0 && height > 0)) return false;
    const [top, right = top, bottom = top, left = right] = inset;
    const pixels = (value, length) => Number.parseFloat(value) * (value.endsWith('%') ? length / 100 : 1);
    return pixels(top, height) + pixels(bottom, height) >= height
      || pixels(left, width) + pixels(right, width) >= width;
  }
  function sourceDecision(node) {
    if (!node) return {action:'pass'};
    const prune = (status, reason) => ({action:'prune', status, reason});
    if (node.matches(`.${TRANSLATION_CLASS}, [${EXTENSION_UI_ATTR}]`)) return prune('excluded','extension-ui');
    if (node.matches('iframe, svg, math, canvas, video, audio')) return prune('unsupported','non-text-surface');
    if (node.matches('[contenteditable]:not([contenteditable="false"])')) return prune('excluded','editable');
    if (node.matches('[translate="no"], .notranslate')) return prune('excluded','no-translate');
    if (node.matches('[hidden]')) return prune('deferred','hidden-attribute');
    if (SOURCE_EXCLUDED_SELECTOR && node.matches(SOURCE_EXCLUDED_SELECTOR)) return prune('excluded','protected-element');
    const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : null;
    if (style?.display === 'none') return prune('deferred','display-none');
    if (style?.opacity === '0' || isFullyClipped(node, style)) return prune('deferred','not-rendered');
    // Visibility is inherited and can be overridden by a descendant. Unlike
    // display:none, it only skips this element's own text, never its subtree.
    if (['hidden','collapse'].includes(style?.visibility)) return {action:'skip-self',status:'deferred',reason:'visibility-hidden'};
    return {action:'pass'};
  }
  const isExcludedNode = node => sourceDecision(node).action !== 'pass';
  function stripMarkers(text) { return String(text || "").replace(/⟦TF:[^⟧]*⟧/g, ""); }
  function safeHref(raw) {
    const value = String(raw || "").trim();
    if (!value || /^(?:javascript|data|vbscript):/i.test(value)) return "";
    return value;
  }
  function cleanTextPreservingMarkers(text) { return String(text || "").replace(/[\t\r\n ]+/g, " ").trim(); }

  app.modules.structured = {
    encodeElement, encodeParts, renderTranslation, stripMarkers, safeHref, isExcludedNode, sourceDecision,
    supportedTags: Object.freeze([...new Set(Object.values(TAGS))])
  };
})();
