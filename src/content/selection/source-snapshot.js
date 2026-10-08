(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || app.modules.selectionSourceSnapshot) return;
  const projection = app.modules.textProjection, policy = app.modules.textProjectionPolicy;
  const contextBlockTags = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "DD", "DETAILS", "DIV", "DL", "DT",
    "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
    "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"]);
  // Mirrors the resolver's historical scope so new local contexts preserve saved anchor identity.
  const readingAnchorRoots = "p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main";
  // This local document marker is evidence only; #232 must bind trusted sender authority.
  function randomId(prefix) { const bytes = crypto.getRandomValues(new Uint8Array(16)); return prefix + [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  const documentGeneration = randomId("doc-");
  const contextRoot = (range) => {
    const common = range?.commonAncestorContainer;
    const origin = common?.nodeType === 1 ? common : common?.parentElement;
    let element = origin;
    for (let count = 0; element && count < policy.limits.sliceNodes; count++, element = element.parentElement) {
      if (contextBlockTags.has(String(element.localName || element.tagName).toUpperCase())) return element;
    }
    return origin;
  };
  const readingAnchorRoot = (range) => {
    const common = range?.commonAncestorContainer;
    const origin = common?.nodeType === 1 ? common : common?.parentElement;
    return origin?.closest?.(readingAnchorRoots) || origin;
  };
  function boundedText(text, position, maxChars) {
    const center = (position.start + position.end) / 2;
    let start = Math.max(0, Math.floor(center - maxChars / 2));
    const end = Math.min(text.length, start + maxChars);
    start = Math.max(0, end - maxChars);
    return { text: text.slice(start, end), truncated: start > 0 || end < text.length };
  }
  function localProjection(range, budget, root = contextRoot(range)) {
    const value = projection.project(root, { budget });
    if (value.status === "resolved") return value;
    if (!["char-budget", "node-budget", "time-budget"].includes(value.reason) || range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) return value;
    const check = () => { if (policy.timeExpired(budget)) throw new Error("time-budget"); };
    try {
      check();
      const node = range.startContainer;
      const from = Math.max(0, range.startOffset - 600), to = Math.min(node.length, range.endOffset + 600);
      if (to - from > 4000) return value;
      if (budget.nodes >= policy.limits.sliceNodes || budget.chars + to - from > policy.limits.sliceChars) return value;
      budget.nodes++; budget.chars += to - from;
      const text = node.substringData(from, to - from);
      check();
      if (/[\u0000\u0008\u000b]/u.test(text)) return { status: "unsupported", reason: "unsupported-text" };
      const builder = app.modules.textProjectionBuilder.createBuilder({ maxUnits: 4000 });
      builder.append("local", text, from, check); check();
      return { status: "resolved", ...builder.finish(), domNodes: new Map([["local", node]]), localWindow: true };
    } catch { return value; }
  }
  function selectionPosition(value, range, budget) {
    const position = projection.positionForRange(value, range, { budget });
    if (!position) return null;
    while (position.start < position.end && /[\t\n\r\f ]/u.test(value.text[position.start])) position.start++;
    while (position.end > position.start && /[\t\n\r\f ]/u.test(value.text[position.end - 1])) position.end--;
    return position.start < position.end ? position : null;
  }
  const comparable = (text) => text.replace(/[\t\n\r\f ]+/gu, " ").replace(/^ +| +$/gu, "");
  function freezeRange(range) {
    if (!range) return null;
    try {
      return Object.freeze({
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset,
        text: String(range.toString())
      });
    } catch { return null; }
  }
  function rangeMatches(range, frozen) {
    if (!range || !frozen || !range.startContainer?.isConnected || !range.endContainer?.isConnected) return false;
    try {
      return range.startContainer === frozen.startContainer
        && range.startOffset === frozen.startOffset
        && range.endContainer === frozen.endContainer
        && range.endOffset === frozen.endOffset
        && String(range.toString()) === frozen.text;
    } catch { return false; }
  }
  function localCapture(snapshot, { maxChars = 900 } = {}) {
    const budget = policy.createSliceBudget();
    const sourceRevision = projection.revision();
    const decision = policy.rangePolicy(snapshot.range, snapshot.text, { budget });
    let selectedText = snapshot.text, text = "", prefix = "", suffix = "", localPosition = null, localBlockText = null, localRoot = null;
    let truncated = false;
    if (decision.supported) {
      localRoot = contextRoot(snapshot.range);
      const local = localProjection(snapshot.range, budget, localRoot);
      localPosition = selectionPosition(local, snapshot.range, budget);
      if (local.sensitive) decision.sensitive = true;
      if (localPosition && comparable(local.text.slice(localPosition.start, localPosition.end)) === comparable(snapshot.text)) {
        selectedText = local.text.slice(localPosition.start, localPosition.end);
        const context = boundedText(local.text, localPosition, Math.min(900, Math.max(1, maxChars)));
        text = context.text; truncated = context.truncated || Boolean(local.localWindow);
        prefix = local.text.slice(Math.max(0, localPosition.start - 120), localPosition.start);
        suffix = local.text.slice(localPosition.end, localPosition.end + 120);
        if (!local.localWindow) localBlockText = local.text;
      }
    }
    return { budget, sourceRevision, decision, selectedText, text, prefix, suffix, localPosition, localBlockText, localRoot, truncated };
  }
  function readingAnchorBlockText(range, localRoot, localBlockText, budget) {
    if (localBlockText === null) return null;
    const root = readingAnchorRoot(range);
    if (root === localRoot) return localBlockText;
    const value = projection.project(root, { budget });
    return value.status === "resolved" ? value.text : null;
  }
  function capture(snapshot, { maxChars = 900 } = {}) {
    const rangeIdentity = snapshot.rangeIdentity || freezeRange(snapshot.range);
    const local = localCapture(snapshot, { maxChars });
    const { budget, sourceRevision, decision, selectedText, text, prefix, suffix, localPosition, localBlockText, localRoot, truncated } = local;
    const blockText = readingAnchorBlockText(snapshot.range, localRoot, localBlockText, budget);
    let position = null, status = "unsupported";
    if (localBlockText !== null) {
      const full = projection.project(document.body, { budget });
      const globalPosition = selectionPosition(full, snapshot.range, budget);
      if (globalPosition && localPosition && full.text.slice(globalPosition.start, globalPosition.end) === selectedText) {
        status = "resolved"; position = globalPosition;
      }
    }
    const context = Object.freeze({ text, sensitive: decision.sensitive, source: text ? "visible-local" : "selection-only", truncated });
    const frozen = { schemaVersion: 1, sourceSnapshotId: randomId("source-"), selectedText, contextText: text,
      contextMode: text ? "bounded-context" : "selection-only", projectionVersion: policy.projectionVersion,
      documentGeneration, selectionGeneration: snapshot.selectionGeneration || 1,
      anchor: { status, quote: { exact: selectedText, prefix, suffix }, position, blockDigest: null }, capturedAt: Date.now() };
    const result = { sourceRevision, root: decision.supported && !decision.sensitive ? "document" : "unsupported",
      selectedText, rangeIdentity, capability: status, context, sourceSnapshot: null };
    const validText = selectedText?.trim() && selectedText.length <= 2000 && !/[\u0000\u0008\u000b\u000c]/u.test(selectedText);
    result.ready = (validText ? Promise.all([digest(JSON.stringify([frozen.projectionVersion, selectedText, frozen.contextMode, text])), blockText === null ? null : digest(blockText)])
      : Promise.reject(new Error("unsupported selected text")))
      .then(([sourceDigest, blockDigest]) => {
        frozen.sourceDigest = sourceDigest; frozen.anchor.blockDigest = blockDigest;
        Object.freeze(frozen.anchor.quote); if (position) Object.freeze(position); Object.freeze(frozen.anchor);
        result.sourceSnapshot = Object.freeze(frozen);
        return result.sourceSnapshot;
      }).catch((error) => { result.capability = "unsupported"; result.reason = validText ? "digest-unavailable" : "unsupported-text"; throw error; });
    // Query UI remains usable if WebCrypto is unavailable on an insecure page.
    result.ready.catch(() => {});
    return result;
  }
  function matches(snapshot, frozen) {
    if (!snapshot?.range || !frozen || !rangeMatches(snapshot.range, frozen.rangeIdentity || snapshot.rangeIdentity)) return false;
    try {
      const current = localCapture(snapshot);
      return current.selectedText === frozen.selectedText
        && current.text === frozen.context?.text
        && Boolean(current.decision.sensitive) === Boolean(frozen.context?.sensitive);
    } catch { return false; }
  }
  function matchesCurrentPage(snapshot, frozen, currentUrl, getPageIdentity) {
    return Boolean(snapshot)
      && getPageIdentity(snapshot.pageUrl) === getPageIdentity(currentUrl)
      && (frozen ? matches(snapshot, frozen) : rangeMatches(snapshot.range, snapshot.rangeIdentity));
  }
  async function digest(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function canonicalize(range, text) {
    const budget = policy.createSliceBudget();
    if (!policy.rangePolicy(range, text, { budget }).supported) return { range, text };
    const value = localProjection(range, budget), position = selectionPosition(value, range, budget);
    if (!position || comparable(value.text.slice(position.start, position.end)) !== comparable(text)) return { range, text };
    const canonicalRange = projection.rangeForPosition(value, position, { budget });
    return canonicalRange ? { range: canonicalRange, text: value.text.slice(position.start, position.end) } : { range, text };
  }
  app.modules.selectionSourceSnapshot = { capture, matches, matchesCurrentPage, freezeRange, rangeMatches, contextRoot, canonicalize, documentGeneration };
})();
