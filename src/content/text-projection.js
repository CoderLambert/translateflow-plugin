(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjectionBuilder || app.modules.textProjection) return;
  const policy = app.modules.textProjectionPolicy;
  const { createBuilder } = app.modules.textProjectionBuilder;
  let sourceRevision = 1, observer = null, watchedPage = null, routeTimer = null, viewportInvalidationQueued = false;
  const listeners = new Set();
  function consume(records) {
    if (!records.some(policy.sourceMutation)) return;
    invalidate();
  }
  function invalidate() {
    sourceRevision++;
    for (const listener of listeners) {
      try { listener(sourceRevision); } catch {}
    }
  }
  function invalidateViewport() {
    if (viewportInvalidationQueued) return;
    viewportInvalidationQueued = true;
    Promise.resolve().then(() => { viewportInvalidationQueued = false; invalidate(); });
  }
  function start(onInvalidation) {
    if (onInvalidation) listeners.add(onInvalidation);
    if (!observer) {
      observer = new MutationObserver(consume);
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeOldValue: true });
      const route = (event) => { if (watchedPage && app.modules.runtime.getPageIdentity(event?.destination?.url || location.href) !== watchedPage) invalidate(); };
      window.addEventListener("popstate", route); window.addEventListener("hashchange", route);
      window.addEventListener("pagehide", invalidate);
      window.addEventListener("resize", invalidateViewport, { passive: true });
      globalThis.visualViewport?.addEventListener?.("resize", invalidateViewport, { passive: true });
      globalThis.navigation?.addEventListener?.("navigate", route);
    }
    return () => { if (onInvalidation) listeners.delete(onInvalidation); };
  }
  function watchPage(pageUrl) {
    watchedPage = pageUrl ? app.modules.runtime.getPageIdentity(pageUrl) : null;
    if (routeTimer !== null) { clearInterval(routeTimer); routeTimer = null; }
    if (pageUrl && !globalThis.navigation?.addEventListener) routeTimer = setInterval(() => { if (app.modules.runtime.getPageIdentity(location.href) !== watchedPage) invalidate(); }, 50);
  }
  function revision() { if (observer) consume(observer.takeRecords()); return sourceRevision; }
  function project(root, { clock = () => performance.now(), budget = null } = {}) {
    const started = budget ? budget.clock() : null;
    budget ||= policy.createSliceBudget(clock);
    const phaseStarted = started ?? budget.started, builder = createBuilder({ maxUnits: Math.min(policy.limits.sliceChars, policy.limits.totalChars) }), domNodes = new Map();
    const stats = { nodes: 0, chars: 0, elapsedMs: 0 };
    const fail = (reason, sensitive = false) => ({ status: "unsupported", reason, sensitive, stats: { ...stats, elapsedMs: budget.clock() - phaseStarted } });
    const check = () => {
      if (policy.timeExpired(budget)) throw new Error("time-budget");
      if (builder.size > Math.min(policy.limits.sliceChars, policy.limits.totalChars)) throw new Error("char-budget");
    };
    if (policy.timeExpired(budget)) return fail("time-budget");
    if (budget.nodes >= policy.limits.sliceNodes) return fail("node-budget");
    if (!root || root.getRootNode() !== document) return fail("unsupported-root");
    try {
      for (let parent = root.parentElement; parent; parent = parent.parentElement) {
        check();
        if (budget.nodes >= policy.limits.sliceNodes) return fail("node-budget");
        stats.nodes++; budget.nodes++;
        const decision = policy.inspect(parent);
        if (decision.excluded || decision.unsupported) return fail(decision.reason || "excluded-ancestor", decision.sensitive);
        check();
      }
      const stack = [{ node: root, entered: false }];
      while (stack.length) {
        check();
        const frame = stack.at(-1), node = frame.node;
        if (!frame.entered) {
          if (budget.nodes >= Math.min(policy.limits.sliceNodes, policy.limits.totalNodes)) return fail("node-budget");
          stats.nodes++; budget.nodes++;
          frame.entered = true;
          if (node.nodeType === 3) {
            if (budget.chars + node.length > Math.min(policy.limits.sliceChars, policy.limits.totalChars)) return fail("char-budget");
            const key = `n${stats.nodes}`;
            if (/[\u0000\u0008\u000b]/u.test(node.nodeValue)) return fail("unsupported-text");
            domNodes.set(key, node);
            stats.chars += node.length; budget.chars += node.length;
            builder.append(key, node.nodeValue, 0, check);
          } else if (node.nodeType === 1) {
            const decision = policy.inspect(node);
            if (decision.unsupported) return fail(decision.reason, decision.sensitive);
            check();
            if (!decision.excluded) {
              frame.block = decision.block || String(node.localName || node.tagName).toUpperCase() === "BR";
              if (frame.block) builder.boundary();
              frame.child = node.firstChild;
            }
          }
        }
        if (frame.child) { const child = frame.child; frame.child = child.nextSibling; stack.push({ node: child, entered: false }); }
        else { if (frame.block) builder.boundary(); stack.pop(); }
      }
      check();
      const value = builder.finish();
      return { status: "resolved", ...value, domNodes, projectionVersion: policy.projectionVersion, stats: { ...stats, elapsedMs: budget.clock() - phaseStarted } };
    } catch (error) { return fail(error.message || "unsupported"); }
  }
  function createScanner(root, { clock = () => performance.now(), maxUnits = 1_025_000 } = {}) {
    const builder = createBuilder({ maxUnits }), domNodes = new Map();
    const stats = { nodes: 0, chars: 0, elapsedMs: 0 };
    const state = { stack: [{ node: root, entered: false }], ancestor: root?.parentElement || null, complete: false,
      incomplete: false, unsupported: false, reason: "", nextNodeKey: 1, finalized: null };
    function markIncomplete(reason, unsupported = false) {
      state.incomplete = true; state.unsupported ||= unsupported; state.reason ||= reason || "unsupported";
    }
    function scanSlice({ maxChars = policy.limits.sliceChars, maxNodes = policy.limits.sliceNodes, maxMs = policy.limits.sliceMs } = {}) {
      const started = clock(); let sliceChars = 0, sliceNodes = 0;
      const timeUp = () => clock() - started >= maxMs;
      const finishSlice = () => { stats.elapsedMs += Math.max(0, clock() - started); return progress(); };
      if (state.complete) return progress();
      if (!root || root.getRootNode() !== document) {
        markIncomplete("unsupported-root", true); state.stack.length = 0; state.ancestor = null; state.complete = true; return finishSlice();
      }
      try {
        while (state.ancestor || state.stack.length) {
          if (sliceNodes >= maxNodes || sliceChars >= maxChars || timeUp()) break;
          if (state.ancestor) {
            const parent = state.ancestor; state.ancestor = parent.parentElement;
            sliceNodes++; stats.nodes++;
            const decision = policy.inspect(parent);
            if (decision.excluded || decision.unsupported) {
              markIncomplete(decision.reason || "excluded-ancestor", decision.unsupported);
              state.stack.length = 0; state.ancestor = null; state.complete = true; break;
            }
            continue;
          }
          const frame = state.stack.at(-1), node = frame.node;
          if (!frame.entered) {
            if (sliceNodes >= maxNodes || stats.nodes >= policy.limits.totalNodes) { markIncomplete("node-budget"); break; }
            frame.entered = true; sliceNodes++; stats.nodes++;
            if (node.nodeType === 3) {
              const length = node.length;
              if (length > policy.limits.sliceChars) {
                markIncomplete("oversized-text-node"); frame.textOffset = length;
              } else {
                const text = node.nodeValue || "";
                if (/[\u0000\u0008\u000b]/u.test(text)) { markIncomplete("unsupported-text", true); frame.textOffset = length; }
                else { frame.text = text; frame.textOffset = 0; frame.nodeKey = `n${state.nextNodeKey++}`; domNodes.set(frame.nodeKey, node); }
              }
            } else if (node.nodeType === 1) {
              const decision = policy.inspect(node);
              if (decision.unsupported) { markIncomplete(decision.reason, true); frame.skip = true; }
              else if (!decision.excluded) {
                frame.block = decision.block || String(node.localName || node.tagName).toUpperCase() === "BR";
                if (frame.block) builder.boundary();
                frame.child = node.firstChild;
              } else frame.skip = true;
            }
          }
          if (frame.text !== undefined && frame.textOffset < frame.text.length) {
            const remaining = Math.min(maxChars - sliceChars, policy.limits.totalChars - stats.chars);
            if (remaining <= 0) break;
            const size = Math.min(remaining, frame.text.length - frame.textOffset, 64);
            const start = frame.textOffset, chunk = frame.text.slice(start, start + size);
            builder.append(frame.nodeKey, chunk, start);
            frame.textOffset += size; sliceChars += size; stats.chars += size;
            if (frame.textOffset < frame.text.length) {
              if (sliceChars >= maxChars || timeUp()) break;
              continue;
            }
          }
          if (frame.text !== undefined || frame.skip || !frame.child) {
            if (frame.block) builder.boundary();
            state.stack.pop(); continue;
          }
          const child = frame.child; frame.child = child.nextSibling; state.stack.push({ node: child, entered: false });
        }
        if (!state.stack.length && !state.ancestor) state.complete = true;
      } catch (error) {
        markIncomplete(error.message || "unsupported", error.message === "unsupported");
        state.stack.length = 0; state.ancestor = null; state.complete = true;
      }
      return finishSlice();
    }
    function finalize() {
      if (state.complete && !state.finalized) {
        const value = builder.finish();
        state.finalized = { status: "resolved", ...value, domNodes, projectionVersion: policy.projectionVersion };
      }
    }
    function progress() {
      finalize();
      return { complete: state.complete, incomplete: state.incomplete, unsupported: state.unsupported,
        reason: state.reason, stats: { ...stats } };
    }
    function snapshot() {
      const status = progress();
      const value = state.finalized || { status: "resolved", ...builder.view(), domNodes, projectionVersion: policy.projectionVersion };
      return { ...value, ...status };
    }
    return { scanSlice, progress, snapshot, get complete() { return state.complete; }, get incomplete() { return state.incomplete; } };
  }
  function pointCell(projection, container, offset, end, budget) {
    const entries = [...projection.domNodes];
    function findCell(key, offset) {
      const node = projection.nodes.get(key);
      let index = offset - node.baseOffset - (end ? 1 : 0);
      while (index >= 0 && index < node.cells.length) {
        if (budget && policy.timeExpired(budget)) return null;
        const cell = node.cells[index];
        if (cell?.entry && projection.mapping[cell.index] === cell.entry) return cell.index + (end ? 1 : 0);
        index += end ? -1 : 1;
      }
      return null;
    }
    let direct;
    for (const [key, node] of entries) {
      if (budget && policy.timeExpired(budget)) return null;
      if (node === container) { direct = key; break; }
    }
    if (direct) { const found = findCell(direct, offset); if (found !== null) return found; }
    if (budget && policy.timeExpired(budget)) return null;
    const point = document.createRange(); point.setStart(container, offset); point.collapse(true);
    for (const [key, node] of end ? entries.slice().reverse() : entries) {
      if (budget && policy.timeExpired(budget)) return null;
      if (point.comparePoint(node, end ? 0 : node.length) !== (end ? -1 : 1)) continue;
      const found = findCell(key, end ? node.length : 0);
      if (found !== null) return found;
    }
    return null;
  }
  function positionForRange(projection, range, { budget } = {}) {
    if (projection?.status !== "resolved") return null;
    let start = pointCell(projection, range.startContainer, range.startOffset, false, budget);
    let end = pointCell(projection, range.endContainer, range.endOffset, true, budget);
    if (start === null || end === null || start >= end) return null;
    return start < end ? { start, end } : null;
  }
  function rangeForPosition(projection, { start, end }, { budget } = {}) {
    if (budget && policy.timeExpired(budget)) return null;
    const first = projection.mapping?.slice(start, end).find(Boolean), last = projection.mapping?.slice(start, end).filter(Boolean).at(-1);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(projection.domNodes.get(first.start.nodeKey), first.start.offset);
    range.setEnd(projection.domNodes.get(last.end.nodeKey), last.end.offset);
    return budget && policy.timeExpired(budget) ? null : range;
  }
  function sameRange(left, right) {
    return Boolean(left && right && left.sourceRevision === right.sourceRevision && left.range?.startContainer === right.range?.startContainer &&
      left.range?.startOffset === right.range?.startOffset && left.range?.endContainer === right.range?.endContainer && left.range?.endOffset === right.range?.endOffset);
  }
  app.modules.textProjection = { project, createScanner, positionForRange, rangeForPosition, sameRange, revision, start, watchPage };
})();
