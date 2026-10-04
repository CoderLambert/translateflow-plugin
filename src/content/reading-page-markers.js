(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract || !app?.modules.textProjection || !app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { button, surface } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  let generation = 0, controller = null, root = null, panel = null, markerNodes = [], ranges = new Map(), projectionUnsubscribe = null, timer = 0, port = null;
  // The automatic retry budget belongs to this document's content-script lifetime.
  // Focus, manual retries, and SPA route changes do not replenish it.
  let automaticRetries = 0, lastItems = [], lastPageRecordCount = 0;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code }); return response.data;
  }
  function clearUi() { locale.unbindTree(root); root?.remove(); root = panel = null; for (const node of markerNodes) { locale.unbindTree(node); node.remove(); } markerNodes = []; ranges.clear(); }
  function unresolved(items) { return new Map(items.map(item => [item.recordId, { status: "not-loaded", range: null }])); }
  function cleanup() { generation++; controller?.abort(); controller = null; projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(timer); timer = 0;
    lastItems = []; lastPageRecordCount = 0;
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); }
  function rectFor(range) { return [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
    rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth) || null; }
  function positionMarkers() {
    markerNodes.forEach(node => { const rect = rectFor(ranges.get(node.dataset.recordId)); if (!rect) { node.hidden = true; return; }
      node.hidden = false; node.style.left = `${Math.min(innerWidth - 24, rect.right + 4)}px`; node.style.top = `${Math.max(4, rect.top)}px`; });
  }
  function showPanel(focusId = null) { if (!panel) return; panel.hidden = false; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "true");
    (focusId ? panel.querySelector(`[data-record-id="${focusId}"]`) : panel.querySelector("button"))?.focus(); }
  function hidePanel() { if (!panel) return; panel.hidden = true; root.querySelector(".tf-reading-page-toggle").setAttribute("aria-expanded", "false"); }
  async function openRecord(recordId) { try { await send(M.OPEN_LEARNING_CENTER, { recordId }); } catch {} }
  function render(items, locations, pageRecordCount) {
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); root = document.createElement("div"); root.className = "tf-reading-page-history";
    const toggle = button({ text: locale.t("content.reading.pageCount", { count: pageRecordCount }), className: "tf-reading-page-toggle" }); locale.bindText(toggle, "content.reading.pageCount", { count: pageRecordCount }); toggle.setAttribute("aria-expanded", "false");
    panel = surface({ className: "tf-reading-page-panel", role: "dialog" }); panel.hidden = true; locale.bindAttribute(panel, "aria-label", "content.reading.pageAria");
    const header = document.createElement("header"), title = document.createElement("strong"), retry = button({ text: locale.t("content.reading.retryPosition"), className: "tf-reading-page-retry" }), close = button({ text: "×", label: locale.t("content.reading.closePage"), icon: true });
    locale.bindText(retry, "content.reading.retryPosition"); locale.bindAttribute(close, "aria-label", "content.reading.closePage");
    retry.addEventListener("click", event => { if (event.isTrusted) void load(); });
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
      const open = button({ text: locale.t("content.reading.viewRecord") }); locale.bindText(open, "content.reading.viewRecord"); open.addEventListener("click", event => { if (event.isTrusted) void openRecord(item.recordId); });
      row.append(locate, state, open); panel.appendChild(row);
      if (rangeIsCurrent) {
        ranges.set(item.recordId, location.range); const marker = button({ text: "•", label: locale.t("content.reading.markerLocated", { index: index + 1 }), className: "tf-reading-page-marker" }); locale.bindAttribute(marker, "aria-label", "content.reading.markerLocated", { index: index + 1 }); marker.dataset.recordId = item.recordId;
        marker.addEventListener("click", () => showPanel(item.recordId)); markerNodes.push(marker); app.modules.uiHost.getLayer("reading-page-markers").appendChild(marker);
      }
    }
    const locatedCount = items.filter(item => {
      const location = locations.get(item.recordId);
      return location?.status === "resolved" && location.range?.startContainer?.isConnected &&
        location.range?.endContainer?.isConnected && location.verifiedText === item.anchor.quote.exact;
    }).length;
    const summary = document.createElement("p"); summary.setAttribute("role", "status");
    locale.bindText(summary, pageRecordCount > C.READING_LIMITS.pageMarkers ? "content.reading.pageSummaryLimited" : "content.reading.pageSummary", pageRecordCount > C.READING_LIMITS.pageMarkers
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
      if (markerState.state !== "ready" || !markerState.enabled) { lastItems = []; lastPageRecordCount = 0; clearUi(); return; }
      const items = []; let cursor = null, count = 0;
      let summaryRequests = 0;
      do { const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 }); summaryRequests++;
        if (current !== generation || ownController.signal.aborted) return;
        items.push(...page.items); cursor = page.nextCursor; count = page.pageRecordCount;
      } while (cursor && items.length < C.READING_LIMITS.pageMarkers && summaryRequests < 2);
      if (current !== generation || ownController.signal.aborted) return;
      if (!items.length) { lastItems = []; lastPageRecordCount = count; clearUi(); return; }
      const limited = items.slice(0, C.READING_LIMITS.pageMarkers), locations = await app.modules.readingAnchorResolver.resolvePage(limited, { signal: ownController.signal });
      if (current !== generation || ownController.signal.aborted) return;
      lastItems = limited; lastPageRecordCount = count; render(limited, locations, count);
      projectionUnsubscribe = app.modules.textProjection.start(() => {
        projectionUnsubscribe?.(); projectionUnsubscribe = null;
        // The source projection is stale. Drop every old Range immediately but keep the
        // generic list and its manual retry action visible after auto retries end.
        render(lastItems, unresolved(lastItems), lastPageRecordCount);
        if (!timer && automaticRetries < C.READING_LIMITS.scanRetryCount) timer = setTimeout(() => {
          timer = 0; automaticRetries++; void load();
        }, C.READING_LIMITS.mutationDebounceMs);
      });
    } catch { if (current === generation) {
      if (lastItems.length) render(lastItems, unresolved(lastItems), lastPageRecordCount);
      else clearUi();
    } }
  }
  function connect() { if (port) return; try { port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT }); port.onMessage.addListener(() => void load()); port.onDisconnect.addListener(() => { port = null; cleanup(); }); } catch {} }
  const route = () => { cleanup(); timer = setTimeout(() => { timer = 0; void load({ register: true }); }, C.READING_LIMITS.mutationDebounceMs); };
  window.addEventListener("popstate", route); window.addEventListener("hashchange", route); window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("focus", () => { connect(); void load({ register: true }); });
  globalThis.navigation?.addEventListener?.("navigate", route); const ready = load().finally(connect);
  app.modules.readingPageMarkers = Object.freeze({ ready, refresh: load, cleanup });
})();
