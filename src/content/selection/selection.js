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

    const canonical = app.modules.selectionSourceSnapshot.canonicalize(range.cloneRange(), current.toString().replace(/[\t\n\r\f ]+/gu, " ").replace(/^ +| +$/gu, ""));
    const text = canonical.text;
    if (!isEligibleText(text)) return null;

    const clonedRange = canonical.range;
    const rect = getRangeRect(clonedRange);
    if (!rect) return null;
    const rangeIdentity = app.modules.selectionSourceSnapshot.freezeRange(clonedRange);

    return {
      text,
      range: clonedRange,
      rangeIdentity,
      rect,
      sourceRevision: app.modules.textProjection.revision(),
      pageUrl: location.href
    };
  }

  function isEligibleText(text) {
    const normalized = cleanText(text);
    if (normalized.length < 2 || normalized.length > 2000) return false;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(normalized)) return false;

    const latin = (normalized.match(/[A-Za-z]/g) || []).length;
    if (latin === 0) {
      // Match the background classifier's NFKC key before deciding whether this
      // is a short local CJK headword. Compatibility punctuation such as U+FF61
      // must not pass the content gate and then become a translation request.
      const canonical = normalized.normalize("NFKC").trim().replace(/\s+/gu, " ");
      if (/[A-Za-z]/u.test(canonical)) return false;
      const cjk = (canonical.match(/[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff]/g) || []).length;
      const hasKana = /[\u3040-\u30ff\u31f0-\u31ff]/u.test(canonical);
      const maxCjkHeadwordLength = hasKana ? 24 : 6;
      return cjk >= 2
        && canonical.length <= maxCjkHeadwordLength
        && !/\s/u.test(canonical)
        && !/[。！？!?]/u.test(canonical);
    }

    const cjk = (normalized.match(/[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff]/g) || []).length;
    const letters = latin + cjk;
    return latin >= 2 && letters >= 2 && latin / letters >= 0.35;
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
    let el = node instanceof Element ? node : node?.parentElement;
    for (let depth = 0; el && depth < 500; depth++, el = el.parentElement || el.getRootNode?.().host) {
      if (el.hasAttribute?.(EXTENSION_UI_ATTR)) return true;
    }
    return false;
  }

  function installInteractionIsolation(node) {
    if (!(node instanceof EventTarget)) return;
    for (const type of ["pointerdown", "mousedown", "click"]) {
      node.addEventListener(type, clearPageSelection, true);
    }
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
      node.addEventListener(type, stopInteractionPropagation);
    }
  }

  function clearPageSelection() {
    const selection = window.getSelection?.();
    if (selection?.rangeCount) selection.removeAllRanges();
  }

  function stopInteractionPropagation(event) {
    event.stopPropagation();
  }

  app.modules.selection = {
    readSelection,
    isEligibleText,
    getRangeRect,
    refreshRect,
    isExtensionOwnedNode,
    installInteractionIsolation,
    clearPageSelection
  };
})();
