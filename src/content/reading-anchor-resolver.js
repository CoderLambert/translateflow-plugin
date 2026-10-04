(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || !app?.modules.textProjectionPolicy || app.modules.readingAnchorResolver) return;
  const projection = app.modules.textProjection, policy = app.modules.textProjectionPolicy;
  const TOTAL = { chars: 1_000_000, nodes: 25_000, ms: 250, retries: 3, debounceMs: 150, items: 200 };
  const ROOTS = "p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main";
  const TRANSIENT_PROJECTION_REASONS = new Set(["time-budget"]);
  let sharedScan = null;
  const aborted = (signal) => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
  const yieldFrame = signal => new Promise((resolve, reject) => {
    aborted(signal);
    const id = requestAnimationFrame(() => { signal?.removeEventListener("abort", abort); resolve(); });
    const abort = () => { cancelAnimationFrame(id); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
  async function digest(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function rangeKey(range, ids) {
    const id = node => { if (!ids.has(node)) ids.set(node, ids.size + 1); return ids.get(node); };
    return [id(range.startContainer), range.startOffset, id(range.endContainer), range.endOffset].join(":");
  }
  function contextMatches(text, start, anchor) {
    const { exact, prefix, suffix } = anchor.quote;
    return text.slice(start, start + exact.length) === exact &&
      (!prefix || text.slice(0, start).endsWith(prefix)) &&
      (!suffix || text.slice(start + exact.length).startsWith(suffix));
  }
  function contextRoot(range) {
    const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    return element?.closest(ROOTS) || element;
  }
  function freshScan(revision) {
    const scanner = projection.createScanner(document.body);
    sharedScan = { revision, scanner, rootProjections: new Map() };
    return sharedScan;
  }
  function discardScan(state) { if (sharedScan === state) sharedScan = null; }
  async function scanPage(signal) {
    projection.start();
    const revision = projection.revision();
    let state = sharedScan?.revision === revision ? sharedScan : freshScan(revision);
    let waitMs = 0;
    while (!state.scanner.complete) {
      aborted(signal);
      if (projection.revision() !== revision) { discardScan(state); return { stale: true, revision, state }; }
      const stats = state.scanner.progress().stats;
      const remainingChars = TOTAL.chars - stats.chars, remainingNodes = TOTAL.nodes - stats.nodes, remainingMs = TOTAL.ms - stats.elapsedMs;
      if (remainingChars <= 0 || remainingNodes <= 0 || remainingMs <= 0) {
        return { revision, value: state.scanner.snapshot(), waitMs, limited: true, state };
      }
      const value = state.scanner.scanSlice({ maxChars: Math.min(policy.limits.sliceChars, remainingChars),
        maxNodes: Math.min(policy.limits.sliceNodes, remainingNodes), maxMs: Math.min(policy.limits.sliceMs, remainingMs) });
      if (projection.revision() !== revision) { discardScan(state); return { stale: true, revision, state }; }
      if (value.complete) return { revision, value: state.scanner.snapshot(), waitMs, limited: false, state };
      const nextStats = value.stats;
      if (nextStats.chars >= TOTAL.chars || nextStats.nodes >= TOTAL.nodes || nextStats.elapsedMs >= TOTAL.ms) {
        return { revision, value: state.scanner.snapshot(), waitMs, limited: true, state };
      }
      const waiting = performance.now();
      await yieldFrame(signal);
      waitMs += Math.max(0, performance.now() - waiting);
    }
    return { revision, value: state.scanner.snapshot(), waitMs, limited: false, state };
  }
  function emptyStats() { return { chars: 0, nodes: 0, ms: 0, waitMs: 0 }; }
  function unresolved(items, status = "not-loaded") {
    return new Map(items.map(item => [item.recordId, { status, range: null, stats: emptyStats() }]));
  }
  async function resolveAtRevision(items, signal, retry) {
    const page = await scanPage(signal);
    if (page.stale) return null;
    const state = page.state;
    const metrics = { chars: page.value.stats.chars, nodes: page.value.stats.nodes,
      ms: page.value.stats.elapsedMs, waitMs: page.waitMs };
    const processingStarted = performance.now(), roots = state.rootProjections, attemptRoots = new Map(), ids = new Map(), results = new Map();
    const stale = () => projection.revision() !== page.revision;
    const overBudget = () => metrics.chars >= TOTAL.chars || metrics.nodes >= TOTAL.nodes ||
      metrics.ms + Math.max(0, performance.now() - processingStarted) >= TOTAL.ms;
    for (const item of items.slice(0, TOTAL.items)) {
      aborted(signal);
      if (stale()) { discardScan(state); return null; }
      const anchor = item?.anchor, exact = anchor?.quote?.exact;
      if (typeof exact !== "string" || !exact) { results.set(item.recordId, { status: "unsupported", range: null, stats: { ...metrics } }); continue; }
      const matches = new Map(); let unverified = false, limited = false;
      for (let start = page.value.text.indexOf(exact); start >= 0; start = page.value.text.indexOf(exact, start + 1)) {
        if (overBudget()) { limited = true; break; }
        if (!contextMatches(page.value.text, start, anchor)) continue;
        const range = projection.rangeForPosition(page.value, { start, end: start + exact.length });
        if (!range || !range.startContainer.isConnected || !range.endContainer.isConnected) continue;
        const located = projection.positionForRange(page.value, range);
        if (!located || page.value.text.slice(located.start, located.end) !== exact) continue;
        if (anchor.blockDigest) {
          const root = contextRoot(range);
          let cached = roots.get(root) || attemptRoots.get(root);
          if (!cached) {
            const value = projection.project(root);
            metrics.nodes += value.stats?.nodes || 0; metrics.chars += value.stats?.chars || 0;
            cached = { value, digest: null }; attemptRoots.set(root, cached);
            if (value.status === "resolved" || !TRANSIENT_PROJECTION_REASONS.has(value.reason)) roots.set(root, cached);
          }
          if (cached.value.status !== "resolved") { unverified = true; continue; }
          if (!cached.digest) cached.digest = digest(cached.value.text);
          const valueDigest = await cached.digest;
          if (stale()) { discardScan(state); return null; }
          if (overBudget()) { limited = true; break; }
          if (valueDigest !== anchor.blockDigest) continue;
        }
        matches.set(rangeKey(range, ids), range);
        if (matches.size > 1) break;
      }
      if (matches.size > 1) results.set(item.recordId, { status: "ambiguous", range: null, stats: { ...metrics } });
      else if (overBudget() || limited) results.set(item.recordId, { status: "not-loaded", range: null, stats: { ...metrics } });
      else if (matches.size === 1) {
        const coverageComplete = page.value.complete && !page.value.incomplete && !page.limited && !unverified;
        results.set(item.recordId, coverageComplete
          ? { status: "resolved", range: [...matches.values()][0], verifiedText: exact, stats: { ...metrics } }
          : { status: "not-loaded", range: null, stats: { ...metrics } });
      } else if (page.value.complete && !page.value.incomplete && !page.limited && !unverified) {
        results.set(item.recordId, { status: "missing", range: null, stats: { ...metrics } });
      } else if (page.value.complete && page.value.unsupported && metrics.chars === 0) {
        results.set(item.recordId, { status: "unsupported", range: null, stats: { ...metrics } });
      } else results.set(item.recordId, { status: "not-loaded", range: null, stats: { ...metrics } });
      if (stale()) { discardScan(state); return null; }
      if (overBudget()) {
        for (const pending of items) if (!results.has(pending.recordId)) results.set(pending.recordId, { status: "not-loaded", range: null, stats: { ...metrics } });
        break;
      }
    }
    for (const item of items.slice(TOTAL.items)) results.set(item.recordId, { status: "not-loaded", range: null, stats: { ...metrics } });
    metrics.ms += Math.max(0, performance.now() - processingStarted);
    for (const result of results.values()) result.stats = { ...metrics };
    if (stale()) { discardScan(state); return null; }
    return { revision: page.revision, results, retry };
  }
  async function resolveItems(items, { signal } = {}) {
    if (!Array.isArray(items) || !document.body) return { results: unresolved(Array.isArray(items) ? items : [], "unsupported"), retries: 0 };
    for (let retry = 0; retry < TOTAL.retries; retry++) {
      aborted(signal);
      const result = await resolveAtRevision(items, signal, retry);
      if (result) return { results: result.results, retries: retry };
      if (retry + 1 < TOTAL.retries) await delay(TOTAL.debounceMs, signal);
    }
    return { results: unresolved(items), retries: TOTAL.retries };
  }
  async function resolve(anchor, { signal } = {}) {
    const recordId = "__single__";
    const result = await resolveItems([{ recordId, anchor }], { signal });
    return { ...(result.results.get(recordId) || { status: "not-loaded", range: null, stats: emptyStats() }), retries: result.retries };
  }
  async function resolvePage(items, { signal } = {}) { return (await resolveItems(items, { signal })).results; }
  app.modules.readingAnchorResolver = Object.freeze({ resolve, resolvePage });
})();
