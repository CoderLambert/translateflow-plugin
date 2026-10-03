(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract || !app?.modules.runtime || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { button, surface } = app.modules.uiPrimitives;
  let generation = 0, controller = null, root = null, panel = null, markerNodes = [], ranges = new Map(), observer = null, timer = 0, port = null;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code }); return response.data;
  }
  function clearUi() { root?.remove(); root = panel = null; for (const node of markerNodes) node.remove(); markerNodes = []; ranges.clear(); }
  function cleanup() { generation++; controller?.abort(); controller = null; observer?.disconnect(); observer = null; clearTimeout(timer); timer = 0;
    window.removeEventListener("scroll", positionMarkers, true); window.removeEventListener("resize", positionMarkers); clearUi(); }
  function rectFor(range) { return [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0) || null; }
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
    const header = document.createElement("header"), title = document.createElement("strong"), close = button({ text: "×", label: "关闭本页历史", icon: true });
    title.textContent = pageRecordCount > items.length ? `本页历史（定位前 ${items.length} 条）` : "本页历史"; close.addEventListener("click", hidePanel); header.append(title, close); panel.appendChild(header);
    for (const item of items) {
      const location = locations.get(item.recordId), row = document.createElement("article"); row.dataset.recordId = item.recordId;
      const locate = button({ text: item.anchor.quote.exact, className: "tf-reading-page-item" }); locate.dataset.recordId = item.recordId;
      const state = document.createElement("span"); state.textContent = ({ resolved: "已定位", ambiguous: "多处匹配", missing: "未找到", "not-loaded": "未完全加载", unsupported: "不支持" })[location.status] || "不可用";
      locate.addEventListener("click", () => { const range = ranges.get(item.recordId); if (range?.startContainer.isConnected) { const element = range.startContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } });
      const open = button({ text: "查看记录" }); open.addEventListener("click", event => { if (event.isTrusted) void openRecord(item.recordId); });
      row.append(locate, state, open); panel.appendChild(row);
      if (location.status === "resolved") {
        ranges.set(item.recordId, location.range); const marker = button({ text: "•", label: `历史：${item.anchor.quote.exact}`, className: "tf-reading-page-marker" }); marker.dataset.recordId = item.recordId;
        marker.addEventListener("click", () => showPanel(item.recordId)); markerNodes.push(marker); app.modules.uiHost.getLayer("reading-page-markers").appendChild(marker);
      }
    }
    toggle.addEventListener("click", () => panel.hidden ? showPanel() : hidePanel()); root.append(toggle, panel); app.modules.uiHost.getLayer("reading-page-history").appendChild(root); positionMarkers();
    window.addEventListener("scroll", positionMarkers, true); window.addEventListener("resize", positionMarkers);
  }
  async function load({ register = false } = {}) {
    const current = ++generation; controller?.abort(); controller = new AbortController(); observer?.disconnect(); clearTimeout(timer); clearUi();
    try {
      if (register) await app.modules.readingHandoff.register(); else await app.modules.readingHandoff.ready;
      const markerState = await send(M.GET_SITE_MARKERS); if (current !== generation || markerState.state !== "ready" || !markerState.enabled) return;
      const items = []; let cursor = null, count = 0;
      do { const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 }); items.push(...page.items); cursor = page.nextCursor; count = page.pageRecordCount; } while (cursor && items.length < C.READING_LIMITS.pageMarkers);
      if (current !== generation || !items.length) return;
      const limited = items.slice(0, C.READING_LIMITS.pageMarkers), locations = await app.modules.readingAnchorResolver.resolvePage(limited, { signal: controller.signal });
      if (current !== generation) return; render(limited, locations, count);
      observer = new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = 0; void load(); }, C.READING_LIMITS.mutationDebounceMs); });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    } catch { if (current === generation) clearUi(); }
  }
  function connect() { if (port) return; try { port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT }); port.onMessage.addListener(() => void load()); port.onDisconnect.addListener(() => { port = null; cleanup(); }); } catch {} }
  const route = () => { cleanup(); timer = setTimeout(() => { timer = 0; void load({ register: true }); }, C.READING_LIMITS.mutationDebounceMs); };
  window.addEventListener("popstate", route); window.addEventListener("hashchange", route); window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("focus", () => { connect(); void load({ register: true }); });
  globalThis.navigation?.addEventListener?.("navigate", route); const ready = load().finally(connect);
  app.modules.readingPageMarkers = Object.freeze({ ready, refresh: load, cleanup });
})();
