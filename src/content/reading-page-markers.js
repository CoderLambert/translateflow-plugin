(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract || !app?.modules.textProjection || !app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { button, surface } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  let generation = 0, previewEpoch = 0, controller = null, root = null, panel = null, panelReturnFocus = null, preview = null,
    markerNodes = [], ranges = new Map(), projectionUnsubscribe = null, timer = 0, port = null, portReady = false,
    portReadyPromise = null, resolvePortReady = null, lastInvalidation = null;
  // The automatic retry budget belongs to this document's content-script lifetime.
  // Focus, manual retries, and SPA route changes do not replenish it.
  let automaticRetries = 0, lastItems = [], lastPageRecordCount = 0, renderProjectionRevision = null, lastMarkerEnabled = false;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code }); return response.data;
  }
  function clearUi() { locale.unbindTree(root); root?.remove(); root = panel = panelReturnFocus = null; for (const node of markerNodes) { locale.unbindTree(node); node.remove(); } markerNodes = []; ranges.clear(); renderProjectionRevision = null; }
  function unresolved(items) { return new Map(items.map(item => [item.recordId, { status: "not-loaded", range: null }])); }
  function cleanup() { generation++; closePreview({ restore: false }); controller?.abort(); controller = null; projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(timer); timer = 0;
    lastItems = []; lastPageRecordCount = 0; lastMarkerEnabled = false;
    lastInvalidation = null;
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); }
  function rectFor(range) { try { return [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
    rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) || null; } catch { return null; } }
  function positionMarkers() {
    const current = renderProjectionRevision !== null && app.modules.textProjection.revision() === renderProjectionRevision;
    markerNodes.forEach(node => {
      const range = ranges.get(node.dataset.recordId), rect = current ? rectFor(range) : null;
      if (!rect) { node.hidden = true; return; }
      const size = 14;
      node.hidden = false; node.style.left = `${Math.max(2, Math.min(innerWidth - size - 2, rect.right + 5))}px`;
      node.style.top = `${Math.max(2, Math.min(innerHeight - size - 2, rect.top + (rect.height - size) / 2))}px`;
    });
  }
  function showPanel(focusId = null) { if (!panel) return; if (panel.hidden) panelReturnFocus = root.getRootNode().activeElement || document.activeElement;
    panel.hidden = false; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "true");
    const target = focusId ? panel.querySelector(`[data-record-id="${focusId}"] .tf-reading-page-item`) : panel.querySelector("button");
    queueMicrotask(() => { if (!panel?.hidden && target?.isConnected) target.focus({ preventScroll: true }); }); }
  function hidePanel() { if (!panel) return; panel.hidden = true; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "false");
    const target = panelReturnFocus; panelReturnFocus = null; if (target?.isConnected) target.focus(); }
  function closePreview({ notify = true, restore = true } = {}) {
    previewEpoch++;
    const active = preview; if (!active) return;
    preview = null; clearTimeout(active.timeout); window.removeEventListener("message", active.listener);
    // Keep cleanup tied to the owned browsing context even if page script moves the
    // iframe out of its dialog with Element.moveBefore().
    active.frame.remove(); active.shell.remove();
    if (notify) void send(M.PREVIEW_CLOSE, { previewId: active.previewId }).catch(() => {});
    if (restore) {
      requestAnimationFrame(() => {
        const target = active.returnFocus?.isConnected ? active.returnFocus
          : markerNodes.find(node => node.dataset.recordId === active.recordId);
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    }
  }
  function localLocationCurrent(range, projectionRevision, renderedGeneration) {
    return renderedGeneration === generation && range?.startContainer?.isConnected && range?.endContainer?.isConnected &&
      renderProjectionRevision === projectionRevision && app.modules.textProjection.revision() === projectionRevision;
  }
  async function openPreview(item, range, projectionRevision, renderedGeneration, activationEpoch) {
    if (activationEpoch !== previewEpoch) return;
    if (preview?.recordId === item.recordId && preview.frame.isConnected) { preview.frame.focus({ preventScroll: true }); return; }
    if (preview) { closePreview({ restore: false }); activationEpoch = previewEpoch; }
    let created;
    try {
      created = await send(M.PREVIEW_CREATE, { recordId: item.recordId, expectedRevision: item.revision });
      if (activationEpoch !== previewEpoch || !localLocationCurrent(range, projectionRevision, renderedGeneration)) {
        void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {}); return;
      }
      const shadow = root.getRootNode(), returnFocus = markerNodes.find(node => node.dataset.recordId === item.recordId) || shadow.activeElement || document.activeElement;
      const shell = surface({ className: "tf-reading-preview-shell", role: "dialog" });
      locale.bindAttribute(shell, "aria-label", "content.reading.previewAria");
      const header = document.createElement("header"), heading = document.createElement("strong"), close = button({ text: "×", label: locale.t("content.reading.closePreview"), icon: true });
      locale.bindText(heading, "content.reading.previewTitle"); locale.bindAttribute(close, "aria-label", "content.reading.closePreview");
      close.addEventListener("click", event => { if (event.isTrusted) closePreview(); }); header.append(heading, close);
      const frame = document.createElement("iframe"); frame.className = "tf-reading-preview-frame";
      frame.title = locale.t("content.reading.previewTitle"); frame.referrerPolicy = "no-referrer";
      const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
      const state = { previewId: created.previewId, recordId: item.recordId, shell, frame, listener: null, timeout: 0, returnFocus };
      state.listener = async event => {
        if (!event.isTrusted || event.source !== frame.contentWindow || event.origin !== extensionOrigin ||
            !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) return;
        const message = event.data;
        if (message.type === "translateflow-reading-preview-close" && Object.keys(message).length === 2 && message.previewId === state.previewId) {
          closePreview(); return;
        }
        if (message.type !== "translateflow-reading-preview-claim" || Object.keys(message).length !== 3 ||
            message.previewId !== state.previewId || typeof message.claimId !== "string" || preview !== state) return;
        try {
          const bound = await send(M.PREVIEW_BIND, { previewId: state.previewId, claimId: message.claimId });
          if (preview !== state || bound.bound !== true || !localLocationCurrent(range, projectionRevision, renderedGeneration)) {
            if (preview === state) closePreview(); return;
          }
          clearTimeout(state.timeout);
          frame.contentWindow?.postMessage({ type: "translateflow-reading-preview-bound", previewId: state.previewId,
            claimId: message.claimId }, extensionOrigin);
        } catch { if (preview === state) { closePreview(); showPanel(item.recordId); } }
      };
      preview = state; window.addEventListener("message", state.listener);
      shell.append(header, frame); app.modules.uiHost.getLayer("reading-page-preview").appendChild(shell);
      frame.src = `${chrome.runtime.getURL("reading-preview.html")}?previewId=${encodeURIComponent(state.previewId)}`;
      state.timeout = setTimeout(() => { if (preview === state) { closePreview(); showPanel(item.recordId); } }, 14_000);
    } catch {
      if (created?.previewId) void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {});
      if (activationEpoch === previewEpoch && renderedGeneration === generation) showPanel(item.recordId);
    }
  }
  async function openRecord(recordId) { try { await send(M.OPEN_LEARNING_CENTER, { recordId }); } catch {} }
  async function confirmListedItem(item, renderedGeneration) {
    try {
      const markers = await send(M.GET_SITE_MARKERS);
      if (renderedGeneration !== generation || markers.state !== "ready" || !markers.enabled) return false;
      let cursor = null, latest = null, requests = 0;
      do {
        const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 });
        if (renderedGeneration !== generation) return false;
        latest = page.items.find(value => value.recordId === item.recordId) || latest;
        cursor = page.nextCursor; requests++;
      } while (!latest && cursor && requests < 2);
      return renderedGeneration === generation && latest?.revision === item.revision &&
        JSON.stringify(latest?.anchor) === JSON.stringify(item.anchor);
    } catch { return false; }
  }
  async function confirmCurrentItem(item, range, projectionRevision, renderedGeneration) {
    if (!(await confirmListedItem(item, renderedGeneration))) return false;
    const currentRange = ranges.get(item.recordId);
    return renderedGeneration === generation && currentRange === range &&
      range?.startContainer?.isConnected && range?.endContainer?.isConnected &&
      renderProjectionRevision === projectionRevision && app.modules.textProjection.revision() === projectionRevision;
  }
  async function checkedAction(item, range, projectionRevision, renderedGeneration, action) {
    if (await confirmCurrentItem(item, range, projectionRevision, renderedGeneration)) action();
    else if (renderedGeneration === generation) void load();
  }
  async function checkedListedAction(item, renderedGeneration, action) {
    if (await confirmListedItem(item, renderedGeneration)) action();
    else if (renderedGeneration === generation) void load();
  }
  function render(items, locations, pageRecordCount, projectionRevision = null, unavailable = false) {
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); root = document.createElement("div"); root.className = "tf-reading-page-history";
    const renderedGeneration = generation;
    renderProjectionRevision = projectionRevision;
    const toggleKey = unavailable ? "content.reading.pageUnavailable" : "content.reading.pageCount";
    const toggleArgs = unavailable ? {} : { count: pageRecordCount };
    const toggle = button({ text: locale.t(toggleKey, toggleArgs), className: "tf-reading-page-toggle" }); locale.bindText(toggle, toggleKey, toggleArgs); toggle.setAttribute("aria-expanded", "false");
    panel = surface({ className: "tf-reading-page-panel", role: "dialog" }); panel.hidden = true; locale.bindAttribute(panel, "aria-label", "content.reading.pageAria");
    const header = document.createElement("header"), title = document.createElement("strong"), retry = button({ text: locale.t("content.reading.retryPosition"), className: "tf-reading-page-retry" }), close = button({ text: "×", label: locale.t("content.reading.closePage"), icon: true });
    locale.bindText(retry, "content.reading.retryPosition"); locale.bindAttribute(close, "aria-label", "content.reading.closePage");
    retry.addEventListener("click", event => { if (event.isTrusted) void load(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); hidePanel(); } });
    locale.bindText(title, pageRecordCount > items.length ? "content.reading.pageLoadedTitle" : "content.reading.pageTitle", pageRecordCount > items.length ? { loaded: items.length, total: pageRecordCount } : {}); close.addEventListener("click", hidePanel); header.append(title, retry, close); panel.appendChild(header);
    for (const [index, item] of items.entries()) {
      const location = locations.get(item.recordId) || { status: "not-loaded" }, row = document.createElement("article"); row.dataset.recordId = item.recordId;
      const locate = button({ text: locale.t("content.reading.locateItem", { index: index + 1 }), className: "tf-reading-page-item" }); locale.bindText(locate, "content.reading.locateItem", { index: index + 1 }); locate.dataset.recordId = item.recordId;
      const rangeIsCurrent = location.status === "resolved" && location.range?.startContainer?.isConnected && location.range?.endContainer?.isConnected &&
        location.verifiedText === item.anchor.quote.exact;
      const locationStatus = location.status === "resolved" && !rangeIsCurrent ? "not-loaded" : location.status;
      const state = document.createElement("span"); locale.bindText(state, ({ resolved: "content.reading.statusResolved", ambiguous: "content.reading.statusAmbiguous", missing: "content.reading.statusMissing", "not-loaded": "content.reading.statusNotLoaded", unsupported: "content.reading.statusUnsupported" })[locationStatus] || "content.reading.statusUnavailable");
      locate.addEventListener("click", () => { const range = ranges.get(item.recordId); if (range?.startContainer.isConnected) { const element = range.startContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } });
      const open = button({ text: locale.t("content.reading.viewRecord") }); locale.bindText(open, "content.reading.viewRecord"); open.addEventListener("click", event => {
        if (event.isTrusted) void checkedListedAction(item, renderedGeneration, () => void openRecord(item.recordId));
      });
      row.append(locate, state, open); panel.appendChild(row);
      if (rangeIsCurrent) {
        ranges.set(item.recordId, location.range); const marker = button({ text: "", label: locale.t("content.reading.markerLocated", { index: index + 1 }), className: "tf-reading-page-marker" });
        locale.bindAttribute(marker, "aria-label", "content.reading.markerLocated", { index: index + 1 });
        locale.bindAttribute(marker, "title", "content.reading.markerHint"); marker.dataset.recordId = item.recordId;
        marker.addEventListener("click", event => {
          if (!event.isTrusted) return;
          const activationEpoch = ++previewEpoch;
          void checkedAction(item, location.range, projectionRevision, renderedGeneration, () => {
            if (activationEpoch === previewEpoch) void openPreview(item, location.range, projectionRevision, renderedGeneration, activationEpoch);
          });
        });
        markerNodes.push(marker); app.modules.uiHost.getLayer("reading-page-markers").appendChild(marker);
      }
    }
    const locatedCount = items.filter(item => {
      const location = locations.get(item.recordId);
      return location?.status === "resolved" && location.range?.startContainer?.isConnected &&
        location.range?.endContainer?.isConnected && location.verifiedText === item.anchor.quote.exact;
    }).length;
    const summary = document.createElement("p"); summary.setAttribute("role", "status");
    locale.bindText(summary, unavailable ? "content.reading.pageSummaryUnavailable"
      : pageRecordCount > C.READING_LIMITS.pageMarkers ? "content.reading.pageSummaryLimited" : "content.reading.pageSummary", unavailable ? {}
        : pageRecordCount > C.READING_LIMITS.pageMarkers
          ? { total: pageRecordCount, loaded: items.length, located: locatedCount, limit: C.READING_LIMITS.pageMarkers }
          : { total: pageRecordCount, loaded: items.length, located: locatedCount });
    panel.appendChild(summary);
    toggle.addEventListener("click", () => panel.hidden ? showPanel() : hidePanel()); root.append(toggle, panel); app.modules.uiHost.getLayer("reading-page-history").appendChild(root); positionMarkers();
    window.addEventListener("scroll", positionMarkers, true); window.addEventListener("resize", positionMarkers);
  }
  async function load({ register = false } = {}) {
    const current = ++generation; controller?.abort(); const ownController = new AbortController(); controller = ownController;
    projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(timer); timer = 0;
    if (lastItems.length) render(lastItems, unresolved(lastItems), lastPageRecordCount);
    else clearUi();
    try {
      if (register) await app.modules.readingHandoff.register(); else await app.modules.readingHandoff.ready;
      if (current !== generation || ownController.signal.aborted) return;
      const markerState = await send(M.GET_SITE_MARKERS); if (current !== generation || ownController.signal.aborted) return;
      lastMarkerEnabled = markerState.state === "ready" && markerState.enabled;
      if (!lastMarkerEnabled) { closePreview({ restore: false }); lastItems = []; lastPageRecordCount = 0; clearUi(); return; }
      const items = []; let cursor = null, count = 0;
      let summaryRequests = 0;
      do { const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 }); summaryRequests++;
        if (current !== generation || ownController.signal.aborted) return;
        items.push(...page.items); cursor = page.nextCursor; count = page.pageRecordCount;
      } while (cursor && items.length < C.READING_LIMITS.pageMarkers && summaryRequests < 2);
      if (current !== generation || ownController.signal.aborted) return;
      if (!items.length) { closePreview({ restore: false }); lastItems = []; lastPageRecordCount = count; clearUi(); return; }
      const limited = items.slice(0, C.READING_LIMITS.pageMarkers);
      lastItems = limited; lastPageRecordCount = count; render(limited, unresolved(limited), count);
      const locations = await app.modules.readingAnchorResolver.resolvePage(limited, { signal: ownController.signal });
      if (current !== generation || ownController.signal.aborted) return;
      render(limited, locations, count, locations.projectionRevision);
      projectionUnsubscribe = app.modules.textProjection.start(() => {
        projectionUnsubscribe?.(); projectionUnsubscribe = null;
        closePreview({ restore: false });
        // The source projection is stale. Drop every old Range immediately but keep the
        // generic list and its manual retry action visible after auto retries end.
        render(lastItems, unresolved(lastItems), lastPageRecordCount);
        if (!timer && automaticRetries < C.READING_LIMITS.scanRetryCount) timer = setTimeout(() => {
          timer = 0; automaticRetries++; void load();
        }, C.READING_LIMITS.mutationDebounceMs);
      });
    } catch { if (current === generation) {
      closePreview({ restore: false });
      if (lastItems.length) render(lastItems, unresolved(lastItems), lastPageRecordCount);
      else if (lastMarkerEnabled) render([], new Map(), null, null, true);
      else clearUi();
    } }
  }
  function connect() {
    if (port) return portReadyPromise || Promise.resolve();
    try {
      port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT });
      const ownedPort = port;
      portReady = false;
      portReadyPromise = new Promise(resolve => { resolvePortReady = resolve; });
      port.onMessage.addListener(value => {
        if (port !== ownedPort) return;
        try {
          if (!portReady) {
            if (value?.type === "reading.site-markers.invalidate") {
              C.validateReadingSiteMarkersInvalidation(value);
              return; // The startup load reads the current site marker state after this handshake.
            }
            lastInvalidation = C.validateReadingInvalidation(value, "content");
            portReady = true; resolvePortReady?.(); resolvePortReady = null;
            return; // The initial revision handshake is consumed before any markers render.
          }
          if (value?.type === "reading.site-markers.invalidate") {
            C.validateReadingSiteMarkersInvalidation(value);
            closePreview({ restore: false }); void load(); return;
          }
          const next = C.validateReadingInvalidation(value, "content"), previous = lastInvalidation;
          lastInvalidation = next;
          if (previous && previous.dataGeneration === next.dataGeneration && previous.consentGeneration === next.consentGeneration &&
              previous.pageRevision === next.pageRevision) return;
          closePreview({ restore: false }); void load();
        } catch { if (port === ownedPort) { closePreview({ restore: false }); void load(); } }
      });
      port.onDisconnect.addListener(() => {
        if (port !== ownedPort) return;
        port = null; portReady = false; lastInvalidation = null; resolvePortReady?.(); resolvePortReady = null; portReadyPromise = null; cleanup();
      });
      return portReadyPromise;
    } catch { return Promise.resolve(); }
  }
  const route = () => { cleanup(); timer = setTimeout(() => { timer = 0; void load({ register: true }); }, C.READING_LIMITS.mutationDebounceMs); };
  window.addEventListener("popstate", route); window.addEventListener("hashchange", route); window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("focus", () => {
    if (port) return;
    void load({ register: true }).finally(connect);
  });
  globalThis.navigation?.addEventListener?.("navigate", route);
  const ready = app.modules.readingHandoff.ready.then(async () => { await connect(); return load(); });
  app.modules.readingPageMarkers = Object.freeze({ ready, refresh: load, cleanup });
})();
