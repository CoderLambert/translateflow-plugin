(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract || !app?.modules.textProjection || !app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.uiHost || !app?.modules.uiPrimitives || !app?.modules.selectionRecordAccess || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { button, surface } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  let generation = 0, previewEpoch = 0, controller = null, root = null, panel = null, panelReturnFocus = null, preview = null,
    markerNodes = [], markerGroups = new Map(), recordGroups = new Map(), ranges = new Map(), projectionUnsubscribe = null,
    timer = 0, pulseTimer = 0, hoverOpenTimer = 0, hoverCloseTimer = 0, port = null, portReady = false, portReadyPromise = null, resolvePortReady = null,
    lastInvalidation = null, panelRequestedOpen = false, pendingPanelFocus = null;
  // The automatic retry budget belongs to this document's content-script lifetime.
  // Focus, manual retries, and SPA route changes do not replenish it.
  let automaticRetries = 0, lastItems = [], lastLocations = new Map(), lastPageRecordCount = 0, lastMarkerEnabled = false;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code }); return response.data;
  }
  function clearUi() {
    closeHoverPreview();
    locale.unbindTree(root); root?.remove(); root = panel = panelReturnFocus = null;
    for (const node of markerNodes) { locale.unbindTree(node); node.remove(); }
    for (const group of markerGroups.values()) for (const node of group.highlights) node.remove();
    markerNodes = []; markerGroups.clear(); recordGroups.clear(); ranges.clear();
  }
  function unresolved(items) { return new Map(items.map(item => [item.recordId, { status: "not-loaded", range: null }])); }
  function cleanup() { generation++; controller?.abort(); controller = null; projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(timer); clearTimeout(pulseTimer); clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer); timer = pulseTimer = hoverOpenTimer = hoverCloseTimer = 0;
    lastItems = []; lastLocations = new Map(); lastPageRecordCount = 0; lastMarkerEnabled = false;
    lastInvalidation = null; panelRequestedOpen = false; pendingPanelFocus = null;
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); }
  const markerBlockRoots = "p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main";
  function rectFor(range) { try { return [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
    rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) || null; } catch { return null; } }
  function markerAnchor(range) {
    const line = rectFor(range); if (!line) return null;
    const origin = range.commonAncestorContainer?.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer?.parentElement;
    const block = origin?.closest?.(markerBlockRoots), blockRect = block?.getBoundingClientRect?.();
    return { line, block, rect: blockRect?.width > 0 && blockRect?.height > 0 ? blockRect : line };
  }
  function visibleRects(range) { try { return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
    rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth).slice(0, 16); } catch { return []; } }
  function positionHighlights(group, rects) {
    const layer = app.modules.uiHost.getLayer("reading-page-highlights");
    while (group.highlights.length < rects.length) {
      const node = document.createElement("span"); node.className = "tf-reading-page-highlight"; node.setAttribute("aria-hidden", "true");
      group.highlights.push(node); layer.appendChild(node);
    }
    group.highlights.forEach((node, index) => {
      const rect = rects[index]; node.hidden = !rect;
      if (!rect) return;
      node.style.left = `${Math.max(0, rect.left - 2)}px`; node.style.top = `${Math.max(0, rect.top - 1)}px`;
      node.style.width = `${Math.min(innerWidth - Math.max(0, rect.left - 2), rect.width + 4)}px`; node.style.height = `${rect.height + 2}px`;
    });
  }
  function positionMarkers() {
    markerNodes.forEach(node => {
      const group = markerGroups.get(node.dataset.recordId), range = group?.range, expected = group?.expected;
      let rangeCurrent = false;
      try { rangeCurrent = range?.startContainer?.isConnected && range?.endContainer?.isConnected && String(range.toString()) === expected; } catch {}
      const rects = rangeCurrent ? visibleRects(range) : []; positionHighlights(group, rects);
      const anchor = rects.length ? markerAnchor(range) : null;
      if (!anchor) { node.hidden = true; return; }
      const size = 20, edge = 4, gap = 8, listOffset = anchor.block?.matches?.("li") ? 16 : 0;
      const left = anchor.rect.left - size - gap - listOffset;
      const right = anchor.rect.right + gap;
      const safeLeft = left >= edge, safeRight = right + size <= innerWidth - edge;
      if (!safeLeft && !safeRight) { node.hidden = true; return; }
      node.hidden = false;
      node.dataset.side = safeLeft ? "left" : "right";
      node.style.left = `${Math.round(safeLeft ? left : right)}px`;
      node.style.top = `${Math.round(Math.max(edge, Math.min(innerHeight - size - edge, anchor.line.top + (anchor.line.height - size) / 2)))}px`;
    });
    if (preview?.marker?.isConnected && !preview.marker.hidden) positionHoverPreview(preview);
    else if (preview) closeHoverPreview();
  }
  function sameLocations(items, left, right) {
    return items.every((item) => {
      const before = left.get(item.recordId), after = right.get(item.recordId);
      if (before?.status !== after?.status) return false;
      return before?.status !== "resolved" || before.verifiedText === after.verifiedText;
    });
  }
  function positionHoverPreview(active) {
    const markerRect = active.marker.getBoundingClientRect(), shell = active.shell;
    const width = Math.min(380, innerWidth - 16), height = Math.min(shell.offsetHeight || 280, innerHeight - 16), gap = 10;
    const right = markerRect.right + gap, left = markerRect.left - width - gap;
    const x = right + width <= innerWidth - 8 ? right : Math.max(8, left);
    const y = Math.max(8, Math.min(innerHeight - height - 8, markerRect.top + markerRect.height / 2 - height / 2));
    shell.style.left = `${Math.round(x)}px`; shell.style.top = `${Math.round(y)}px`; shell.style.width = `${Math.round(width)}px`;
  }
  function closeHoverPreview({ notify = true } = {}) {
    previewEpoch++; clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer); hoverOpenTimer = hoverCloseTimer = 0;
    const active = preview; if (!active) return;
    preview = null; clearTimeout(active.timeout); window.removeEventListener("message", active.listener);
    locale.unbindTree(active.shell); active.frame.remove(); active.shell.remove();
    if (notify) void send(M.PREVIEW_CLOSE, { previewId: active.previewId }).catch(() => {});
  }
  function scheduleHoverClose() {
    clearTimeout(hoverOpenTimer); hoverOpenTimer = 0; const epoch = ++previewEpoch;
    clearTimeout(hoverCloseTimer); hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0; if (epoch === previewEpoch) closeHoverPreview();
    }, 220);
  }
  function groupIsCurrent(group, renderedGeneration) {
    if (renderedGeneration !== generation || !group?.marker?.isConnected || group.marker.hidden ||
        !group.range?.startContainer?.isConnected || !group.range?.endContainer?.isConnected) return false;
    try { return String(group.range.toString()) === group.expected; } catch { return false; }
  }
  function scheduleHoverPreview(item, group, renderedGeneration, delay = 160) {
    clearTimeout(hoverCloseTimer); hoverCloseTimer = 0;
    if (preview?.recordId === item.recordId && preview.shell.isConnected) return;
    clearTimeout(hoverOpenTimer); const epoch = ++previewEpoch;
    hoverOpenTimer = setTimeout(() => { hoverOpenTimer = 0; void openHoverPreview(item, group, renderedGeneration, epoch); }, delay);
  }
  async function openHoverPreview(item, group, renderedGeneration, activationEpoch) {
    if (activationEpoch !== previewEpoch || !groupIsCurrent(group, renderedGeneration)) return;
    let created;
    try {
      created = await send(M.PREVIEW_CREATE, { recordId: item.recordId, expectedRevision: item.revision });
      if (activationEpoch !== previewEpoch || !groupIsCurrent(group, renderedGeneration)) {
        void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {}); return;
      }
      if (preview) { closeHoverPreview(); activationEpoch = previewEpoch; }
      const shell = surface({ className: "tf-reading-hover-preview", role: "dialog" });
      locale.bindAttribute(shell, "aria-label", "content.reading.previewAria");
      const frame = document.createElement("iframe"); frame.className = "tf-reading-hover-frame tf-reading-preview-frame";
      frame.title = locale.t("content.reading.previewTitle"); frame.referrerPolicy = "no-referrer";
      const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
      const state = { previewId: created.previewId, recordId: item.recordId, marker: group.marker,
        shell, frame, listener: null, timeout: 0 };
      state.listener = async event => {
        if (!event.isTrusted || event.source !== frame.contentWindow || event.origin !== extensionOrigin ||
            !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) return;
        const message = event.data;
        if (message.type === "translateflow-reading-preview-close" && Object.keys(message).length === 2 && message.previewId === state.previewId) {
          closeHoverPreview(); return;
        }
        if (message.type !== "translateflow-reading-preview-claim" || Object.keys(message).length !== 3 ||
            message.previewId !== state.previewId || typeof message.claimId !== "string" || preview !== state) return;
        try {
          const bound = await send(M.PREVIEW_BIND, { previewId: state.previewId, claimId: message.claimId });
          if (preview !== state || bound.bound !== true || !groupIsCurrent(group, renderedGeneration)) {
            if (preview === state) closeHoverPreview(); return;
          }
          clearTimeout(state.timeout);
          frame.contentWindow?.postMessage({ type: "translateflow-reading-preview-bound", previewId: state.previewId,
            claimId: message.claimId }, extensionOrigin);
        } catch { if (preview === state) closeHoverPreview(); }
      };
      shell.addEventListener("pointerenter", () => { clearTimeout(hoverCloseTimer); hoverCloseTimer = 0; });
      shell.addEventListener("pointerleave", scheduleHoverClose);
      preview = state; window.addEventListener("message", state.listener);
      shell.appendChild(frame); app.modules.uiHost.getLayer("reading-page-preview").appendChild(shell); positionHoverPreview(state);
      frame.src = `${chrome.runtime.getURL("reading-preview.html")}?previewId=${encodeURIComponent(state.previewId)}`;
      state.timeout = setTimeout(() => { if (preview === state) closeHoverPreview(); }, 14_000);
    } catch {
      if (created?.previewId) void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {});
    }
  }
  function showPanel(focusId = null) { panelRequestedOpen = true; pendingPanelFocus = focusId; if (!panel) return; if (panel.hidden) panelReturnFocus = root.getRootNode().activeElement || document.activeElement;
    panel.hidden = false; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "true");
    const target = focusId ? panel.querySelector(`[data-record-id="${focusId}"] .tf-reading-page-item`) : panel.querySelector("button");
    queueMicrotask(() => { if (!panel?.hidden && target?.isConnected) target.focus({ preventScroll: true }); }); }
  function hidePanel() { panelRequestedOpen = false; pendingPanelFocus = null; if (!panel) return; panel.hidden = true; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "false");
    const target = panelReturnFocus; panelReturnFocus = null; if (target?.isConnected) target.focus(); }
  function pulseRecord(recordId) {
    const group = recordGroups.get(recordId); if (!group) return;
    clearTimeout(pulseTimer); for (const node of [group.marker, ...group.highlights]) node.dataset.active = "true";
    pulseTimer = setTimeout(() => { for (const node of [group.marker, ...group.highlights]) delete node.dataset.active; pulseTimer = 0; }, 1100);
  }
  function locateRecord(recordId, { openPanel = false } = {}) {
    const range = ranges.get(recordId); if (!range?.startContainer?.isConnected) return;
    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (openPanel) showPanel(recordId);
    requestAnimationFrame(() => requestAnimationFrame(() => { positionMarkers(); pulseRecord(recordId); }));
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
  async function checkedListedAction(item, renderedGeneration, action) {
    if (await confirmListedItem(item, renderedGeneration)) action();
    else if (renderedGeneration === generation) void load();
  }
  function bindButtonText(node, key) { locale.unbindTree(node); locale.bindText(node, key); }
  function updateMarkerLabel(group) {
    const args = { count: group.recordIds.length, quote: group.expected };
    locale.unbindTree(group.marker); locale.bindAttribute(group.marker, "aria-label", "content.reading.markerLocated", args);
    locale.bindAttribute(group.marker, "title", "content.reading.markerHint");
    group.marker.textContent = group.recordIds.length > 1 ? String(group.recordIds.length) : "";
    group.marker.dataset.count = String(group.recordIds.length);
  }
  function addDeleteControls(row, item, renderedGeneration, nextFocusId, open) {
    const actions = document.createElement("div"); actions.className = "tf-reading-page-row-actions";
    const remove = button({ text: locale.t("content.reading.deleteRecord"), className: "tf-reading-page-delete" });
    const cancel = button({ text: locale.t("content.reading.cancelDelete"), className: "tf-reading-page-cancel" });
    locale.bindText(remove, "content.reading.deleteRecord"); locale.bindText(cancel, "content.reading.cancelDelete"); cancel.hidden = true;
    const status = document.createElement("span"); status.className = "tf-reading-page-row-status"; status.setAttribute("role", "status"); status.hidden = true;
    const reset = () => { row.dataset.confirming = "false"; bindButtonText(remove, "content.reading.deleteRecord"); remove.disabled = false; cancel.hidden = true; status.hidden = true; };
    cancel.addEventListener("click", event => { if (event.isTrusted) reset(); });
    remove.addEventListener("click", async event => {
      if (!event.isTrusted) return;
      if (row.dataset.confirming !== "true") {
        row.dataset.confirming = "true"; bindButtonText(remove, "content.reading.confirmDeleteRecord"); cancel.hidden = false; cancel.focus({ preventScroll: true }); return;
      }
      if (!app.modules.selectionRecordAccess.authorizePageAction({ event, action: "delete", recordId: item.recordId })) return;
      remove.disabled = cancel.disabled = true; status.hidden = false; locale.bindText(status, "content.reading.deletingRecord");
      panelRequestedOpen = true; pendingPanelFocus = nextFocusId;
      try {
        await send(M.DELETE_RECORD, { recordId: item.recordId, expectedRevision: item.revision });
        if (renderedGeneration === generation) void load();
      } catch {
        if (renderedGeneration !== generation) return;
        locale.unbindTree(status); locale.bindText(status, "content.reading.deleteFailed"); row.dataset.confirming = "false";
        bindButtonText(remove, "content.reading.deleteRecord"); remove.disabled = cancel.disabled = false; cancel.hidden = true;
      }
    });
    actions.append(open, remove, cancel); row.append(actions, status);
  }
  function render(items, locations, pageRecordCount, unavailable = false) {
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); root = document.createElement("div"); root.className = "tf-reading-page-history";
    const renderedGeneration = generation;
    const toggleKey = unavailable ? "content.reading.pageUnavailable" : "content.reading.pageCount";
    const toggleArgs = unavailable ? {} : { count: pageRecordCount };
    const toggle = button({ text: locale.t(toggleKey, toggleArgs), className: "tf-reading-page-toggle" }); locale.bindText(toggle, toggleKey, toggleArgs); toggle.setAttribute("aria-expanded", "false");
    panel = surface({ className: "tf-reading-page-panel", role: "dialog" }); panel.hidden = true; locale.bindAttribute(panel, "aria-label", "content.reading.pageAria");
    const header = document.createElement("header"), title = document.createElement("strong"), retry = button({ text: locale.t("content.reading.retryPosition"), className: "tf-reading-page-retry" }), close = button({ text: "×", label: locale.t("content.reading.closePage"), icon: true });
    locale.bindText(retry, "content.reading.retryPosition"); locale.bindAttribute(close, "aria-label", "content.reading.closePage");
    retry.addEventListener("click", event => { if (event.isTrusted) void load(); });
    panel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); hidePanel(); } });
    locale.bindText(title, pageRecordCount > items.length ? "content.reading.pageLoadedTitle" : "content.reading.pageTitle", pageRecordCount > items.length ? { loaded: items.length, total: pageRecordCount } : {}); close.addEventListener("click", hidePanel); header.append(title, retry, close); panel.appendChild(header);
    const markerRangeIds = new Map(), rangeNodeIds = new Map();
    const markerRangeKey = (range) => {
      const nodeId = (node) => { if (!rangeNodeIds.has(node)) rangeNodeIds.set(node, rangeNodeIds.size + 1); return rangeNodeIds.get(node); };
      return `${nodeId(range.startContainer)}:${range.startOffset}:${nodeId(range.endContainer)}:${range.endOffset}`;
    };
    for (const [index, item] of items.entries()) {
      const location = locations.get(item.recordId) || { status: "not-loaded" }, row = document.createElement("article"); row.dataset.recordId = item.recordId;
      const quote = item.anchor.quote.exact;
      const rangeIsCurrent = location.status === "resolved" && location.range?.startContainer?.isConnected && location.range?.endContainer?.isConnected &&
        location.verifiedText === item.anchor.quote.exact;
      const locateKey = rangeIsCurrent ? "content.reading.locateItem" : "content.reading.locateUnavailable";
      const locateArgs = rangeIsCurrent ? { quote } : { index: index + 1 };
      const locate = button({ text: rangeIsCurrent ? quote : locale.t(locateKey, locateArgs), label: locale.t(locateKey, locateArgs), className: "tf-reading-page-item" });
      locale.bindAttribute(locate, "aria-label", locateKey, locateArgs); if (rangeIsCurrent) locate.title = quote; else locale.bindText(locate, locateKey, locateArgs); locate.dataset.recordId = item.recordId;
      const locationStatus = location.status === "resolved" && !rangeIsCurrent ? "not-loaded" : location.status;
      const state = document.createElement("span"); locale.bindText(state, ({ resolved: "content.reading.statusResolved", ambiguous: "content.reading.statusAmbiguous", missing: "content.reading.statusMissing", "not-loaded": "content.reading.statusNotLoaded", unsupported: "content.reading.statusUnsupported" })[locationStatus] || "content.reading.statusUnavailable");
      locate.addEventListener("click", event => { if (event.isTrusted) locateRecord(item.recordId); });
      const open = button({ text: locale.t("content.reading.viewRecord") }); locale.bindText(open, "content.reading.viewRecord"); open.addEventListener("click", event => {
        if (event.isTrusted) void checkedListedAction(item, renderedGeneration, () => void openRecord(item.recordId));
      });
      row.append(locate, state); addDeleteControls(row, item, renderedGeneration, items[index + 1]?.recordId || items[index - 1]?.recordId || null, open); panel.appendChild(row);
      if (rangeIsCurrent) {
        ranges.set(item.recordId, location.range);
        const rangeId = markerRangeKey(location.range), existing = markerRangeIds.get(rangeId);
        if (existing) { existing.recordIds.push(item.recordId); recordGroups.set(item.recordId, existing); updateMarkerLabel(existing); continue; }
        const marker = button({ text: "", label: locale.t("content.reading.markerLocated", { count: 1, quote }), className: "tf-reading-page-marker" });
        marker.dataset.recordId = item.recordId;
        const group = { marker, range: location.range, expected: quote, recordIds: [item.recordId], highlights: [] };
        markerRangeIds.set(rangeId, group); markerGroups.set(item.recordId, group); recordGroups.set(item.recordId, group); updateMarkerLabel(group);
        marker.addEventListener("pointerenter", event => { if (event.isTrusted) scheduleHoverPreview(item, group, renderedGeneration); });
        marker.addEventListener("pointerleave", event => { if (event.isTrusted) scheduleHoverClose(); });
        marker.addEventListener("focus", event => { if (event.isTrusted) scheduleHoverPreview(item, group, renderedGeneration, 0); });
        marker.addEventListener("blur", event => { if (event.isTrusted) scheduleHoverClose(); });
        marker.addEventListener("click", event => {
          if (event.isTrusted) { closeHoverPreview(); showPanel(group.recordIds[0]); pulseRecord(group.recordIds[0]); }
        });
        markerNodes.push(marker); app.modules.uiHost.getLayer("reading-page-highlights"); app.modules.uiHost.getLayer("reading-page-markers").appendChild(marker);
      }
    }
    const locatedCount = markerRangeIds.size;
    const summary = document.createElement("p"); summary.setAttribute("role", "status");
    locale.bindText(summary, unavailable ? "content.reading.pageSummaryUnavailable"
      : pageRecordCount > C.READING_LIMITS.pageMarkers ? "content.reading.pageSummaryLimited" : "content.reading.pageSummary", unavailable ? {}
        : pageRecordCount > C.READING_LIMITS.pageMarkers
          ? { total: pageRecordCount, loaded: items.length, located: locatedCount, limit: C.READING_LIMITS.pageMarkers }
          : { total: pageRecordCount, loaded: items.length, located: locatedCount });
    panel.appendChild(summary);
    toggle.addEventListener("click", () => panel.hidden ? showPanel() : hidePanel()); root.append(toggle, panel); app.modules.uiHost.getLayer("reading-page-history").appendChild(root); positionMarkers();
    if (panelRequestedOpen) showPanel(pendingPanelFocus);
    window.addEventListener("scroll", positionMarkers, true); window.addEventListener("resize", positionMarkers);
  }
  function subscribeProjection() {
    projectionUnsubscribe?.();
    projectionUnsubscribe = app.modules.textProjection.start(() => {
      projectionUnsubscribe?.(); projectionUnsubscribe = null;
      if (!timer) timer = setTimeout(() => { timer = 0; void refreshLocationsAfterMutation(); }, C.READING_LIMITS.mutationDebounceMs);
    });
  }
  async function refreshLocationsAfterMutation() {
    if (!lastItems.length) return;
    const current = ++generation; controller?.abort(); const ownController = new AbortController(); controller = ownController;
    const previous = lastLocations;
    try {
      const locations = await app.modules.readingAnchorResolver.resolvePage(lastItems, { signal: ownController.signal, verifiedBlocksFirst: true });
      if (current !== generation || ownController.signal.aborted) return;
      const unchanged = sameLocations(lastItems, previous, locations);
      if (!unchanged && automaticRetries >= C.READING_LIMITS.scanRetryCount) {
        lastLocations = unresolved(lastItems);
        render(lastItems, lastLocations, lastPageRecordCount);
        return;
      }
      if (!unchanged) automaticRetries++;
      lastLocations = locations;
      render(lastItems, locations, lastPageRecordCount);
      subscribeProjection();
    } catch {
      if (current !== generation || ownController.signal.aborted) return;
      if (automaticRetries >= C.READING_LIMITS.scanRetryCount) {
        lastLocations = unresolved(lastItems);
        render(lastItems, lastLocations, lastPageRecordCount);
        return;
      }
      automaticRetries++;
      subscribeProjection();
    }
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
      if (!lastMarkerEnabled) { lastItems = []; lastLocations = new Map(); lastPageRecordCount = 0; clearUi(); return; }
      const items = []; let cursor = null, count = 0;
      let summaryRequests = 0;
      do { const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 }); summaryRequests++;
        if (current !== generation || ownController.signal.aborted) return;
        items.push(...page.items); cursor = page.nextCursor; count = page.pageRecordCount;
      } while (cursor && items.length < C.READING_LIMITS.pageMarkers && summaryRequests < 2);
      if (current !== generation || ownController.signal.aborted) return;
      if (!items.length) { lastItems = []; lastLocations = new Map(); lastPageRecordCount = count; clearUi(); return; }
      const limited = items.slice(0, C.READING_LIMITS.pageMarkers);
      lastItems = limited; lastPageRecordCount = count; render(limited, unresolved(limited), count);
      const locations = await app.modules.readingAnchorResolver.resolvePage(limited, { signal: ownController.signal, verifiedBlocksFirst: true });
      if (current !== generation || ownController.signal.aborted) return;
      lastLocations = locations;
      render(limited, locations, count);
      subscribeProjection();
    } catch { if (current === generation) {
      if (lastItems.length) render(lastItems, unresolved(lastItems), lastPageRecordCount);
      else if (lastMarkerEnabled) render([], new Map(), null, true);
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
            void load(); return;
          }
          const next = C.validateReadingInvalidation(value, "content"), previous = lastInvalidation;
          lastInvalidation = next;
          if (previous && previous.dataGeneration === next.dataGeneration && previous.consentGeneration === next.consentGeneration &&
              previous.pageRevision === next.pageRevision) return;
          void load();
        } catch { if (port === ownedPort) void load(); }
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
