(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || !app?.modules.contentI18n || !app?.modules.selectionRecordAccess || !app?.modules.selectionSourceSnapshot ||
      !app?.modules.readingContract || app.modules.selectionRecordClient) return;
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
    const acceptedItemLive = (ctx, item) => Boolean(item?.accepted && !item.settled &&
      ctx.referenceGeneration === referenceGeneration && item.referenceGeneration === referenceGeneration &&
      item.pageUrl === ctx.snapshot.pageUrl && access.accepted(item.operation));
    const contextLive = (ctx) => live(ctx) || [...ctx.drafts.values()].some(item => acceptedItemLive(ctx, item));
    const itemLive = (ctx, item) => live(ctx) || acceptedItemLive(ctx, item);
    function settle(item, result, caught = null) {
      if (!item || item.settled) return;
      item.settled = true;
      if (caught) item.reject(caught); else item.resolve(result);
    }
    const show = (ctx, state, messageKey, retryAvailable = false, messageArgs = {}, options = {}) => {
      if (!live(ctx)) return;
      const view = { state, messageKey, messageArgs, retryAvailable };
      if (options.openAvailable) view.openAvailable = true;
      if (options.item?.onStatus) {
        options.item.view = view;
        options.item.onStatus(view);
      } else {
        ctx.view = view;
        onStatus(view);
      }
    };
    const hasAssistantDraft = (ctx) => [...ctx.drafts.values()].some((item) => item.bounded.kind === "assistant");
    function disabledMessage(ctx) {
      const assistant = hasAssistantDraft(ctx);
      if (ctx.policy?.excluded) return assistant ? "content.reading.aiSiteExcluded" : "content.reading.siteExcluded";
      if (ctx.policy?.enabled === false) return assistant ? "content.reading.aiPaused" : "content.reading.paused";
      return "content.reading.disabled";
    }
    function failure(ctx, caught, item = null) {
      if (!live(ctx)) return;
      const code = caught?.code || E.INTERRUPTED;
      if (!retryable.has(code)) ctx.blocked = true;
      if (code === E.DISABLED) {
        show(ctx, "disabled", disabledMessage(ctx), false, {}, { openAvailable: true, item });
        return;
      }
      const messages = {
        [E.UNSUPPORTED_VERSION]: "content.reading.unsupportedVersion",
        [E.STALE_OPERATION]: "content.reading.stale",
        [E.REVISION_CONFLICT]: "content.reading.conflict",
        [E.FORBIDDEN]: "content.reading.forbidden",
        [E.CAPACITY]: "content.reading.capacity",
        [E.NOT_READY]: "content.reading.notReady",
        [E.QUOTA]: "content.reading.quota",
        [E.STORAGE]: "content.reading.storage",
        [E.INTERRUPTED]: "content.reading.interrupted"
      };
      show(ctx, "not-saved", messages[code] || "content.reading.unsupported", retryable.has(code), {}, { item });
    }
    function connect(ctx) {
      if (port || !chrome.runtime.connect || !live(ctx)) return;
      try {
        port = chrome.runtime.connect({ name: C.READING_INVALIDATION_PORT });
        const ownedPort = port;
        port.onMessage.addListener((value) => {
          if (port !== ownedPort || !current) return;
          try {
            if (value?.type === "reading.site-markers.invalidate") {
              C.validateReadingSiteMarkersInvalidation(value);
              return;
            }
            const next = C.validateReadingInvalidation(value, "content"), active = current;
            if (invalidation && (next.dataGeneration !== invalidation.dataGeneration || (next.consentGeneration !== invalidation.consentGeneration
              && next.consentGeneration !== active.policy?.consentGeneration))
              && active.policy?.enabled) revoke(active);
            invalidation = next;
            void refresh(true);
          } catch (caught) { failure(current, caught); }
        });
        port.onDisconnect.addListener(() => { if (port === ownedPort) { port = null; invalidation = null; if (current?.ref) void refresh(true); } });
      } catch { /* Focus and each explicit query also re-read policy. */ }
    }
    async function policy(ctx) {
      const source = await ctx.capture.ready;
      if (!contextLive(ctx)) throw error(E.STALE_OPERATION);
      const registration = await send(M.REGISTER_DOCUMENT, { documentGeneration: source.documentGeneration });
      if (!contextLive(ctx)) throw error(E.STALE_OPERATION);
      ctx.registration = registration;
      return readPolicy(ctx);
    }
    async function readPolicy(ctx) {
      const [state, site] = await Promise.all([send(M.GET_RECORDING_STATE), send(M.GET_SITE_RECORDING)]);
      if (!contextLive(ctx)) throw error(E.STALE_OPERATION);
      if (!site.excluded && live(ctx)) connect(ctx);
      ctx.policy = { ...state, ...site };
      return ctx.policy;
    }
    function start({ snapshot, capture, event, isCurrent, purpose = "lookup", sourceLanguage = "en" }) {
      const previous = current;
      const ctx = { snapshot, capture, event, isCurrent, sourceLanguage, operations: [], drafts: new Map(), ref: null,
        closed: false, blocked: false, manual: false, queue: Promise.resolve(), policy: null, view: null, referenceGeneration,
        closePromise: null };
      const operation = access.create({ snapshot, capture, event, isCurrent, purpose });
      if (!operation) return null;
      ctx.operations.push(operation);
      current = ctx;
      ctx.previousDone = previous ? close(previous) : Promise.resolve(lastSaved);
      ctx.policyPromise = policy(ctx).then((value) => { ctx.auto = value.enabled && !value.excluded; return value; });
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
    async function discard(ctx, operation) {
      if (!ctx || !operation) return;
      access.cancel(operation);
      ctx.operations = ctx.operations.filter(value => value !== operation);
      try {
        await operation.preparing?.catch(() => {});
        if (operation.token) await send(M.CANCEL_OPERATION, { operationId: operation.operationId });
      } catch { /* An incomplete assistant turn is never promoted to a saved artifact. */ }
      finally { access.forget(operation); }
    }
    async function prepare(ctx, operation, item) {
      if (operation.token) return operation.token;
      if (operation.preparing) return operation.preparing;
      operation.preparing = (async () => {
        const state = await ctx.policyPromise;
        const previous = await ctx.previousDone;
        if (!itemLive(ctx, item) || ctx.blocked || (!access.live(operation) && !access.accepted(operation))) throw error(E.STALE_OPERATION);
        if (!state.enabled || state.excluded || (!ctx.auto && !ctx.manual && !item.manual)) throw error(E.DISABLED);
        const source = await item.sourcePromise;
        if (!itemLive(ctx, item) || source.selectedText !== ctx.capture.selectedText || source.documentGeneration !== item.documentGeneration) {
          throw error(E.STALE_OPERATION);
        }
        if (!ctx.ref && previous && previous.pageUrl === ctx.snapshot.pageUrl && previous.consentGeneration === state.consentGeneration
          && previous.sitePolicyRevision === state.sitePolicyRevision && previous.sourceLanguage === item.sourceLanguage && C.sameProvenLocation(
          { pageKey: previous.pageKey, documentGeneration: previous.source.documentGeneration, anchor: previous.source.anchor },
          { pageKey: ctx.registration.pageKey, documentGeneration: source.documentGeneration, anchor: source.anchor })) {
          // A new explicit query may reuse a proven saved location, with the current minimal page revision.
          let cursor = null, found = null;
          do {
            const summary = await send(M.GET_PAGE_SUMMARY, { cursor, limit: C.READING_LIMITS.pageSize });
            found = summary.items.find((item) => item.recordId === previous.recordId);
            cursor = summary.nextCursor;
          } while (!found && cursor && itemLive(ctx, item));
          if (!itemLive(ctx, item) || ctx.blocked || ctx.referenceGeneration !== referenceGeneration) throw error(E.STALE_OPERATION);
          if (found) ctx.ref = { ...previous, revision: found.revision };
        }
        if (ctx.ref && !C.sameProvenLocation(
          { pageKey: ctx.registration.pageKey, documentGeneration: ctx.ref.source.documentGeneration, anchor: ctx.ref.source.anchor },
          { pageKey: ctx.registration.pageKey, documentGeneration: source.documentGeneration, anchor: source.anchor })) throw error(E.CAPABILITY_LIMITED);
        operation.recordId = ctx.ref?.recordId ?? null;
        operation.recordRevision = ctx.ref?.revision ?? null;
        if (operation.sourceLanguage && operation.sourceLanguage !== item.sourceLanguage) throw error(E.BAD_DTO);
        operation.sourceLanguage = item.sourceLanguage;
        let result;
        try {
          result = await send(M.BEGIN_QUERY, { operationId: operation.operationId, purpose: operation.purpose,
            sourceSnapshot: source, pageKey: ctx.registration.pageKey, safeReturnUrl: null, pageTitle: "",
            itemText: source.selectedText, sourceLanguage: item.sourceLanguage, recordId: operation.recordId,
            recordRevision: operation.recordRevision, captureSafety: access.safety(operation) });
        } catch (caught) {
          if (caught?.code === E.DISABLED && itemLive(ctx, item)) await readPolicy(ctx);
          throw caught;
        }
        if (result.state !== "ready") { await readPolicy(ctx); throw error(E.DISABLED); }
        operation.token = result.token; // Retain an arrived token for actual cancellation even if the card closed.
        if (!access.bindToken(operation, result.token)) throw error(E.STALE_OPERATION);
        if (!itemLive(ctx, item) || (!access.live(operation) && !access.accepted(operation))) throw error(E.STALE_OPERATION);
        return result.token;
      })();
      try { return await operation.preparing; } finally { operation.preparing = null; }
    }
    function accept(ctx, draft, { key = "primary", operation = ctx?.operations[0], sourceLanguage, onStatus: itemStatus, onSaved } = {}) {
      if (!live(ctx) || !operation || ctx.blocked) return null;
      if (sourceLanguage) ctx.sourceLanguage = sourceLanguage;
      if (!draft) { if (!ctx.drafts.size) show(ctx, "not-saved", "content.reading.unsupported"); return null; }
      if (ctx.drafts.has(key)) return ctx.drafts.get(key).promise;
      if (ctx.drafts.size >= 8) return null;
      let bounded;
      try {
        bounded = C.validateResultArtifact({ schemaVersion: 1, artifactId: crypto.randomUUID(), recordId: "00000000-0000-4000-8000-000000000000",
          operationId: operation.operationId, sourceSnapshotId: "pending", kind: draft.kind, targetLanguage: draft.targetLanguage,
          createdAt: Date.now(), payload: draft.payload, provenance: draft.provenance });
      } catch { if (!ctx.drafts.size) show(ctx, "not-saved", "content.reading.unsupported"); return null; }
      const accepted = bounded.kind === "assistant";
      if (accepted && !access.accept(operation)) return null;
      let resolve, reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      promise.catch(() => {});
      const item = { operation, bounded, artifact: null, saved: false, accepted, settled: false, resolve, reject, promise,
        onStatus: typeof itemStatus === "function" ? itemStatus : null, onSaved: typeof onSaved === "function" ? onSaved : null,
        manual: false, view: null,
        sourcePromise: ctx.capture.ready, sourceLanguage: sourceLanguage || ctx.sourceLanguage,
        documentGeneration: app.modules.selectionSourceSnapshot.documentGeneration,
        pageUrl: ctx.snapshot.pageUrl, referenceGeneration };
      ctx.drafts.set(key, item);
      ctx.queue = ctx.queue.then(async () => {
        await ctx.policyPromise;
        if (!itemLive(ctx, item) || ctx.blocked) throw error(E.STALE_OPERATION);
        if (ctx.auto || ctx.manual || item.manual) await flush(ctx, new Set([key]));
        else if (live(ctx)) showAvailable(ctx);
        else throw error(E.DISABLED);
      }).catch((caught) => { settle(item, null, caught); failure(ctx, caught, item); });
      return promise;
    }
    function showAvailable(ctx) {
      if (ctx.blocked || !ctx.drafts.size) return;
      for (const item of ctx.drafts.values()) {
        if (item.saved) continue;
        const assistant = item.bounded.kind === "assistant";
        if (ctx.policy?.excluded) show(ctx, "disabled", assistant ? "content.reading.aiSiteExcluded" : "content.reading.siteExcluded",
          false, {}, { openAvailable: true, item });
        else if (ctx.policy?.enabled) show(ctx, "manual", "content.reading.enabled", false, {}, { item });
        else show(ctx, declined ? "disabled" : "invite",
          assistant ? "content.reading.aiPaused" : declined ? "content.reading.notRecorded" : "content.reading.invite",
          false, {}, { openAvailable: assistant, item });
      }
    }
    async function flush(ctx, onlyKeys = null) {
      if ((!live(ctx) && !contextLive(ctx)) || ctx.blocked) return;
      for (const [key, item] of ctx.drafts) {
        if (onlyKeys && !onlyKeys.has(key)) continue;
        if (item.saved) continue;
        if (!itemLive(ctx, item) || ctx.blocked) continue;
        show(ctx, "saving", "content.reading.saving", false, {}, { item });
        const token = await prepare(ctx, item.operation, item);
        if (!item.artifact) item.artifact = C.validateResultArtifact({ ...item.bounded,
          recordId: token.recordId, sourceSnapshotId: (await item.sourcePromise).sourceSnapshotId });
        const method = item.artifact.kind === "assistant" ? M.APPEND_ASSISTANT : M.SAVE_QUERY_RESULT;
        let saved;
        try { saved = await send(method, { token, artifact: item.artifact }); }
        catch (caught) {
          if (!(item.accepted && ctx.closed && (caught?.code || E.INTERRUPTED) === E.INTERRUPTED && itemLive(ctx, item))) throw caught;
          saved = await send(method, { token, artifact: item.artifact });
        }
        if (!itemLive(ctx, item) || ctx.blocked) throw error(E.STALE_OPERATION);
        if (saved.artifactId !== item.artifact.artifactId || saved.recordId !== token.recordId ||
            saved.revision <= token.recordRevision) throw error(E.BAD_DTO);
        item.saved = true;
        ctx.ref = { recordId: saved.recordId, revision: saved.revision, pageKey: ctx.registration.pageKey,
          source: await item.sourcePromise, sourceLanguage: item.sourceLanguage, pageUrl: item.pageUrl,
          consentGeneration: ctx.policy.consentGeneration, sitePolicyRevision: ctx.policy.sitePolicyRevision };
        if (ctx.referenceGeneration === referenceGeneration) lastSaved = ctx.ref;
        const receipt = { artifactId: saved.artifactId, recordId: saved.recordId, revision: saved.revision, duplicate: saved.duplicate };
        settle(item, receipt);
        item.onSaved?.(receipt);
        show(ctx, "saved", "content.reading.saved", false, {}, { openAvailable: true, item });
      }
    }
    async function refresh(checkRecord = false) {
      const ctx = current;
      if (!ctx || !live(ctx)) return;
      try {
        const initial = await ctx.policyPromise;
        const [state, site] = await Promise.all([send(M.GET_RECORDING_STATE), send(M.GET_SITE_RECORDING)]);
        if (!live(ctx)) return;
        const nextPolicy = { ...state, ...site };
        if ((initial.enabled && state.consentGeneration !== initial.consentGeneration) || (site.excluded && !initial.excluded) ||
          site.sitePolicyRevision !== initial.sitePolicyRevision) { ctx.policy = nextPolicy; revoke(ctx); failure(ctx, error(E.DISABLED)); return; }
        ctx.policy = nextPolicy;
        if (!site.excluded) connect(ctx);
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
    function revoke(ctx) {
      ctx.blocked = true; ctx.ref = null; invalidateReference();
      for (const item of ctx.drafts.values()) if (!item.saved) settle(item, null, error(E.DISABLED));
      for (const op of ctx.operations) access.cancel(op);
    }
    async function save(event, key = null) {
      const ctx = current;
      if (!ctx || !live(ctx) || ctx.blocked || !access.trusted(event)) return;
      await refresh();
      if (!live(ctx) || ctx.blocked || !ctx.policy?.enabled || ctx.policy.excluded) return;
      if (!ctx.manual && !ctx.auto) {
        // First consent returns to one bounded current card. New tokens belong to this explicit save action.
        const selected = key === null ? [...ctx.drafts.entries()] : [[key, ctx.drafts.get(key)]].filter(([, item]) => item);
        const old = new Set(selected.map(([, item]) => item.operation));
        const replacement = new Map();
        for (const [, item] of selected) {
          let op = replacement.get(item.operation);
          if (!op) {
            op = access.create({ snapshot: ctx.snapshot, capture: ctx.capture, event, isCurrent: ctx.isCurrent, purpose: item.operation.purpose });
            if (!op) { failure(ctx, error(E.CAPACITY)); return; }
            replacement.set(item.operation, op); ctx.operations.push(op);
          }
          item.operation = op; item.bounded.operationId = op.operationId;
          if (item.accepted && !access.accept(op)) { failure(ctx, error(E.STALE_OPERATION)); return; }
          if (key !== null) item.manual = true;
        }
        ctx.operations = ctx.operations.filter((op) => !old.has(op));
        for (const op of old) { access.cancel(op); access.forget(op); }
        if (key === null) ctx.manual = true;
        ctx.policyPromise = Promise.resolve(ctx.policy);
      }
      const item = key === null ? null : ctx.drafts.get(key);
      ctx.queue = ctx.queue.then(() => flush(ctx, key === null ? null : new Set([key]))).catch((caught) => failure(ctx, caught, item));
      await ctx.queue;
    }
    async function retry(event, key = null) {
      const ctx = current;
      if (!ctx || !live(ctx) || ctx.blocked || !access.trusted(event)) return;
      const item = key === null ? null : ctx.drafts.get(key);
      ctx.queue = ctx.queue.then(() => flush(ctx, key === null ? null : new Set([key]))).catch((caught) => failure(ctx, caught, item));
      await ctx.queue;
    }
    async function close(ctx = current) {
      if (!ctx) return null;
      if (ctx.closePromise) return ctx.closePromise;
      ctx.closed = true;
      if (current === ctx) current = null;
      const protectedOperations = new Set([...ctx.drafts.values()].filter(item => item.accepted && !item.settled).map(item => item.operation));
      for (const op of ctx.operations) if (!protectedOperations.has(op)) access.cancel(op);
      ctx.closePromise = (async () => {
        await ctx.queue.catch(() => {});
        for (const item of ctx.drafts.values()) {
          if (!item.saved && !item.settled) settle(item, null,
            error(ctx.policy?.enabled === false || ctx.policy?.excluded ? E.DISABLED : E.STALE_OPERATION));
        }
        await Promise.all(ctx.operations.map(async (op) => {
          const committed = [...ctx.drafts.values()].some(item => item.operation === op && item.saved);
          try {
            if (committed) return;
            access.cancel(op);
            await op.preparing?.catch(() => {});
            if (op.token) await send(M.CANCEL_OPERATION, { operationId: op.operationId });
          } catch { /* A closed card cannot claim cancellation or overwrite a new result. */ }
          finally { access.forget(op); }
        }));
        ctx.drafts.clear();
        if (!current && port) { const owned = port; port = null; invalidation = null; owned.disconnect(); }
        return ctx.referenceGeneration === referenceGeneration ? ctx.ref : null;
      })();
      return ctx.closePromise;
    }
    return Object.freeze({ start, assistant, discard, accept, refresh, save, retry, close, invalidateReference,
      decline(event) { if (access.trusted(event)) { declined = true; if (current) showAvailable(current); } },
      async open(event) {
        if (!access.trusted(event)) return;
        const ctx = current;
        try { await send(M.OPEN_LEARNING_CENTER, ctx?.ref?.recordId ? { recordId: ctx.ref.recordId } : {}); }
        catch (caught) {
          if (caught.code === E.NOT_READY) show(ctx, "invite", "content.reading.learningNotReady");
          else failure(ctx, caught);
        }
      },
      render() { if (current?.view && live(current)) onStatus(current.view); }, getCurrent: () => current });
  }
  app.modules.selectionRecordClient = Object.freeze({ create });
})();
