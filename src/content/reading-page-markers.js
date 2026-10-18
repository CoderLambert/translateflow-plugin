(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.readingHandoff || !app?.modules.readingAnchorResolver || !app?.modules.readingContract ||
      !app?.modules.textProjection || !app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.uiHost ||
      !app?.modules.uiPrimitives || app.modules.readingPageMarkers) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, { surface } = app.modules.uiPrimitives;
  const locale = app.modules.contentI18n;
  let generation = 0, previewEpoch = 0, controller = null, preview = null, groups = [], projectionUnsubscribe = null,
    timer = 0, hoverOpenTimer = 0, hoverCloseTimer = 0, port = null, portReady = false, portReadyPromise = null,
    resolvePortReady = null, lastInvalidation = null, activeHitGroup = null, pointerMoveRaf = 0, pointerX = 0, pointerY = 0;
  let automaticRetries = 0, lastItems = [], lastLocations = new Map();

  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await app.modules.runtime.sendRuntimeMessage(request), response = C.validateReadingResponse(method, raw, "content", body.limit);
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code });
    return response.data;
  }
  function clearUi() {
    closeHoverPreview(); activeHitGroup = null; cancelAnimationFrame(pointerMoveRaf); pointerMoveRaf = 0;
    for (const group of groups) for (const node of group.highlights) node.remove();
    groups = [];
  }
  function cleanup() {
    generation++; controller?.abort(); controller = null; projectionUnsubscribe?.(); projectionUnsubscribe = null;
    clearTimeout(timer); clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer); timer = hoverOpenTimer = hoverCloseTimer = 0;
    lastItems = []; lastLocations = new Map(); lastInvalidation = null;
    window.removeEventListener("scroll", positionHighlights, true); window.removeEventListener("resize", positionHighlights);
    window.visualViewport?.removeEventListener("scroll", positionHighlights);
    window.visualViewport?.removeEventListener("resize", positionHighlights);
    window.removeEventListener("pointermove", onPointerMove); clearUi();
  }
  const visible = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  function visibleRects(range) { try { return [...range.getClientRects()].filter(visible).slice(0, 16); } catch { return []; } }
  function rangeMatchesExpected(range, expectedRaw) {
    try {
      return Boolean(range?.startContainer?.isConnected && range?.endContainer?.isConnected &&
        String(range.toString()) === expectedRaw);
    } catch { return false; }
  }
  function positionGroup(group, rects) {
    group.hitRects = rects;
    const layer = app.modules.uiHost.getLayer("reading-page-highlights");
    while (group.highlights.length < rects.length) {
      const node = document.createElement("span"); node.className = "tf-reading-page-highlight"; node.setAttribute("aria-hidden", "true");
      group.highlights.push(node); layer.appendChild(node);
    }
    group.highlights.forEach((node, index) => {
      const rect = rects[index]; node.hidden = !rect;
      if (!rect) return;
      const left = Math.max(0, rect.left - 2);
      node.style.left = `${left}px`; node.style.top = `${Math.max(0, rect.top - 1)}px`;
      node.style.width = `${Math.min(innerWidth - left, rect.width + 4)}px`; node.style.height = `${rect.height + 2}px`;
    });
  }
  function positionHighlights() {
    for (const group of groups) {
      const current = rangeMatchesExpected(group.range, group.expectedRaw);
      positionGroup(group, current ? visibleRects(group.range) : []);
    }
    if (!preview?.anchorRect) return;
    if (preview.group?.hitRects?.length) { preview.anchorRect = preview.group.hitRects[0]; positionHoverPreview(preview); }
    else closeHoverPreview();
  }
  function sameLocations(items, left, right) {
    return items.every(item => {
      const before = left.get(item.recordId), after = right.get(item.recordId);
      if (before?.status !== after?.status) return false;
      if (before?.status !== "resolved") return true;
      try { return before.verifiedText === item.anchor.quote.exact && after.verifiedText === item.anchor.quote.exact &&
        before.range?.startContainer?.isConnected && before.range?.endContainer?.isConnected &&
        after.range?.startContainer?.isConnected && after.range?.endContainer?.isConnected &&
        before.range.startContainer === after.range.startContainer && before.range.startOffset === after.range.startOffset &&
        before.range.endContainer === after.range.endContainer && before.range.endOffset === after.range.endOffset; } catch { return false; }
    });
  }
  function positionHoverPreview(active) {
    const anchor = active.anchorRect, shell = active.shell;
    const viewport = window.visualViewport, padding = 8, viewportLeft = viewport?.offsetLeft || 0, viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth, viewportHeight = viewport?.height || innerHeight;
    const bounds = { left: viewportLeft + padding, top: viewportTop + padding,
      right: viewportLeft + viewportWidth - padding, bottom: viewportTop + viewportHeight - padding };
    const availableWidth = Math.max(0, bounds.right - bounds.left), availableHeight = Math.max(0, bounds.bottom - bounds.top);
    const width = Math.min(420, availableWidth), height = Math.min(shell.offsetHeight || 260, availableHeight), gap = 10;
    const right = anchor.right + gap, left = anchor.left - width - gap;
    const x = right + width <= bounds.right ? right : Math.max(bounds.left, left);
    const y = Math.max(bounds.top, Math.min(bounds.bottom - height, anchor.top + anchor.height / 2 - height / 2));
    shell.style.maxWidth = `${Math.floor(availableWidth)}px`; shell.style.maxHeight = `${Math.floor(availableHeight)}px`;
    shell.style.left = `${Math.round(x)}px`; shell.style.top = `${Math.round(y)}px`; shell.style.width = `${Math.round(width)}px`;
    requestAnimationFrame(() => clampHoverPreview(shell, bounds, availableWidth, availableHeight, 0));
  }
  function clampHoverPreview(shell, bounds, availableWidth, availableHeight, attempt) {
    if (!shell?.isConnected) return;
    const actual = shell.getBoundingClientRect(), scaleX = actual.width / Math.max(1, shell.offsetWidth),
      scaleY = actual.height / Math.max(1, shell.offsetHeight);
    let resized = false;
    if (actual.width > availableWidth + 0.5) {
      shell.style.width = `${Math.max(1, Math.floor(availableWidth / Math.max(scaleX, 0.01)))}px`; resized = true;
    }
    if (actual.height > availableHeight + 0.5) {
      shell.style.height = `${Math.max(96, Math.floor(availableHeight / Math.max(scaleY, 0.01)))}px`; resized = true;
    }
    if (resized && attempt < 2) {
      requestAnimationFrame(() => clampHoverPreview(shell, bounds, availableWidth, availableHeight, attempt + 1)); return;
    }
    let left = Number.parseFloat(shell.style.left) || 0, top = Number.parseFloat(shell.style.top) || 0;
    let deltaX = 0, deltaY = 0;
    if (actual.left < bounds.left) deltaX = bounds.left - actual.left;
    else if (actual.right > bounds.right) deltaX = bounds.right - actual.right;
    if (actual.top < bounds.top) deltaY = bounds.top - actual.top;
    else if (actual.bottom > bounds.bottom) deltaY = bounds.bottom - actual.bottom;
    if (Math.abs(deltaX) > 0.5) { left += deltaX / Math.max(scaleX, 0.01); shell.style.left = `${Math.round(left)}px`; }
    if (Math.abs(deltaY) > 0.5) { top += deltaY / Math.max(scaleY, 0.01); shell.style.top = `${Math.round(top)}px`; }
    if ((Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) && attempt < 2) {
      requestAnimationFrame(() => clampHoverPreview(shell, bounds, availableWidth, availableHeight, attempt + 1));
    }
  }
  function closeHoverPreview({ notify = true } = {}) {
    previewEpoch++; clearTimeout(hoverOpenTimer); clearTimeout(hoverCloseTimer); hoverOpenTimer = hoverCloseTimer = 0;
    const active = preview; if (!active) return;
    preview = null; activeHitGroup = null; clearTimeout(active.timeout); window.removeEventListener("message", active.listener);
    locale.unbindTree(active.shell); active.frame.remove(); active.shell.remove();
    if (notify) void send(M.PREVIEW_CLOSE, { previewId: active.previewId }).catch(() => {});
  }
  function scheduleHoverClose() {
    clearTimeout(hoverOpenTimer); hoverOpenTimer = 0; const epoch = ++previewEpoch;
    clearTimeout(hoverCloseTimer); hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0; if (epoch === previewEpoch) closeHoverPreview();
    }, 220);
  }
  function hitTestHighlight(x, y) {
    let best = null;
    for (const group of groups) for (const rect of group.hitRects) {
      const left = Math.max(0, rect.left - 2), top = Math.max(0, rect.top - 1), width = Math.min(innerWidth - left, rect.width + 4);
      if (x < left || x > left + width || y < top || y > top + rect.height + 2) continue;
      if (!best || rect.width * rect.height < best.rect.width * best.rect.height) best = { item: group.item, group, rect };
    }
    return best;
  }
  function onPointerMove(event) {
    if (event.buttons) return;
    pointerX = event.clientX; pointerY = event.clientY; if (pointerMoveRaf) return;
    pointerMoveRaf = requestAnimationFrame(() => {
      pointerMoveRaf = 0; const x = pointerX, y = pointerY;
      if (preview?.shell?.isConnected) {
        const rect = preview.shell.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return;
      }
      const hit = hitTestHighlight(x, y);
      if (hit) {
        if (activeHitGroup !== hit.group) scheduleHoverPreview(hit.item, (activeHitGroup = hit.group), 160, hit.rect);
      } else if (activeHitGroup || preview?.anchorRect) { activeHitGroup = null; scheduleHoverClose(); }
    });
  }
  function groupIsCurrent(group) {
    return group?.renderedGeneration === generation && rangeMatchesExpected(group.range, group.expectedRaw);
  }
  function scheduleHoverPreview(item, group, delay = 160, anchorRect = null) {
    clearTimeout(hoverCloseTimer); hoverCloseTimer = 0;
    if (preview?.recordId === item.recordId && preview.shell.isConnected) return;
    clearTimeout(hoverOpenTimer); const epoch = ++previewEpoch;
    hoverOpenTimer = setTimeout(() => { hoverOpenTimer = 0; void openHoverPreview(item, group, epoch, anchorRect); }, delay);
  }
  async function openHoverPreview(item, group, activationEpoch, anchorRect) {
    if (activationEpoch !== previewEpoch || !groupIsCurrent(group)) return;
    let created;
    try {
      created = await send(M.PREVIEW_CREATE, { recordId: item.recordId, expectedRevision: item.revision,
        relatedRecords: group.relatedRecords });
      if (activationEpoch !== previewEpoch || !groupIsCurrent(group)) {
        void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {}); return;
      }
      if (preview) { closeHoverPreview(); activationEpoch = previewEpoch; }
      const shell = surface({ className: "tf-reading-hover-preview", role: "dialog" });
      locale.bindAttribute(shell, "aria-label", "content.reading.previewAria");
      const frame = document.createElement("iframe"); frame.className = "tf-reading-hover-frame tf-reading-preview-frame";
      frame.title = locale.t("content.reading.previewTitle"); frame.referrerPolicy = "no-referrer";
      const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
      const state = { previewId: created.previewId, recordId: item.recordId, shell, frame, listener: null, timeout: 0, anchorRect, group };
      state.listener = async event => {
        if (!event.isTrusted || event.source !== frame.contentWindow || event.origin !== extensionOrigin ||
            !event.data || Object.getPrototypeOf(event.data) !== Object.prototype) return;
        const message = event.data;
        if (message.type === "translateflow-reading-preview-close" && Object.keys(message).length === 2 && message.previewId === state.previewId) {
          closeHoverPreview(); return;
        }
        if (message.type === "translateflow-reading-preview-size" && Object.keys(message).length === 3 &&
            message.previewId === state.previewId && Number.isSafeInteger(message.height) && message.height >= 96 && message.height <= 4096 && preview === state) {
          const viewportHeight = window.visualViewport?.height || innerHeight;
          state.shell.style.height = `${Math.min(message.height, 560, Math.max(96, viewportHeight - 16))}px`;
          positionHoverPreview(state); return;
        }
        if (message.type !== "translateflow-reading-preview-claim" || Object.keys(message).length !== 3 ||
            message.previewId !== state.previewId || typeof message.claimId !== "string" || preview !== state) return;
        try {
          const bound = await send(M.PREVIEW_BIND, { previewId: state.previewId, claimId: message.claimId });
          if (preview !== state || bound.bound !== true || !groupIsCurrent(group)) { if (preview === state) closeHoverPreview(); return; }
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
    } catch { if (created?.previewId) void send(M.PREVIEW_CLOSE, { previewId: created.previewId }).catch(() => {}); }
  }
  function render(items, locations) {
    window.removeEventListener("scroll", positionHighlights, true); window.removeEventListener("resize", positionHighlights);
    window.visualViewport?.removeEventListener("scroll", positionHighlights);
    window.visualViewport?.removeEventListener("resize", positionHighlights);
    window.removeEventListener("pointermove", onPointerMove); clearUi();
    const renderedGeneration = generation, rangeGroups = new Map(), rangeNodeIds = new Map(), assistantsByItem = new Map();
    const rangeKey = range => {
      const nodeId = node => { if (!rangeNodeIds.has(node)) rangeNodeIds.set(node, rangeNodeIds.size + 1); return rangeNodeIds.get(node); };
      return `${nodeId(range.startContainer)}:${range.startOffset}:${nodeId(range.endContainer)}:${range.endOffset}`;
    };
    for (const item of items) {
      if (!item.hasCompletedAssistant) continue;
      const related = assistantsByItem.get(item.itemKey) || [];
      related.push(item); assistantsByItem.set(item.itemKey, related);
    }
    for (const item of items) {
      const location = locations.get(item.recordId), quote = item.anchor.quote.exact;
      const current = location?.status === "resolved" && location.range?.startContainer?.isConnected && location.range?.endContainer?.isConnected && location.verifiedText === quote;
      if (!current) continue;
      const key = rangeKey(location.range), existing = rangeGroups.get(key);
      if (existing) { if (item.hasCompletedAssistant && !existing.item.hasCompletedAssistant) existing.item = item; continue; }
      const group = { range: location.range, expectedRaw: String(location.range.toString()), highlights: [], hitRects: [], item, renderedGeneration, relatedRecords: [] };
      rangeGroups.set(key, group); groups.push(group);
    }
    for (const group of groups) group.relatedRecords = (assistantsByItem.get(group.item.itemKey) || [])
      .filter(item => item.recordId !== group.item.recordId).slice(0, C.READING_LIMITS.previewRelatedRecords)
      .map(item => ({ recordId: item.recordId, expectedRevision: item.revision }));
    positionHighlights();
    window.addEventListener("scroll", positionHighlights, true); window.addEventListener("resize", positionHighlights);
    window.visualViewport?.addEventListener("scroll", positionHighlights);
    window.visualViewport?.addEventListener("resize", positionHighlights);
    window.addEventListener("pointermove", onPointerMove);
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
    const current = generation; controller?.abort(); const ownController = new AbortController(); controller = ownController;
    const previous = lastLocations;
    try {
      const locations = await app.modules.readingAnchorResolver.resolvePage(lastItems, { signal: ownController.signal, verifiedBlocksFirst: true });
      if (current !== generation || ownController.signal.aborted) return;
      if (sameLocations(lastItems, previous, locations)) { lastLocations = previous; positionHighlights(); subscribeProjection(); return; }
      if (automaticRetries >= C.READING_LIMITS.scanRetryCount) { lastLocations = new Map(); render(lastItems, lastLocations); return; }
      automaticRetries++; lastLocations = locations; render(lastItems, locations); subscribeProjection();
    } catch {
      if (current !== generation || ownController.signal.aborted) return;
      if (automaticRetries >= C.READING_LIMITS.scanRetryCount) { lastLocations = new Map(); render(lastItems, lastLocations); return; }
      automaticRetries++; subscribeProjection();
    }
  }
  async function load({ register = false } = {}) {
    const current = ++generation; controller?.abort(); const ownController = new AbortController(); controller = ownController;
    projectionUnsubscribe?.(); projectionUnsubscribe = null; clearTimeout(timer); timer = 0;
    if (lastItems.length) render(lastItems, new Map()); else clearUi();
    try {
      if (register) await app.modules.readingHandoff.register(); else await app.modules.readingHandoff.ready;
      if (current !== generation || ownController.signal.aborted) return;
      const markerState = await send(M.GET_SITE_MARKERS); if (current !== generation || ownController.signal.aborted) return;
      if (markerState.state !== "ready" || !markerState.enabled) { lastItems = []; lastLocations = new Map(); clearUi(); return; }
      const items = []; let cursor = null, requests = 0;
      do {
        const page = await send(M.GET_PAGE_SUMMARY, { cursor, limit: 100 }); requests++;
        if (current !== generation || ownController.signal.aborted) return;
        items.push(...page.items); cursor = page.nextCursor;
      } while (cursor && items.length < C.READING_LIMITS.pageMarkers && requests < 2);
      if (current !== generation || ownController.signal.aborted) return;
      const limited = items.slice(0, C.READING_LIMITS.pageMarkers);
      if (!limited.length) { lastItems = []; lastLocations = new Map(); clearUi(); return; }
      lastItems = limited; render(limited, new Map());
      const locations = await app.modules.readingAnchorResolver.resolvePage(limited, { signal: ownController.signal, verifiedBlocksFirst: true });
      if (current !== generation || ownController.signal.aborted) return;
      lastLocations = locations; render(limited, locations); subscribeProjection();
    } catch { if (current === generation) { lastLocations = new Map(); render(lastItems, lastLocations); } }
  }
  function connect() {
    if (port) return portReadyPromise || Promise.resolve();
    try {
      port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT });
      const ownedPort = port; portReady = false;
      portReadyPromise = new Promise(resolve => { resolvePortReady = resolve; });
      port.onMessage.addListener(value => {
        if (port !== ownedPort) return;
        try {
          if (!portReady) {
            if (value?.type === "reading.site-markers.invalidate") { C.validateReadingSiteMarkersInvalidation(value); return; }
            lastInvalidation = C.validateReadingInvalidation(value, "content");
            portReady = true; resolvePortReady?.(); resolvePortReady = null; return;
          }
          if (value?.type === "reading.site-markers.invalidate") { C.validateReadingSiteMarkersInvalidation(value); void load(); return; }
          const next = C.validateReadingInvalidation(value, "content"), previous = lastInvalidation; lastInvalidation = next;
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
  window.addEventListener("focus", () => { if (!port) void load({ register: true }).finally(connect); });
  globalThis.navigation?.addEventListener?.("navigate", route);
  const ready = app.modules.readingHandoff.ready.then(async () => { await connect(); return load(); });
  app.modules.readingPageMarkers = Object.freeze({ ready, refresh: load, cleanup });
})();
