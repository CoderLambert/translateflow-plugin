(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || !app?.modules.textProjectionPolicy || app.modules.readingAnchorResolver) return;
  const projection = app.modules.textProjection, policy = app.modules.textProjectionPolicy;
  const TOTAL = { chars: 1_000_000, nodes: 25_000, ms: 250, retries: 3, debounceMs: 150 };
  const ROOTS = "p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main";
  const yieldFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const delay = (ms, signal) => new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(finish, ms); signal?.addEventListener("abort", abort, { once: true });
  });
  const aborted = (signal) => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };
  async function digest(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  function rangeKey(range, ids) {
    const id = node => { if (!ids.has(node)) ids.set(node, ids.size + 1); return ids.get(node); };
    return `${id(range.startContainer)}:${range.startOffset}:${id(range.endContainer)}:${range.endOffset}`;
  }
  function exactOffsets(text, exact) {
    const offsets = [];
    for (let at = text.indexOf(exact); at >= 0; at = text.indexOf(exact, at + 1)) offsets.push(at);
    return offsets;
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
  async function validateCandidate(value, start, anchor, expectedRevision, signal) {
    aborted(signal);
    if (!contextMatches(value.text, start, anchor)) return null;
    if (projection.revision() !== expectedRevision) return { stale: true };
    const range = projection.rangeForPosition(value, { start, end: start + anchor.quote.exact.length });
    if (!range || range.toString() !== anchor.quote.exact || !range.startContainer.isConnected || !range.endContainer.isConnected) return null;
    return { range };
  }
  async function collectRoots(totals, signal) {
    const roots = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.currentNode, sliceNodes = 0, sliceStarted = performance.now();
    while (node) {
      aborted(signal);
      totals.nodes++; sliceNodes++;
      if (totals.nodes > TOTAL.nodes) return { roots: [], limited: true };
      if (node.nodeType === 1 && node.matches?.(ROOTS)) roots.add(node);
      if (node.nodeType === 3 && node.length > 0) {
        let parent = node.parentElement;
        for (let depth = 0; parent && parent !== document.body && depth < 4; depth++, parent = parent.parentElement) {
          roots.add(parent); if (parent.matches?.(ROOTS)) break;
        }
      }
      node = walker.nextNode();
      const elapsed = performance.now() - sliceStarted;
      if (sliceNodes >= policy.limits.sliceNodes || elapsed >= policy.limits.sliceMs) {
        totals.ms += elapsed;
        if (totals.ms >= TOTAL.ms) return { roots: [], limited: true };
        await yieldFrame(); sliceNodes = 0; sliceStarted = performance.now();
      }
    }
    totals.ms += performance.now() - sliceStarted;
    return { roots: [...roots], limited: totals.ms >= TOTAL.ms };
  }
  async function attempt(anchor, signal) {
    const revision = projection.revision(), totals = { chars: 0, nodes: 0, ms: 0 }, matches = new Map(), ids = new Map();
    let unsupported = false, projected = false, limited = false;
    const addFrom = async value => {
      if (value.status !== "resolved") {
        unsupported = true;
        if (["char-budget", "node-budget", "time-budget"].includes(value.reason)) limited = true;
        return false;
      }
      projected = true; totals.nodes += value.stats?.nodes || 0; totals.chars += value.text.length; totals.ms += value.stats?.elapsedMs || 0;
      if (totals.nodes > TOTAL.nodes || totals.chars > TOTAL.chars || totals.ms >= TOTAL.ms) return true;
      if (anchor.blockDigest) {
        const started = performance.now(), valueDigest = await digest(value.text); totals.ms += performance.now() - started;
        if (projection.revision() !== revision) return "stale";
        if (totals.ms >= TOTAL.ms) { limited = true; return true; }
        if (valueDigest !== anchor.blockDigest) return false;
      }
      const candidateStarted = performance.now();
      for (const start of exactOffsets(value.text, anchor.quote.exact)) {
        if (totals.ms + performance.now() - candidateStarted >= TOTAL.ms) { limited = true; return true; }
        const candidate = await validateCandidate(value, start, anchor, revision, signal);
        if (candidate?.stale) return "stale";
        if (candidate?.range) matches.set(rangeKey(candidate.range, ids), candidate.range);
        if (matches.size > 1) return "ambiguous";
      }
      totals.ms += performance.now() - candidateStarted;
      return false;
    };
    const page = projection.project(document.body);
    let stopped = await addFrom(page);
    if (stopped === "stale") return { stale: true };
    if (stopped === "ambiguous") return { status: "ambiguous", range: null, stats: totals };
    if (!stopped && (page.status !== "resolved" || anchor.blockDigest)) {
      const collected = await collectRoots(totals, signal);
      if (collected.limited) stopped = true;
      for (const root of collected.roots) {
        aborted(signal);
        const value = projection.project(root);
        const result = await addFrom(value);
        if (result === "stale") return { stale: true };
        if (result === "ambiguous") return { status: "ambiguous", range: null, stats: totals };
        if (result) { stopped = true; break; }
        if (matches.size > 1) break;
        await yieldFrame();
      }
    }
    if (projection.revision() !== revision) return { stale: true };
    if (matches.size > 1) return { status: "ambiguous", range: null, stats: totals };
    if (matches.size === 1) return { status: "resolved", range: [...matches.values()][0], stats: totals };
    if (stopped || limited) return { status: "not-loaded", range: null, stats: totals };
    return { status: projected ? "missing" : unsupported ? "unsupported" : "missing", range: null, stats: totals };
  }
  async function resolve(anchor, { signal } = {}) {
    if (!anchor?.quote?.exact || !document.body) return { status: "unsupported", range: null, stats: { chars: 0, nodes: 0, ms: 0 } };
    projection.start();
    for (let retry = 0; retry < TOTAL.retries; retry++) {
      aborted(signal);
      const result = await attempt(anchor, signal);
      if (!result.stale) return { ...result, retries: retry };
      if (retry + 1 < TOTAL.retries) await delay(TOTAL.debounceMs, signal);
    }
    return { status: "not-loaded", range: null, stats: { chars: 0, nodes: 0, ms: 0 }, retries: TOTAL.retries };
  }
  async function resolvePage(items, { signal, retry = 0 } = {}) {
    aborted(signal); projection.start();
    const revision = projection.revision(), page = projection.project(document.body), results = new Map();
    if (page.status !== "resolved") {
      const status = ["char-budget", "node-budget", "time-budget"].includes(page.reason) ? "not-loaded" : "unsupported";
      for (const item of items) results.set(item.recordId, { status, range: null }); return results;
    }
    const started = performance.now(), roots = new Map(), ids = new Map(); let nodes = page.stats?.nodes || 0, chars = page.text.length;
    for (const item of items) {
      aborted(signal); const matches = new Map(), anchor = item.anchor;
      for (const start of exactOffsets(page.text, anchor.quote.exact)) {
        if (performance.now() - started >= TOTAL.ms || nodes >= TOTAL.nodes || chars >= TOTAL.chars) break;
        const range = projection.rangeForPosition(page, { start, end: start + anchor.quote.exact.length });
        if (!range || range.toString() !== anchor.quote.exact) continue;
        const root = contextRoot(range); let local = roots.get(root);
        if (!local) {
          const value = projection.project(root); nodes += value.stats?.nodes || 0; chars += value.text?.length || 0;
          local = { value, digest: null }; roots.set(root, local);
        }
        if (local.value.status !== "resolved") continue;
        const position = projection.positionForRange(local.value, range);
        if (!position || !contextMatches(local.value.text, position.start, anchor)) continue;
        if (anchor.blockDigest) {
          local.digest ||= await digest(local.value.text);
          if (local.digest !== anchor.blockDigest) continue;
        }
        if (projection.revision() !== revision) {
          if (retry + 1 >= TOTAL.retries) { for (const pending of items) results.set(pending.recordId, { status: "not-loaded", range: null }); return results; }
          await delay(TOTAL.debounceMs, signal); return resolvePage(items, { signal, retry: retry + 1 });
        }
        matches.set(rangeKey(range, ids), range); if (matches.size > 1) break;
      }
      const limited = performance.now() - started >= TOTAL.ms || nodes >= TOTAL.nodes || chars >= TOTAL.chars;
      results.set(item.recordId, matches.size > 1 ? { status: "ambiguous", range: null } : matches.size === 1 ? { status: "resolved", range: [...matches.values()][0] } : { status: limited ? "not-loaded" : "missing", range: null });
      if (limited) for (const pending of items) if (!results.has(pending.recordId)) results.set(pending.recordId, { status: "not-loaded", range: null });
      if (limited) break;
    }
    return results;
  }
  app.modules.readingAnchorResolver = Object.freeze({ resolve, resolvePage });
})();
