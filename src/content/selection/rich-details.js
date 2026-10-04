(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (
    !app?.modules.runtime
    || !app?.modules.selectionPopover
    || app.modules.selectionRichDetails
  ) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const popover = app.modules.selectionPopover;
  const MAX_CONCURRENT_LOOKUPS = 3;
  const REQUEST_ID_PREFIX = "selection-rich-lookup-";
  const CONTENT_DOCUMENT_OWNER_TOKEN = createContentDocumentOwnerToken();
  const lookupQueue = [];
  let activeSession = null;
  let runningLookups = 0;
  let fallbackRequestCounter = 0;
  let lifecycle = null;
  let routeWatchTimer = null;
  let nativeNavigationEvents = false;

  async function load(snapshot, version, expectedPage, isCurrentSelection, onResult = null) {
    if (activeSession) void cancelSession(activeSession);
    const session = {
      snapshot,
      version,
      expectedPage,
      isCurrentSelection,
      onResult,
      cancelled: false,
      cancelPromise: null,
      lookupStates: new Map(),
      queuedJobs: new Set(),
      inFlightRequests: new Set(),
      pendingJobs: new Set()
    };
    activeSession = session;
    startRouteWatcher();

    try {
      const response = await sendRuntimeMessage({
        type: messages.background.RICH_MDICT_VIEWER_LIST
      });
      if (!isLiveSession(session) || !response?.ok) return;

      const dictionaries = Array.isArray(response.dictionaries) ? response.dictionaries : [];
      popover.appendRichDictionaryCards(dictionaries, (dictionary, card) => {
        void lookupDictionary(session, dictionary, card);
      });
    } catch {
      // Detailed dictionary reads do not delay or replace the primary result.
    }
  }

  function isLiveSession(session) {
    return activeSession === session
      && !session.cancelled
      && session.isCurrentSelection(session.version, session.snapshot, session.expectedPage);
  }

  async function lookupDictionary(session, dictionary, card) {
    const dictionaryId = String(dictionary?.id || "");
    if (!isLiveSession(session) || !dictionaryId) return;

    if (dictionary?.status && dictionary.status !== "ready") {
      let state = session.lookupStates.get(dictionaryId);
      if (state?.settled) return;
      if (!state) {
        state = { inFlight: false, settled: true };
        session.lookupStates.set(dictionaryId, state);
      } else {
        state.settled = true;
      }
      card.setError("content.rich.currentUnavailable");
      return;
    }

    let state = session.lookupStates.get(dictionaryId);
    if (!state) {
      state = { inFlight: false, settled: false };
      session.lookupStates.set(dictionaryId, state);
    }
    const request = async (retry = false) => {
      if (!isLiveSession(session)) return;
      if (state.inFlight || (state.settled && !retry)) return;
      state.inFlight = true;
      card.setLoading();
      try {
        const requestId = createLookupRequestId();
        const result = await scheduleLookup(session, requestId, card, () => {
          if (!isLiveSession(session)) return null;
          return sendRuntimeMessage({
            type: messages.background.RICH_MDICT_LOOKUP,
            requestId,
            ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN,
            text: session.snapshot.text,
            dictionaryId
          });
        });
        if (!result || !isLiveSession(session)) return;

        const lookupError = Array.isArray(result?.errors) ? result.errors[0] : null;
        if (!result?.ok || lookupError) {
          state.settled = true;
          card.setError("content.rich.lookupUnavailable", () => { void request(true); });
          return;
        }

        const records = Array.isArray(result.dictionaries) ? result.dictionaries : [];
        const record = records.find((item) => String(item?.id || "") === dictionaryId);
        if (result.found && records.length && !record) {
          state.settled = true;
          card.setError("content.rich.mismatch");
          return;
        }
        if (!result.found || !record) {
          state.settled = true;
          card.setEmpty();
          return;
        }

        state.settled = true;
        card.setResult(record, dictionaryId, (displayed) => {
          if (isLiveSession(session)) session.onResult?.(displayed, dictionary);
        });
      } catch {
        if (!isLiveSession(session)) return;
        state.settled = true;
        card.setError("content.rich.lookupUnavailable", () => { void request(true); });
      } finally {
        state.inFlight = false;
      }
    };

    void request();
  }

  function scheduleLookup(session, requestId, card, action) {
    return new Promise((resolve, reject) => {
      const job = {
        session,
        requestId,
        card,
        action,
        resolve,
        reject,
        settled: false
      };
      session.pendingJobs.add(job);
      session.queuedJobs.add(job);
      lookupQueue.push(job);
      drainLookups();
    });
  }

  function drainLookups() {
    while (runningLookups < MAX_CONCURRENT_LOOKUPS && lookupQueue.length) {
      const job = lookupQueue.shift();
      job.session.queuedJobs.delete(job);
      if (job.settled) continue;
      if (!isLiveSession(job.session)) {
        settleJob(job, null);
        continue;
      }

      runningLookups += 1;
      Promise.resolve()
        .then(() => {
          if (!isLiveSession(job.session)) return null;
          job.session.inFlightRequests.add(job.requestId);
          return job.action();
        })
        .then((result) => settleJob(job, result), (error) => settleJob(job, null, error))
        .finally(() => {
          job.session.inFlightRequests.delete(job.requestId);
          runningLookups = Math.max(0, runningLookups - 1);
          drainLookups();
        });
    }
  }

  function settleJob(job, result, error = null) {
    if (job.settled) return;
    job.settled = true;
    job.session.pendingJobs.delete(job);
    if (error) job.reject(error);
    else job.resolve(result);
  }

  function cancel() {
    if (!activeSession) return Promise.resolve({ cancelled: false, requestCount: 0 });
    return cancelSession(activeSession);
  }

  function cancelSession(session) {
    if (session.cancelPromise) return session.cancelPromise;
    session.cancelled = true;
    if (activeSession === session) {
      activeSession = null;
      stopRouteWatcher();
    }

    const pendingJobs = [...session.pendingJobs];
    for (const job of [...session.queuedJobs]) {
      const index = lookupQueue.indexOf(job);
      if (index >= 0) lookupQueue.splice(index, 1);
      session.queuedJobs.delete(job);
      settleJob(job, null);
    }
    for (const job of pendingJobs) settleJob(job, null);

    for (const job of pendingJobs) {
      job.card.setError("content.rich.selectionChanged");
    }
    const requestIds = [...session.inFlightRequests];
    session.cancelPromise = Promise.allSettled(requestIds.map((requestId) =>
      sendRuntimeMessage({
        type: messages.background.RICH_MDICT_LOOKUP_CANCEL,
        requestId,
        ownerToken: CONTENT_DOCUMENT_OWNER_TOKEN
      })
    )).then(() => ({ cancelled: requestIds.length > 0, requestCount: requestIds.length }));
    return session.cancelPromise;
  }

  function bindLifecycle(options = {}) {
    lifecycle = options;
    const checkRoute = (event) => {
      const activePage = lifecycle?.getActivePage?.();
      if (!activePage) {
        stopRouteWatcher();
        return;
      }
      const destinationUrl = event?.destination?.url || location.href;
      if (lifecycle?.getPageIdentity?.(destinationUrl) !== lifecycle?.getPageIdentity?.(activePage)) {
        lifecycle?.onRouteLeave?.();
      }
    };
    window.addEventListener("popstate", checkRoute, true);
    window.addEventListener("hashchange", checkRoute, true);
    window.addEventListener("pagehide", lifecycle?.onPageHide, true);
    if (globalThis.navigation && typeof globalThis.navigation.addEventListener === "function") {
      globalThis.navigation.addEventListener("navigate", checkRoute);
      nativeNavigationEvents = true;
    }
    if (activeSession) startRouteWatcher();
  }

  function startRouteWatcher() {
    if (!lifecycle || nativeNavigationEvents || routeWatchTimer !== null) return;
    // Poll only on browsers without Navigation API support, and only while a
    // Rich Selection session exists, to bound the compatibility fallback.
    routeWatchTimer = window.setInterval(() => {
      const activePage = lifecycle?.getActivePage?.();
      if (!activePage) {
        stopRouteWatcher();
        return;
      }
      if (lifecycle?.getPageIdentity?.(location.href) !== lifecycle?.getPageIdentity?.(activePage)) {
        lifecycle?.onRouteLeave?.();
      }
    }, 50);
  }

  function stopRouteWatcher() {
    if (routeWatchTimer === null) return;
    window.clearInterval(routeWatchTimer);
    routeWatchTimer = null;
  }

  function createLookupRequestId() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Extension contexts provide WebCrypto; this fallback is only for test/old browser harnesses.
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
      fallbackRequestCounter += 1;
      bytes[0] ^= fallbackRequestCounter & 0xff;
    }
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return REQUEST_ID_PREFIX + hex;
  }

  function createContentDocumentOwnerToken() {
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Supported browsers provide WebCrypto; retain isolation in test harnesses
      // that execute the content module without a browser crypto global.
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  app.modules.selectionRichDetails = Object.freeze({ load, cancel, dispose: cancel, bindLifecycle });
})();
