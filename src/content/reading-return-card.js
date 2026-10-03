(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract ||
      !app?.modules.runtime || !app?.modules.uiHost || !app?.modules.uiPrimitives || app.modules.readingReturnCard) return;
  const C = app.modules.readingContract, M = C.READING_METHOD;
  const { button, surface, status, setStatus } = app.modules.uiPrimitives;
  let card = null, overlays = [], activeRange = null, controller = null, frame = 0, previousFocus = null, summary = null;
  let mutationObserver = null, mutationTimer = 0, automaticRetries = 0;
  const messages = {
    locating: "正在核对保存的原文位置…",
    resolved: "已回到唯一匹配的原文位置。",
    ambiguous: "页面中有多个可信匹配，未自动选择位置。",
    missing: "当前页面未找到保存的原文，历史记录仍可查看。",
    "not-loaded": "页面内容尚未完整加载或已达到安全扫描上限，可稍后重试。",
    unsupported: "当前页面结构不支持安全定位，历史记录仍可查看。",
    error: "定位已中断，可重试或打开学习中心查看历史。"
  };
  const onKeyDown = event => { if (card && event.key === "Escape") close(); };
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content");
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code });
    return response.data;
  }
  function clearOverlays() { for (const node of overlays) node.remove(); overlays = []; activeRange = null; }
  function updateOverlays() {
    frame = 0;
    if (!activeRange || !activeRange.startContainer.isConnected || !activeRange.endContainer.isConnected || activeRange.toString() !== summary.anchor.quote.exact) {
      clearOverlays(); if (card) { card.dataset.state = "missing"; setStatus(card.querySelector('[data-role="location-status"]'), messages.missing, "error"); } return;
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
    controller?.abort(); controller = null; cancelAnimationFrame(frame); frame = 0; clearOverlays();
    mutationObserver?.disconnect(); mutationObserver = null; clearTimeout(mutationTimer); mutationTimer = 0;
    window.removeEventListener("scroll", scheduleOverlay, true); window.removeEventListener("resize", scheduleOverlay);
  }
  function close() {
    cleanup(); document.removeEventListener("keydown", onKeyDown); card?.remove(); card = null;
    if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null;
  }
  function renderCard() {
    if (card?.isConnected) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card = surface({ className: "tf-reading-return-card", role: "dialog" }); card.setAttribute("aria-label", "TranslateFlow 阅读历史定位");
    const header = document.createElement("header"), title = document.createElement("h2"), closeButton = button({ text: "×", label: "关闭阅读历史定位", icon: true });
    title.textContent = "阅读历史定位"; closeButton.addEventListener("click", close); header.append(title, closeButton);
    const quote = document.createElement("blockquote"); quote.textContent = summary.anchor.quote.exact;
    const state = status({ className: "tf-reading-return-status" }); state.dataset.role = "location-status";
    const actions = document.createElement("div"); actions.className = "tf-reading-return-actions";
    const retry = button({ text: "重新定位" }); retry.dataset.action = "retry"; retry.addEventListener("click", event => { if (event.isTrusted) void locate(state); });
    const open = button({ text: "打开学习中心记录" }); open.dataset.action = "open-record";
    open.addEventListener("click", event => { if (event.isTrusted) void send(M.OPEN_LEARNING_CENTER, { recordId: summary.recordId }).catch(() => setStatus(state, messages.error, "error")); });
    actions.append(retry, open); card.append(header, quote, state, actions); app.modules.uiHost.getLayer("reading-return-card").appendChild(card);
    document.addEventListener("keydown", onKeyDown);
    closeButton.focus(); return state;
  }
  async function locate(state = card?.querySelector('[data-role="location-status"]')) {
    cleanup(); controller = new AbortController(); setStatus(state, messages.locating, "loading"); card.dataset.state = "locating";
    try {
      const result = await app.modules.readingAnchorResolver.resolve(summary.anchor, { signal: controller.signal });
      if (controller.signal.aborted || !card) return;
      card.dataset.state = result.status; setStatus(state, messages[result.status] || messages.error, result.status === "resolved" ? "success" : result.status === "ambiguous" ? "warning" : "error");
      if (result.status === "resolved" && result.range) {
        activeRange = result.range;
        window.addEventListener("scroll", scheduleOverlay, true); window.addEventListener("resize", scheduleOverlay);
        const element = result.range.commonAncestorContainer.nodeType === 1 ? result.range.commonAncestorContainer : result.range.commonAncestorContainer.parentElement;
        element?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        updateOverlays();
        mutationObserver = new MutationObserver(() => {
          if (automaticRetries >= C.READING_LIMITS.scanRetryCount || mutationTimer) return;
          mutationTimer = setTimeout(() => { mutationTimer = 0; automaticRetries++; void locate(); }, C.READING_LIMITS.mutationDebounceMs);
        });
        mutationObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      }
    } catch (error) { if (error?.name !== "AbortError" && card) { card.dataset.state = "error"; setStatus(state, messages.error, "error"); } }
  }
  async function start() {
    const handoff = await app.modules.readingHandoff.ready;
    if (handoff.state !== "consumed") return handoff;
    summary = handoff.summary; const state = renderCard(); await locate(state); return { state: card?.dataset.state || "closed", summary };
  }
  window.addEventListener("pagehide", close, { once: true });
  window.addEventListener("popstate", close, { once: true }); window.addEventListener("hashchange", close, { once: true });
  const ready = start();
  app.modules.readingReturnCard = Object.freeze({ ready, close });
})();
