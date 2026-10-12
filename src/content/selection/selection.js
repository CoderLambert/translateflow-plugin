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

  function positionPopover({ snapshot, element, panel }) {
    const rect = refreshRect(snapshot);
    if (!rect || !element) return;
    const viewport = window.visualViewport;
    const margin = 8, viewportLeft = viewport?.offsetLeft || 0, viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || window.innerWidth, viewportHeight = viewport?.height || window.innerHeight;
    const bounds = { left: viewportLeft + margin, top: viewportTop + margin,
      right: viewportLeft + viewportWidth - margin, bottom: viewportTop + viewportHeight - margin };
    const availableWidth = Math.max(0, bounds.right - bounds.left), availableHeight = Math.max(0, bounds.bottom - bounds.top);
    element.style.maxWidth = `${Math.floor(availableWidth)}px`;
    element.style.maxHeight = `${Math.floor(availableHeight)}px`;
    if (element === panel) element.style.width = `${Math.floor(Math.min(500, availableWidth))}px`;
    requestAnimationFrame(() => {
      if (!element?.isConnected) return;
      const box = element.getBoundingClientRect();
      let left = Math.max(bounds.left, rect.left), top = rect.bottom + 8;
      if (left + box.width > bounds.right) left = Math.max(bounds.left, bounds.right - box.width);
      if (top + box.height > bounds.bottom) {
        const above = rect.top - box.height - 8;
        top = above >= bounds.top ? above : bounds.top;
      }
      if (top < bounds.top) top = bounds.top;
      element.style.left = `${Math.round(left)}px`; element.style.top = `${Math.round(top)}px`;
      requestAnimationFrame(() => clampPopoverRect(element, panel, bounds, availableWidth, availableHeight, 0));
    });
  }

  function clampPopoverRect(element, panel, bounds, availableWidth, availableHeight, attempt) {
    if (!element?.isConnected) return;
    const actual = element.getBoundingClientRect(), scaleX = actual.width / Math.max(1, element.offsetWidth),
      scaleY = actual.height / Math.max(1, element.offsetHeight);
    let resized = false;
    if (element === panel && actual.width > availableWidth + 0.5) {
      element.style.width = `${Math.max(1, Math.floor(availableWidth / Math.max(scaleX, 0.01)))}px`; resized = true;
    }
    if (actual.height > availableHeight + 0.5) {
      element.style.maxHeight = `${Math.max(1, Math.floor(availableHeight / Math.max(scaleY, 0.01)))}px`; resized = true;
    }
    if (resized && attempt < 2) {
      requestAnimationFrame(() => clampPopoverRect(element, panel, bounds, availableWidth, availableHeight, attempt + 1)); return;
    }
    const currentLeft = Number.parseFloat(element.style.left) || 0, currentTop = Number.parseFloat(element.style.top) || 0;
    let deltaX = 0, deltaY = 0;
    if (actual.left < bounds.left) deltaX = bounds.left - actual.left;
    else if (actual.right > bounds.right) deltaX = bounds.right - actual.right;
    if (actual.top < bounds.top) deltaY = bounds.top - actual.top;
    else if (actual.bottom > bounds.bottom) deltaY = bounds.bottom - actual.bottom;
    if (Math.abs(deltaX) > 0.5) element.style.left = `${Math.round(currentLeft + deltaX / Math.max(scaleX, 0.01))}px`;
    if (Math.abs(deltaY) > 0.5) element.style.top = `${Math.round(currentTop + deltaY / Math.max(scaleY, 0.01))}px`;
    if ((Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) && attempt < 2) {
      requestAnimationFrame(() => clampPopoverRect(element, panel, bounds, availableWidth, availableHeight, attempt + 1));
    }
  }

  app.modules.selection = {
    readSelection,
    isEligibleText,
    getRangeRect,
    refreshRect,
    isExtensionOwnedNode,
    installInteractionIsolation,
    clearPageSelection,
    positionPopover
  };
})();
