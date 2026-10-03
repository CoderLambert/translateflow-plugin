(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.selectionRecordAccess || !app?.modules.readingContract || app.modules.selectionRecordClient) return;
  const C = app.modules.readingContract, M = C.READING_METHOD, E = C.READING_ERROR, access = app.modules.selectionRecordAccess;
  const { sendRuntimeMessage } = app.modules.runtime;
  const retryable = new Set([E.STORAGE, E.QUOTA, E.INTERRUPTED]);
  const error = (code) => Object.assign(new Error(code), { code });
  async function send(method, body = {}) {
    let response;
    try { response = await sendRuntimeMessage(C.validateReadingRequest({ protocolVersion: C.READING_PROTOCOL_VERSION, method, ...body })); }
    catch (caught) { if (caught?.code) throw caught; throw error(E.INTERRUPTED); }
    const value = C.validateReadingResponse(method, response, "content");
    if (!value.ok) throw error(value.error.code);
    return value.data;
  }
  function create({ onStatus = () => {} } = {}) {
    let current = null, declined = false, port = null, invalidation = null, lastSaved = null, referenceGeneration = 1;
    const live = (ctx) => current === ctx && !ctx.closed && ctx.isCurrent();
    const show = (ctx, state, message, retryAvailable = false) => {
      if (!live(ctx)) return;
      ctx.view = { state, message, retryAvailable };
      onStatus(ctx.view);
    };
    function failure(ctx, caught) {
      if (!live(ctx)) return;
      const code = caught?.code || E.INTERRUPTED;
      if (!retryable.has(code)) ctx.blocked = true;
      const messages = {
        [E.UNSUPPORTED_VERSION]: "阅读记录版本已更新，请刷新网页后重新操作。",
        [E.STALE_OPERATION]: "本次保存已失效，请重新明确查询；当前结果仍可复制。",
        [E.REVISION_CONFLICT]: "记录已变化，请重新明确查询；当前结果仍可复制。",
        [E.FORBIDDEN]: "当前页面或所选内容不允许记录，结果仍可使用。",
        [E.DISABLED]: "阅读记录已暂停或本站已排除，结果仍可使用。",
        [E.CAPACITY]: "阅读记录空间已满，请在学习中心整理后重新查询。",
        [E.NOT_READY]: "阅读记录入口暂未就绪，当前结果仍可使用。",
        [E.QUOTA]: "本地空间不足，未确认保存；可整理空间后重试保存。",
        [E.STORAGE]: "保存未完成，当前结果仍可复制；可重试保存。",
        [E.INTERRUPTED]: "保存确认中断，当前结果仍可复制；可重试确认保存。"
      };
      show(ctx, "not-saved", messages[code] || "该结果暂不支持保存，当前结果仍可使用。", retryable.has(code));
    }
    function connect(ctx) {
      if (port || !chrome.runtime.connect || !live(ctx)) return;
      try {
        port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT });
        const ownedPort = port;
        port.onMessage.addListener((value) => {
          if (port !== ownedPort || !current) return;
          try {
            const next = C.validateReadingInvalidation(value, "content"), active = current;
            if (invalidation && (next.dataGeneration !== invalidation.dataGeneration || (next.consentGeneration !== invalidation.consentGeneration
              && next.consentGeneration !== active.policy?.consentGeneration))
              && active.policy?.enabled) revoke(active);
            invalidation = next;
            void refresh(true);
          } catch (caught) { failure(current, caught); }
        });
        port.onDisconnect.addListener(() => { if (port === ownedPort) { port = null; invalidation = null; } });
      } catch { /* Focus and each explicit query also re-read policy. */ }
    }
    async function policy(ctx) {
      const source = await ctx.capture.ready;
      if (!live(ctx)) throw error(E.STALE_OPERATION);
      const registration = await send(M.REGISTER_DOCUMENT, { documentGeneration: source.documentGeneration });
      if (!live(ctx)) throw error(E.STALE_OPERATION);
      ctx.registration = registration;
      const [state, site] = await Promise.all([send(M.GET_RECORDING_STATE), send(M.GET_SITE_RECORDING)]);
      if (!live(ctx)) throw error(E.STALE_OPERATION);
      if (!site.excluded) connect(ctx);
      return { ...state, ...site };
    }
    function start({ snapshot, capture, event, isCurrent, purpose = "lookup", sourceLanguage = "en" }) {
      const previous = current;
      const ctx = { snapshot, capture, event, isCurrent, sourceLanguage, operations: [], drafts: new Map(), ref: null,
        closed: false, blocked: false, manual: false, queue: Promise.resolve(), policy: null, view: null, referenceGeneration };
      const operation = access.create({ snapshot, capture, event, isCurrent, purpose });
      if (!operation) return null;
      ctx.operations.push(operation);
      current = ctx;
      ctx.previousDone = previous ? close(previous) : Promise.resolve(lastSaved);
      ctx.policyPromise = policy(ctx).then((value) => { ctx.policy = value; ctx.auto = value.enabled && !value.excluded; return value; });
      ctx.policyPromise.catch((caught) => failure(ctx, caught));
      return ctx;
    }
    function assistant(ctx, event) {
      if (!live(ctx)) return null;
      const operation = access.create({ snapshot: ctx.snapshot, capture: ctx.capture, event, isCurrent: ctx.isCurrent, purpose: "assistant" });
      if (!operation) return null;
      ctx.operations.push(operation);
      return operation;
    }
    async function prepare(ctx, operation) {
      if (operation.token) return operation.token;
      if (operation.preparing) return operation.preparing;
      operation.preparing = (async () => {
        const state = await ctx.policyPromise;
        const previous = await ctx.previousDone;
        if (!live(ctx) || ctx.blocked || !access.live(operation)) throw error(E.STALE_OPERATION);
        if (!state.enabled || state.excluded || (!ctx.auto && !ctx.manual)) throw error(E.DISABLED);
        const source = await ctx.capture.ready;
        if (!ctx.ref && previous && previous.pageUrl === ctx.snapshot.pageUrl && previous.consentGeneration === state.consentGeneration
          && previous.sitePolicyRevision === state.sitePolicyRevision && previous.sourceLanguage === ctx.sourceLanguage && C.sameProvenLocation(
          { pageKey: previous.pageKey, documentGeneration: previous.source.documentGeneration, anchor: previous.source.anchor },
          { pageKey: ctx.registration.pageKey, documentGeneration: source.documentGeneration, anchor: source.anchor })) {
          // A new explicit query may reuse a proven saved location, with the current minimal page revision.
          let cursor = null, found = null;
          do {
            const summary = await send(M.GET_PAGE_SUMMARY, { cursor, limit: C.READING_LIMITS.pageSize });
            found = summary.items.find((item) => item.recordId === previous.recordId);
            cursor = summary.nextCursor;
          } while (!found && cursor && live(ctx));
          if (!live(ctx) || ctx.blocked || ctx.referenceGeneration !== referenceGeneration) throw error(E.STALE_OPERATION);
          if (found) ctx.ref = { ...previous, revision: found.revision };
        }
        if (ctx.ref && !C.sameProvenLocation(
          { pageKey: ctx.registration.pageKey, documentGeneration: ctx.ref.source.documentGeneration, anchor: ctx.ref.source.anchor },
          { pageKey: ctx.registration.pageKey, documentGeneration: source.documentGeneration, anchor: source.anchor })) throw error(E.CAPABILITY_LIMITED);
        operation.recordId = ctx.ref?.recordId ?? null;
        operation.recordRevision = ctx.ref?.revision ?? null;
        const result = await send(M.BEGIN_QUERY, { operationId: operation.operationId, purpose: operation.purpose,
          sourceSnapshot: source, pageKey: ctx.registration.pageKey, safeReturnUrl: null, pageTitle: "",
          itemText: source.selectedText, sourceLanguage: ctx.sourceLanguage, recordId: operation.recordId,
          recordRevision: operation.recordRevision, captureSafety: access.safety(operation) });
        if (result.state !== "ready") throw error(E.DISABLED);
        access.bindToken(operation, result.token);
        operation.token = result.token; // Retain an arrived token for actual cancellation even if the card closed.
        if (!live(ctx) || !access.live(operation)) throw error(E.STALE_OPERATION);
        return result.token;
      })();
      try { return await operation.preparing; } finally { operation.preparing = null; }
    }
    function accept(ctx, draft, { key = "primary", operation = ctx?.operations[0], sourceLanguage } = {}) {
      if (!live(ctx) || !operation || ctx.blocked) return;
      if (sourceLanguage) ctx.sourceLanguage = sourceLanguage;
      if (!draft) { if (!ctx.drafts.size) show(ctx, "not-saved", "该结果暂不支持保存，当前结果仍可使用。"); return; }
      if (ctx.drafts.has(key) || ctx.drafts.size >= 8) return;
      let bounded;
      try {
        bounded = C.validateResultArtifact({ schemaVersion: 1, artifactId: crypto.randomUUID(), recordId: "00000000-0000-4000-8000-000000000000",
          operationId: operation.operationId, sourceSnapshotId: "pending", kind: draft.kind, targetLanguage: draft.targetLanguage,
          createdAt: Date.now(), payload: draft.payload, provenance: draft.provenance });
      } catch { if (!ctx.drafts.size) show(ctx, "not-saved", "该结果暂不支持保存，当前结果仍可使用。"); return; }
      ctx.drafts.set(key, { operation, bounded, artifact: null, saved: false });
      ctx.queue = ctx.queue.then(async () => {
        await ctx.policyPromise;
        if (!live(ctx) || ctx.blocked) return;
        if (ctx.auto || ctx.manual) await flush(ctx);
        else showAvailable(ctx);
      }).catch((caught) => failure(ctx, caught));
    }
    function showAvailable(ctx) {
      if (ctx.blocked || !ctx.drafts.size) return;
      if (ctx.policy?.excluded) show(ctx, "disabled", "本站已排除阅读记录，当前结果仍可使用。");
      else if (ctx.policy?.enabled) show(ctx, "manual", "阅读记录已开启，可保存当前仍有效的结果。");
      else show(ctx, declined ? "disabled" : "invite", declined ? "本次结果未记录。" : "本次结果尚未记录，开启后可返回保存。");
    }
    async function flush(ctx) {
      if (!live(ctx) || ctx.blocked) return;
      for (const item of ctx.drafts.values()) {
        if (item.saved) continue;
        if (!live(ctx) || ctx.blocked) return;
        show(ctx, "saving", "正在保存阅读记录…");
        const token = await prepare(ctx, item.operation);
        if (!item.artifact) item.artifact = C.validateResultArtifact({ ...item.bounded,
          recordId: token.recordId, sourceSnapshotId: (await ctx.capture.ready).sourceSnapshotId });
        const saved = await send(item.artifact.kind === "assistant" ? M.APPEND_ASSISTANT : M.SAVE_QUERY_RESULT,
          { token, artifact: item.artifact });
        if (!live(ctx) || ctx.blocked) return;
        if (saved.artifactId !== item.artifact.artifactId || saved.recordId !== token.recordId) throw error(E.BAD_DTO);
        item.saved = true;
        ctx.ref = { recordId: saved.recordId, revision: saved.revision, pageKey: ctx.registration.pageKey,
          source: await ctx.capture.ready, sourceLanguage: ctx.sourceLanguage, pageUrl: ctx.snapshot.pageUrl,
          consentGeneration: ctx.policy.consentGeneration, sitePolicyRevision: ctx.policy.sitePolicyRevision };
        if (ctx.referenceGeneration === referenceGeneration) lastSaved = ctx.ref;
      }
      if (ctx.drafts.size) show(ctx, "saved", "已保存阅读记录。");
    }
    async function refresh(checkRecord = false) {
      const ctx = current;
      if (!ctx || !live(ctx)) return;
      try {
        const initial = await ctx.policyPromise;
        const [state, site] = await Promise.all([send(M.GET_RECORDING_STATE), send(M.GET_SITE_RECORDING)]);
        if (!live(ctx)) return;
        if ((initial.enabled && state.consentGeneration !== initial.consentGeneration) || (site.excluded && !initial.excluded) ||
          site.sitePolicyRevision !== initial.sitePolicyRevision) { revoke(ctx); failure(ctx, error(E.DISABLED)); return; }
        ctx.policy = { ...state, ...site };
        if (checkRecord && ctx.ref) {
          await ctx.queue;
          if (!live(ctx) || ctx.blocked) return;
          const expected = ctx.ref;
          let cursor = null, found = null;
          do {
            const summary = await send(M.GET_PAGE_SUMMARY, { cursor, limit: C.READING_LIMITS.pageSize });
            found = summary.items.find((value) => value.recordId === expected.recordId);
            cursor = summary.nextCursor;
          } while (!found && cursor && live(ctx));
          if (!live(ctx) || ctx.blocked || ctx.ref !== expected) return;
          if (!found) { revoke(ctx); failure(ctx, error(E.STALE_OPERATION)); return; }
          if (found.revision > expected.revision) {
            const location = { pageKey: expected.pageKey, documentGeneration: expected.source.documentGeneration };
            const unchanged = C.sameProvenLocation({ ...location, anchor: expected.source.anchor }, { ...location, anchor: found.anchor })
              || (expected.source.anchor.status !== "resolved" && JSON.stringify(expected.source.anchor) === JSON.stringify(found.anchor));
            if (!unchanged) { revoke(ctx); failure(ctx, error(E.STALE_OPERATION)); return; }
            // Viewed metadata advances revision without removing an immutable saved artifact.
            // An unchanged unsupported anchor remains unsupported; prepare still requires location proof.
            ctx.ref = { ...expected, revision: found.revision };
            if (ctx.referenceGeneration === referenceGeneration) lastSaved = ctx.ref;
          }
        }
        if (!ctx.auto && !ctx.manual) showAvailable(ctx);
      } catch (caught) { failure(ctx, caught); }
    }
    function invalidateReference() { referenceGeneration++; lastSaved = null; }
    function revoke(ctx) { ctx.blocked = true; ctx.ref = null; invalidateReference(); for (const op of ctx.operations) access.cancel(op); }
    async function save(event) {
      const ctx = current;
      if (!ctx || !live(ctx) || ctx.blocked || !access.trusted(event)) return;
      await refresh();
      if (!live(ctx) || ctx.blocked || !ctx.policy?.enabled || ctx.policy.excluded) return;
      if (!ctx.manual && !ctx.auto) {
        // First consent returns to one bounded current card. New tokens belong to this explicit save action.
        const old = ctx.operations;
        ctx.operations = [];
        const replacement = new Map();
        for (const item of ctx.drafts.values()) {
          let op = replacement.get(item.operation);
          if (!op) {
            op = access.create({ snapshot: ctx.snapshot, capture: ctx.capture, event, isCurrent: ctx.isCurrent, purpose: item.operation.purpose });
            if (!op) { failure(ctx, error(E.CAPACITY)); return; }
            replacement.set(item.operation, op); ctx.operations.push(op);
          }
          item.operation = op; item.bounded.operationId = op.operationId;
        }
        for (const op of old) { access.cancel(op); access.forget(op); }
        ctx.manual = true;
        ctx.policyPromise = Promise.resolve(ctx.policy);
      }
      ctx.queue = ctx.queue.then(() => flush(ctx)).catch((caught) => failure(ctx, caught));
      await ctx.queue;
    }
    async function retry(event) {
      const ctx = current;
      if (!ctx || !live(ctx) || ctx.blocked || !access.trusted(event)) return;
      ctx.queue = ctx.queue.then(() => flush(ctx)).catch((caught) => failure(ctx, caught));
      await ctx.queue;
    }
    async function close(ctx = current) {
      if (!ctx) return null;
      ctx.closed = true;
      if (current === ctx) current = null;
      ctx.drafts.clear();
      for (const op of ctx.operations) access.cancel(op);
      await Promise.all(ctx.operations.map(async (op) => {
        try {
          await op.preparing?.catch(() => {});
          if (!op.token) return;
          const ack = await send(M.CANCEL_OPERATION, { operationId: op.operationId });
          if (ack.state === "committed" && ctx.referenceGeneration === referenceGeneration
            && (!ctx.ref || ctx.ref.recordId !== ack.recordId || ack.revision >= ctx.ref.revision)) {
            ctx.ref = { recordId: ack.recordId, revision: ack.revision, pageKey: ctx.registration.pageKey,
              source: await ctx.capture.ready, sourceLanguage: ctx.sourceLanguage, pageUrl: ctx.snapshot.pageUrl,
              consentGeneration: ctx.policy.consentGeneration, sitePolicyRevision: ctx.policy.sitePolicyRevision };
            lastSaved = ctx.ref;
          }
        } catch { /* A closed card cannot claim cancellation or overwrite a new result. */ }
        finally { access.forget(op); }
      }));
      if (!current && port) { const owned = port; port = null; invalidation = null; owned.disconnect(); }
      return ctx.referenceGeneration === referenceGeneration ? ctx.ref : null;
    }
    return Object.freeze({ start, assistant, accept, refresh, save, retry, close, invalidateReference,
      decline(event) { if (access.trusted(event)) { declined = true; if (current) showAvailable(current); } },
      async open(event) {
        if (!access.trusted(event)) return;
        const ctx = current;
        try { await send(M.OPEN_LEARNING_CENTER); }
        catch (caught) {
          if (caught.code === E.NOT_READY) show(ctx, "invite", "学习中心入口暂未就绪，本次结果仍可使用。");
          else failure(ctx, caught);
        }
      },
      render() { if (current?.view && live(current)) onStatus(current.view); }, getCurrent: () => current });
  }
  app.modules.selectionRecordClient = Object.freeze({ create });
})();
