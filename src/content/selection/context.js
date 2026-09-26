(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.selection || app.modules.selectionContext) return;

  const { constants, cleanText } = app.modules.runtime;
  const { EXTENSION_UI_ATTR } = constants;
  const DEFAULT_MAX_CHARS = 900;

  function captureSelectionContext(snapshot, { maxChars = DEFAULT_MAX_CHARS } = {}) {
    const range = snapshot?.range;
    if (!range || !snapshot?.text) {
      return { text: "", sensitive: false, source: "none", truncated: false };
    }

    if (isSensitiveRange(range, snapshot.text)) {
      return { text: "", sensitive: true, source: "selection-only", truncated: false };
    }

    const root = contextRoot(range);
    if (!root) return { text: "", sensitive: false, source: "none", truncated: false };

    const visibleText = collectVisibleText(root);
    if (!visibleText) return { text: "", sensitive: false, source: "none", truncated: false };

    const bounded = boundAroundSelection(visibleText, snapshot.text, maxChars);
    return {
      text: bounded.text,
      sensitive: false,
      source: "visible-local",
      truncated: bounded.truncated
    };
  }

  function isSensitiveRange(range, selectedText = "") {
    const nodes = [
      range.commonAncestorContainer,
      range.startContainer,
      range.endContainer
    ];
    for (const node of nodes) {
      const element = node instanceof Element ? node : node?.parentElement;
      if (isSensitiveElement(element)) return true;
    }

    const active = document.activeElement;
    if (isSensitiveElement(active)) {
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const start = Number(active.selectionStart);
        const end = Number(active.selectionEnd);
        if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
          const value = cleanText(active.value.slice(start, end));
          if (value && value === cleanText(selectedText)) return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }

  function isSensitiveElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.closest("input, textarea, select")) return true;
    const editable = element.closest("[contenteditable]");
    return Boolean(editable && editable.getAttribute("contenteditable") !== "false");
  }

  function contextRoot(range) {
    const start = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer?.parentElement;
    const end = range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer?.parentElement;

    const selector = [
      "p", "li", "blockquote", "dd", "dt", "figcaption",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "pre", "article", "section", "main"
    ].join(",");

    const startRoot = start?.closest?.(selector);
    const endRoot = end?.closest?.(selector);
    if (startRoot && startRoot === endRoot) return startRoot;

    const common = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    if (common?.matches?.(selector)) return common;
    return common?.closest?.(selector) || startRoot || endRoot || common;
  }

  function collectVisibleText(root) {
    if (!(root instanceof Element) || root.closest?.(`[${EXTENSION_UI_ATTR}]`)) return "";

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = cleanText(node.nodeValue);
        if (!text) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest(`[${EXTENSION_UI_ATTR}]`)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("script, style, noscript, template, input, textarea, select, option")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest("[aria-hidden='true'], [hidden]")) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const parts = [];
    let node;
    while ((node = walker.nextNode())) parts.push(cleanText(node.nodeValue));
    return cleanText(parts.join(" "));
  }

  function boundAroundSelection(text, selectionText, maxChars) {
    const normalized = cleanText(text);
    const selection = cleanText(selectionText);
    if (normalized.length <= maxChars) return { text: normalized, truncated: false };

    const index = selection ? normalized.indexOf(selection) : -1;
    const center = index >= 0 ? index + Math.floor(selection.length / 2) : Math.floor(normalized.length / 2);
    let start = Math.max(0, center - Math.floor(maxChars / 2));
    let end = Math.min(normalized.length, start + maxChars);
    start = Math.max(0, end - maxChars);

    const bounded = cleanText(normalized.slice(start, end));
    return { text: bounded, truncated: start > 0 || end < normalized.length };
  }

  app.modules.selectionContext = {
    captureSelectionContext,
    isSensitiveRange
  };
})();