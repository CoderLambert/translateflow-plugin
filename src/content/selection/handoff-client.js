(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.selectionSourceSnapshot || !app?.modules.readingContract || app.modules.readingHandoff) return;
  const C = app.modules.readingContract, M = C.READING_METHOD;
  const { sendRuntimeMessage } = app.modules.runtime;
  async function send(method, body = {}) {
    const request = C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body });
    const raw = await sendRuntimeMessage(request);
    const response = C.validateReadingResponse(method, raw, "content");
    if (!response.ok) throw Object.assign(new Error(response.error.code), { code: response.error.code });
    return response.data;
  }
  function createInvalidationMonitor() {
    let port = null, state = null, failed = false, changed = false, settled = false;
    const listeners = new Set();
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    function finishReady(value) { if (!settled) { settled = true; resolveReady(value); } }
    function notify() { for (const listener of [...listeners]) { try { listener(); } catch {} } }
    function failClosed() { failed = true; finishReady({ ok: false }); notify(); }
    try {
      port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT });
      const ownedPort = port;
      port.onMessage.addListener(value => {
        if (port !== ownedPort || failed) return;
        try {
          const next = C.validateReadingInvalidation(value, "content"), previous = state;
          state = next;
          if (!previous) { finishReady({ ok: true, state: next }); return; }
          if (next.pageRevision !== previous.pageRevision || next.dataGeneration !== previous.dataGeneration ||
              next.consentGeneration !== previous.consentGeneration) { changed = true; notify(); }
        } catch { failClosed(); }
      });
      port.onDisconnect.addListener(() => { if (port === ownedPort) { port = null; failClosed(); } });
    } catch { failClosed(); }
    return Object.freeze({
      ready,
      get invalidated() { return failed || changed; },
      subscribe(listener) {
        listeners.add(listener);
        if (failed || changed) { try { listener(); } catch {} }
        return () => listeners.delete(listener);
      },
      close() { listeners.clear(); const ownedPort = port; port = null; try { ownedPort?.disconnect(); } catch {} }
    });
  }
  async function consumePending() {
    const registration = await send(M.REGISTER_DOCUMENT, {
      documentGeneration: app.modules.selectionSourceSnapshot.documentGeneration
    });
    if (!registration.handoffId) return { state: "none" };
    const invalidation = createInvalidationMonitor();
    const baseline = await invalidation.ready;
    if (!baseline.ok) { invalidation.close(); return { state: "error", code: C.READING_ERROR.INTERRUPTED }; }
    try {
      const summary = await send(M.CONSUME_HANDOFF, { handoffId: registration.handoffId });
      return { state: "consumed", summary, invalidation };
    } catch (error) { invalidation.close(); throw error; }
  }
  const register = () => consumePending().catch(caught => ({ state: "error", code: caught?.code || C.READING_ERROR.INTERRUPTED }));
  const ready = register();
  app.modules.readingHandoff = Object.freeze({ ready, register });
})();
