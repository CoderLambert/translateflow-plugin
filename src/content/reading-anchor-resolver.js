(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || !app?.modules.textProjectionPolicy || app.modules.readingAnchorResolver) return;
  const projection = app.modules.textProjection, policy = app.modules.textProjectionPolicy;
  const TOTAL = { chars: 1_000_000, nodes: 25_000, ms: 250, retries: 3, debounceMs: 150, items: 200 };
  const ROOTS = "p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main";
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
  function rootCandidates(exacts) {
    const matches = []; let chars = 0, nodes = 0;
    for (const root of document.querySelectorAll(ROOTS)) {
      let text = "";
      const stack = [...root.childNodes].reverse();
      try {
        while (stack.length) {
          if (++nodes > TOTAL.nodes || chars + text.length > TOTAL.chars) return { matches, limited: true };
          const node = stack.pop();
          if (node.nodeType === 3) {
            text += String(node.data || "");
            if (chars + text.length > TOTAL.chars) return { matches, limited: true };
            continue;
          }
          if (node.nodeType !== 1 || node.matches?.(ROOTS)) continue;
          for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push(node.childNodes[index]);
        }
      } catch { return { matches, limited: true }; }
      chars += text.length;
      if (exacts.some((exact) => text.includes(exact))) matches.push(root);
    }
    return { matches, limited: false };
  }
  function sameRoots(left, right) {
    return left.length === right.length && left.every((root, index) => root === right[index]);
  }
  async function resolveVerifiedBlocks(items, signal) {
    const started = performance.now(), metrics = emptyStats(), results = new Map(), ids = new Map();
    const eligible = items.slice(0, TOTAL.items).filter((item) =>
      typeof item?.anchor?.quote?.exact === "string" && item.anchor.quote.exact && typeof item.anchor.blockDigest === "string" && item.anchor.blockDigest
    );
    if (!eligible.length) return { results, revision: null };
    projection.start();
    const exacts = [...new Set(eligible.map((item) => item.anchor.quote.exact))];
    const candidates = rootCandidates(exacts), roots = candidates.matches;
    if (candidates.limited || roots.length > TOTAL.nodes) return { results, revision: projection.revision() };
    const projected = new Map();
    for (const root of roots) {
      aborted(signal);
      if (performance.now() - started >= TOTAL.ms) return { results: new Map(), revision: projection.revision() };
      const value = projection.project(root);
      metrics.nodes += value.stats?.nodes || 0; metrics.chars += value.stats?.chars || 0;
      if (metrics.nodes >= TOTAL.nodes || metrics.chars >= TOTAL.chars) return { results: new Map(), revision: projection.revision() };
      if (value.status !== "resolved") continue;
      projected.set(root, { value, digest: await digest(value.text) });
    }
    aborted(signal);
    const currentRoots = rootCandidates(exacts);
    if (currentRoots.limited || !sameRoots(roots, currentRoots.matches)) return { results: new Map(), revision: projection.revision() };
    for (const [root, cached] of projected) {
      const current = projection.project(root);
      metrics.nodes += current.stats?.nodes || 0; metrics.chars += current.stats?.chars || 0;
      if (current.status !== "resolved" || current.text !== cached.value.text) return { results: new Map(), revision: projection.revision() };
    }
    for (const item of eligible) {
      const anchor = item.anchor, exact = anchor.quote.exact, matches = new Map();
      for (const [root, cached] of projected) {
        if (cached.digest !== anchor.blockDigest) continue;
        for (let start = cached.value.text.indexOf(exact); start >= 0; start = cached.value.text.indexOf(exact, start + 1)) {
          if (!contextMatches(cached.value.text, start, anchor)) continue;
          const range = projection.rangeForPosition(cached.value, { start, end: start + exact.length });
          if (!range || contextRoot(range) !== root || !range.startContainer.isConnected || !range.endContainer.isConnected || String(range.toString()) !== exact) continue;
          matches.set(rangeKey(range, ids), range);
          if (matches.size > 1) break;
        }
        if (matches.size > 1) break;
      }
      if (matches.size > 1) results.set(item.recordId, { status: "ambiguous", range: null, stats: { ...metrics } });
      else if (matches.size === 1) results.set(item.recordId, { status: "resolved", range: [...matches.values()][0],
        verifiedText: exact, stats: { ...metrics } });
    }
    metrics.ms = Math.max(0, performance.now() - started);
    for (const result of results.values()) result.stats = { ...metrics };
    return { results, revision: projection.revision() };
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
    const processingStarted = performance.now(), roots = state.rootProjections, ids = new Map(), results = new Map();
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
          let cached = roots.get(root);
          if (!cached) {
            const value = projection.project(root);
            metrics.nodes += value.stats?.nodes || 0; metrics.chars += value.stats?.chars || 0;
            cached = { value, digest: null };
            if (value.status === "resolved" || value.reason !== "time-budget") roots.set(root, cached);
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
  async function resolveItems(items, { signal, verifiedBlocksFirst = false } = {}) {
    if (!Array.isArray(items) || !document.body) return { results: unresolved(Array.isArray(items) ? items : [], "unsupported"), retries: 0 };
    const capped = items.slice(0, TOTAL.items), overflow = items.slice(TOTAL.items);
    const local = verifiedBlocksFirst ? await resolveVerifiedBlocks(capped, signal) : { results: new Map(), revision: null };
    const pending = capped.filter((item) => !local.results.has(item.recordId));
    if (!pending.length) {
      const combined = new Map(local.results);
      for (const [recordId, value] of unresolved(overflow)) combined.set(recordId, value);
      return { results: combined, retries: 0, projectionRevision: local.revision };
    }
    for (let retry = 0; retry < TOTAL.retries; retry++) {
      aborted(signal);
      const result = await resolveAtRevision(pending, signal, retry);
      if (result) {
        const combined = new Map(local.results);
        for (const [recordId, value] of result.results) combined.set(recordId, value);
        for (const [recordId, value] of unresolved(overflow)) combined.set(recordId, value);
        return { results: combined, retries: retry, projectionRevision: result.revision };
      }
      if (retry + 1 < TOTAL.retries) await delay(TOTAL.debounceMs, signal);
    }
    const combined = new Map(local.results);
    for (const [recordId, value] of unresolved([...pending, ...overflow])) combined.set(recordId, value);
    return { results: combined, retries: TOTAL.retries, projectionRevision: local.results.size ? local.revision : null };
  }
  async function resolve(anchor, { signal } = {}) {
    const recordId = "__single__";
    const result = await resolveItems([{ recordId, anchor }], { signal });
    return { ...(result.results.get(recordId) || { status: "not-loaded", range: null, stats: emptyStats() }), retries: result.retries };
  }
  async function resolvePage(items, { signal, verifiedBlocksFirst = false } = {}) {
    const result = await resolveItems(items, { signal, verifiedBlocksFirst });
    Object.defineProperty(result.results, "projectionRevision", { value: result.projectionRevision, enumerable: false });
    return result.results;
  }
  app.modules.readingAnchorResolver = Object.freeze({ resolve, resolvePage });
})();
