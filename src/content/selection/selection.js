(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.selection) return;

  const { constants, cleanText } = app.modules.runtime;
  const { EXTENSION_UI_ATTR } = constants;

  function readSelection() {
    const current = window.getSelection();
    if (!current || current.rangeCount === 0 || current.isCollapsed) return null;

    const range = current.getRangeAt(0);
    if (isExtensionOwnedNode(range.commonAncestorContainer)) return null;

    const text = cleanText(current.toString());
    if (!isEligibleText(text)) return null;

    const clonedRange = range.cloneRange();
    const rect = getRangeRect(clonedRange);
    if (!rect) return null;

    return {
      text,
      range: clonedRange,
      rect,
      pageUrl: location.href
    };
  }

  function isEligibleText(text) {
    const normalized = cleanText(text);
    if (normalized.length < 2 || normalized.length > 2000) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(normalized)) return false;

    const latin = (normalized.match(/[A-Za-z]/g) || []).length;
    const cjk = (normalized.match(/[\u3400-\u9fff]/g) || []).length;
    const letters = latin + cjk;
    if (latin < 2 || letters < 2) return false;
    return latin / letters >= 0.35;
  }

  function getRangeRect(range) {
    if (!range) return null;
    let rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;

    const rects = range.getClientRects();
    if (!rects?.length) return null;
    rect = rects[rects.length - 1];
    return rect && (rect.width > 0 || rect.height > 0) ? rect : null;
  }

  function refreshRect(snapshot) {
    const rect = getRangeRect(snapshot?.range);
    if (!rect) return snapshot?.rect || null;
    snapshot.rect = rect;
    return rect;
  }

  function isExtensionOwnedNode(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    return Boolean(el?.closest?.(`[${EXTENSION_UI_ATTR}]`));
  }

  app.modules.selection = {
    readSelection,
    isEligibleText,
    getRangeRect,
    refreshRect,
    isExtensionOwnedNode
  };
})();
