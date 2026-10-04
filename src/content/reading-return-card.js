(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract ||
      !app?.modules.textProjection || !app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingReturnCard) return;
  const C = app.modules.readingContract, M = C.READING_METHOD;
  const locale = app.modules.contentI18n;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;
  let card = null, quoteNode = null, overlays = [], activeRange = null, activeText = "", controller = null, frame = 0, previousFocus = null, summary = null;
  let projectionUnsubscribe = null, mutationTimer = 0, automaticRetries = 0, locationGeneration = 0, dismissed = false;
  const messages = {
    locating: "content.reading.locating",
    resolved: "content.reading.resolved",
    ambiguous: "content.reading.ambiguous",
    missing: "content.reading.missing",
    "not-loaded": "content.reading.notLoaded",
    unsupported: "content.reading.unsupportedLocation",
    error: "content.reading.locationError"
  };
  function setLocalizedStatus(node, key, kind) { setStatus(node, "", kind); locale.bindText(node, key); }
  const onKeyDown = event => { if (card && event.key === "Escape") close(); };
  const onNavigation = () => close();
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content");
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code });
    return response.data;
  }
  function clearOverlays() {
    for (const node of overlays) node.remove(); overlays = []; activeRange = null; activeText = "";
    if (quoteNode) { quoteNode.textContent = ""; quoteNode.hidden = true; }
  }
  function updateOverlays() {
    frame = 0;
    if (!activeRange || !activeRange.startContainer.isConnected || !activeRange.endContainer.isConnected || activeText !== summary.anchor.quote.exact) {
      clearOverlays(); if (card) { card.dataset.state = "missing"; setLocalizedStatus(card.querySelector('[data-role="location-status"]'), messages.missing, "error"); } return;
    }
    const rects = [...activeRange.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).slice(0, 12);
    while (overlays.length > rects.length) overlays.pop().remove();
    const layer = app.modules.uiHost.getLayer("reading-return-highlight");
    rects.forEach((rect, index) => {
      const node = overlays[index] || document.createElement("div");
      node.className = "tf-reading-return-highlight";
      Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      if (!overlays[index]) { overlays[index] = node; layer.appendChild(node); }
    });
  }
  function scheduleOverlay() { if (!frame && activeRange) frame = requestAnimationFrame(updateOverlays); }
  function cleanup() {
    locationGeneration++;
    controller?.abort(); controller = null; cancelAnimationFrame(frame); frame = 0; clearOverlays();
    projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(mutationTimer); mutationTimer = 0;
    window.removeEventListener("scroll", scheduleOverlay, true); window.removeEventListener("resize", scheduleOverlay);
  }
  function close() {
    dismissed = true;
    cleanup(); document.removeEventListener("keydown", onKeyDown); locale.unbindTree(card); card?.remove(); card = null;
    quoteNode = null; summary = null;
    window.removeEventListener("popstate", close); window.removeEventListener("hashchange", close);
    globalThis.navigation?.removeEventListener?.("navigate", onNavigation);
    if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null;
  }
  function renderCard() {
    if (card?.isConnected) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card = surface({ className: "tf-reading-return-card", role: "dialog" }); locale.bindAttribute(card, "aria-label", "content.reading.returnAria");
    const header = document.createElement("header"), title = document.createElement("h2"), closeButton = button({ text: "×", label: locale.t("content.reading.closeReturn"), icon: true });
    locale.bindText(title, "content.reading.returnTitle"); locale.bindAttribute(closeButton, "aria-label", "content.reading.closeReturn"); closeButton.addEventListener("click", close); header.append(title, closeButton);
    quoteNode = document.createElement("blockquote"); quoteNode.hidden = true;
    const state = status({ className: "tf-reading-return-status" }); state.dataset.role = "location-status";
    const actions = document.createElement("div"); actions.className = "tf-reading-return-actions";
    const retry = button({ text: locale.t("content.reading.retryLocate") }); locale.bindText(retry, "content.reading.retryLocate"); retry.dataset.action = "retry"; retry.addEventListener("click", event => { if (event.isTrusted) void locate(state); });
    const open = button({ text: locale.t("content.reading.openRecord") }); locale.bindText(open, "content.reading.openRecord"); open.dataset.action = "open-record";
    open.addEventListener("click", event => { if (event.isTrusted) void send(M.OPEN_LEARNING_CENTER, { recordId: summary.recordId }).catch(() => setLocalizedStatus(state, messages.error, "error")); });
    actions.append(retry, open); card.append(header, quoteNode, state, actions); app.modules.uiHost.getLayer("reading-return-card").appendChild(card);
    document.addEventListener("keydown", onKeyDown);
    closeButton.focus(); return state;
  }
  async function locate(state = card?.querySelector('[data-role="location-status"]')) {
    cleanup(); const current = ++locationGeneration, ownController = new AbortController(); controller = ownController;
    setLocalizedStatus(state, messages.locating, "loading"); card.dataset.state = "locating";
    try {
      const result = await app.modules.readingAnchorResolver.resolve(summary.anchor, { signal: ownController.signal });
      if (current !== locationGeneration || ownController.signal.aborted || controller !== ownController || !card || !summary) return;
      card.dataset.state = result.status; setLocalizedStatus(state, messages[result.status] || messages.error, result.status === "resolved" ? "success" : result.status === "ambiguous" ? "warning" : "error");
      if (result.status === "resolved" && result.range) {
        if (!result.range.startContainer.isConnected || !result.range.endContainer.isConnected ||
            result.verifiedText !== summary.anchor.quote.exact) {
          card.dataset.state = "missing"; setLocalizedStatus(state, messages.missing, "error"); return;
        }
        activeRange = result.range; activeText = result.verifiedText;
        quoteNode.textContent = activeText; quoteNode.hidden = false;
        window.addEventListener("scroll", scheduleOverlay, true); window.addEventListener("resize", scheduleOverlay);
        const element = result.range.commonAncestorContainer.nodeType === 1 ? result.range.commonAncestorContainer : result.range.commonAncestorContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        updateOverlays();
        projectionUnsubscribe = app.modules.textProjection.start(() => {
          if (!activeRange || !card) return;
          projectionUnsubscribe?.(); projectionUnsubscribe = null;
          clearOverlays(); card.dataset.state = "not-loaded"; setLocalizedStatus(state, messages["not-loaded"], "warning");
          if (automaticRetries >= C.READING_LIMITS.scanRetryCount || mutationTimer) return;
          mutationTimer = setTimeout(() => { mutationTimer = 0; automaticRetries++; void locate(); }, C.READING_LIMITS.mutationDebounceMs);
        });
      }
    } catch (error) { if (current === locationGeneration && controller === ownController && error?.name !== "AbortError" && card) {
      card.dataset.state = "error"; setLocalizedStatus(state, messages.error, "error");
    } }
  }
  async function start() {
    const handoff = await app.modules.readingHandoff.ready;
    if (dismissed || handoff.state !== "consumed") return { state: "closed" };
    summary = handoff.summary; const state = renderCard(); await locate(state); return { state: card?.dataset.state || "closed" };
  }
  window.addEventListener("pagehide", close, { once: true });
  window.addEventListener("popstate", close); window.addEventListener("hashchange", close);
  globalThis.navigation?.addEventListener?.("navigate", onNavigation);
  const ready = start();
  app.modules.readingReturnCard = Object.freeze({ ready, close });
})();
