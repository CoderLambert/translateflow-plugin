(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || !app?.modules.uiHost || app.modules.selectionRecordAccess) return;
  const operations = new Map();
  const limits = app.modules.readingContract?.READING_LIMITS;
  let current = null;
  const randomId = () => `reading-${crypto.randomUUID()}`;
  function trusted(event) {
    return event?.isTrusted === true && app.modules.uiHost.ownsNode(event.target);
  }
  function create({ snapshot, capture, event, isCurrent, purpose, recordId = null, recordRevision = null }) {
    if (!limits || !trusted(event)) return null;
    prune();
    if (operations.size >= limits.operationsPerOwner) return null;
    const operation = { operationId: randomId(), snapshot, capture, isCurrent, purpose, recordId, recordRevision,
      token: null, expiresAt: Date.now() + limits.operationTtlMs, cancelled: false };
    operations.set(operation.operationId, operation);
    current = operation;
    return operation;
  }
  function live(operation) {
    return operations.get(operation?.operationId) === operation && !operation.cancelled
      && Date.now() < operation.expiresAt && operation.isCurrent()
      && operation.capture.sourceRevision === app.modules.textProjection.revision()
      && operation.snapshot.range?.startContainer?.isConnected !== false
      && operation.snapshot.range?.endContainer?.isConnected !== false;
  }
  function safety(operation) {
    const capture = operation.capture;
    return { selection: capture.context.sensitive ? "sensitive" : capture.root === "document" ? "safe" : "unknown",
      context: capture.context.sensitive ? "sensitive" : capture.root === "document" ? "safe" : "unknown",
      root: capture.root === "document" ? "light-dom" : "unsupported" };
  }
  async function read(challenge) {
    prune();
    if (!challenge || typeof challenge.nonce !== "string") return null;
    const passive = ["inspect", "register", "handoff", "page"].includes(challenge.action);
    const operation = passive ? current : operations.get(challenge.operationId);
    if (!operation && ["register", "handoff", "page"].includes(challenge.action)) {
      return { nonce: challenge.nonce, documentGeneration: app.modules.selectionSourceSnapshot.documentGeneration,
        selectionGeneration: 1, captureSafety: { selection: "safe", context: "safe", root: "light-dom" },
        sourceSnapshot: null, intent: null };
    }
    if (!operation) return null;
    const cancellation = challenge.action === "cancel" && operation.cancelled;
    if (!cancellation && !live(operation)) return null;
    const expectedId = challenge.action === "begin" ? operation.recordId : operation.token?.recordId ?? null;
    if (!passive && (!["begin", "save", "cancel"].includes(challenge.action) || challenge.recordId !== expectedId)) return null;
    if (challenge.action === "save" && !operation.token) return null;
    let sourceSnapshot;
    try { sourceSnapshot = await operation.capture.ready; } catch { return null; }
    if (!cancellation && !live(operation)) return null;
    return { nonce: challenge.nonce, documentGeneration: sourceSnapshot.documentGeneration,
      selectionGeneration: sourceSnapshot.selectionGeneration, captureSafety: safety(operation), sourceSnapshot,
      intent: passive ? null : { action: challenge.action, recordId: challenge.recordId, operationId: operation.operationId } };
  }
  function bindToken(operation, token) {
    if (!live(operation) || token.operationId !== operation.operationId) return false;
    operation.token = token;
    operation.expiresAt = token.expiresAt;
    return true;
  }
  function cancel(operation) { if (operation) operation.cancelled = true; }
  function forget(operation) {
    operations.delete(operation?.operationId);
    if (current === operation) current = [...operations.values()].reverse().find(live) || null;
  }
  function prune() { for (const value of operations.values()) if (Date.now() >= value.expiresAt) forget(value); }
  app.modules.readingAccessCollector = Object.freeze({ read });
  app.modules.selectionRecordAccess = Object.freeze({ create, live, safety, bindToken, cancel, forget, trusted });
})();
