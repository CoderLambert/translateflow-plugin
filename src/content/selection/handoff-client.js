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
  async function consumePending() {
    const registration = await send(M.REGISTER_DOCUMENT, {
      documentGeneration: app.modules.selectionSourceSnapshot.documentGeneration
    });
    if (!registration.handoffId) return { state: "none" };
    const summary = await send(M.CONSUME_HANDOFF, { handoffId: registration.handoffId });
    return { state: "consumed", summary };
  }
  const register = () => consumePending().catch(caught => ({ state: "error", code: caught?.code || C.READING_ERROR.INTERRUPTED }));
  const ready = register();
  app.modules.readingHandoff = Object.freeze({ ready, register });
})();
