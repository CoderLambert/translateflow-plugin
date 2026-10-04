(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract || !app?.modules.runtime || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { button, surface } = app.modules.uiPrimitives;
  let generation = 0, controller = null, root = null, panel = null, markerNodes = [], ranges = new Map(), observer = null, timer = 0, port = null;
  // The automatic retry budget belongs to this document's content-script lifetime.
  // Focus, manual retries, and SPA route changes do not replenish it.
  let automaticRetries = 0, lastItems = [], lastPageRecordCount = 0;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code }); return response.data;
  }
  function clearUi() { root?.remove(); root = panel = null; for (const node of markerNodes) node.remove(); markerNodes = []; ranges.clear(); }
  function unresolved(items) { return new Map(items.map(item => [item.recordId, { status: "not-loaded", range: null }])); }
  function cleanup() { generation++; controller?.abort(); controller = null; observer?.disconnect(); observer = null; clearTimeout(timer); timer = 0;
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
    const toggle = button({ text: `本页历史 ${pageRecordCount}`, className: "tf-reading-page-toggle" }); toggle.setAttribute("aria-expanded", "false");
    panel = surface({ className: "tf-reading-page-panel", role: "dialog" }); panel.hidden = true; panel.setAttribute("aria-label", "TranslateFlow 本页阅读历史");
    const header = document.createElement("header"), title = document.createElement("strong"), retry = button({ text: "重新检查位置", className: "tf-reading-page-retry" }), close = button({ text: "×", label: "关闭本页历史", icon: true });
    retry.addEventListener("click", event => { if (event.isTrusted) void load(); });
    title.textContent = pageRecordCount > items.length ? "本页历史（已加载 " + items.length + "/" + pageRecordCount + " 条）" : "本页历史"; close.addEventListener("click", hidePanel); header.append(title, retry, close); panel.appendChild(header);
    for (const [index, item] of items.entries()) {
      const location = locations.get(item.recordId) || { status: "not-loaded" }, row = document.createElement("article"); row.dataset.recordId = item.recordId;
      const locate = button({ text: `定位第 ${index + 1} 条历史`, className: "tf-reading-page-item" }); locate.dataset.recordId = item.recordId;
      const rangeIsCurrent = location.status === "resolved" && location.range?.startContainer?.isConnected && location.range?.endContainer?.isConnected &&
        location.verifiedText === item.anchor.quote.exact;
      const locationStatus = location.status === "resolved" && !rangeIsCurrent ? "not-loaded" : location.status;
      const state = document.createElement("span"); state.textContent = ({ resolved: "已定位", ambiguous: "多处匹配", missing: "未找到", "not-loaded": "未完全加载", unsupported: "不支持" })[locationStatus] || "不可用";
      locate.addEventListener("click", () => { const range = ranges.get(item.recordId); if (range?.startContainer.isConnected) { const element = range.startContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } });
      const open = button({ text: "查看记录" }); open.addEventListener("click", event => { if (event.isTrusted) void openRecord(item.recordId); });
      row.append(locate, state, open); panel.appendChild(row);
      if (rangeIsCurrent) {
        ranges.set(item.recordId, location.range); const marker = button({ text: "•", label: `第 ${index + 1} 条阅读历史，已定位`, className: "tf-reading-page-marker" }); marker.dataset.recordId = item.recordId;
        marker.addEventListener("click", () => showPanel(item.recordId)); markerNodes.push(marker); app.modules.uiHost.getLayer("reading-page-markers").appendChild(marker);
      }
    }
    const locatedCount = items.filter(item => {
      const location = locations.get(item.recordId);
      return location?.status === "resolved" && location.range?.startContainer?.isConnected &&
        location.range?.endContainer?.isConnected && location.verifiedText === item.anchor.quote.exact;
    }).length;
    const summary = document.createElement("p"); summary.setAttribute("role", "status");
    summary.textContent = pageRecordCount > C.READING_LIMITS.pageMarkers
      ? "本页共 " + pageRecordCount + " 条，已加载前 " + items.length + " 条，定位 " + locatedCount + " 条；已达每页 " + C.READING_LIMITS.pageMarkers + " 条上限。"
      : "本页共 " + pageRecordCount + " 条，已加载 " + items.length + " 条，定位 " + locatedCount + " 条。";
    panel.appendChild(summary);
    toggle.addEventListener("click", () => panel.hidden ? showPanel() : hidePanel()); root.append(toggle, panel); app.modules.uiHost.getLayer("reading-page-history").appendChild(root); positionMarkers();
    window.addEventListener("scroll", positionMarkers, true); window.addEventListener("resize", positionMarkers);
  }
  async function load({ register = false } = {}) {
    const current = ++generation; controller?.abort(); const ownController = new AbortController(); controller = ownController;
    observer?.disconnect(); observer = null; clearTimeout(timer); timer = 0;
    if (!lastItems.length) clearUi();
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
      observer = new MutationObserver(records => {
        const changedPage = records.some(record => !app.modules.uiHost.ownsNode(record.target) &&
          (!record.addedNodes.length && !record.removedNodes.length || [...record.addedNodes, ...record.removedNodes].some(node => !app.modules.uiHost.ownsNode(node))));
        if (!changedPage) return;
        // Page structure has moved. Drop every old Range immediately but keep the
        // generic list and its manual retry action visible after auto retries end.
        render(lastItems, unresolved(lastItems), lastPageRecordCount);
        if (!timer && automaticRetries < C.READING_LIMITS.scanRetryCount) timer = setTimeout(() => {
          timer = 0; automaticRetries++; void load();
        }, C.READING_LIMITS.mutationDebounceMs);
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
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
