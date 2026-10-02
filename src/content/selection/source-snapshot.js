(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjection || app.modules.selectionSourceSnapshot) return;
  const projection = app.modules.textProjection, policy = app.modules.textProjectionPolicy;
  // This local document marker is evidence only; #232 must bind trusted sender authority.
  function randomId(prefix) { const bytes = crypto.getRandomValues(new Uint8Array(16)); return prefix + [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  const documentGeneration = randomId("doc-");
  const contextRoot = (range) => {
    const element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    return element?.closest("p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6,article,section,main") || element;
  };
  function boundedText(text, position, maxChars) {
    const center = (position.start + position.end) / 2;
    let start = Math.max(0, Math.floor(center - maxChars / 2));
    const end = Math.min(text.length, start + maxChars);
    start = Math.max(0, end - maxChars);
    return { text: text.slice(start, end), truncated: start > 0 || end < text.length };
  }
  function localProjection(range) {
    const root = contextRoot(range), value = projection.project(root);
    if (value.status === "resolved") return value;
    if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) return value;
    const node = range.startContainer;
    const from = Math.max(0, range.startOffset - 600), to = Math.min(node.length, range.endOffset + 600);
    if (to - from > 4000) return value;
    const builder = app.modules.textProjectionBuilder.createBuilder();
    const text = node.nodeValue.slice(from, to);
    if (/[\u0000\u0008\u000b]/u.test(text)) return { status: "unsupported", reason: "unsupported-text" };
    builder.append("local", text, from);
    return { status: "resolved", ...builder.finish(), domNodes: new Map([["local", node]]), localWindow: true };
  }
  function selectionPosition(value, range) {
    const position = projection.positionForRange(value, range);
    if (!position) return null;
    while (position.start < position.end && /[\t\n\r\f ]/u.test(value.text[position.start])) position.start++;
    while (position.end > position.start && /[\t\n\r\f ]/u.test(value.text[position.end - 1])) position.end--;
    return position.start < position.end ? position : null;
  }
  const comparable = (text) => text.replace(/[\t\n\r\f ]+/gu, " ").replace(/^ +| +$/gu, "");
  function capture(snapshot, { maxChars = 900 } = {}) {
    const sourceRevision = projection.revision(), decision = policy.rangePolicy(snapshot.range, snapshot.text);
    let selectedText = snapshot.text, text = "", prefix = "", suffix = "", position = null, blockText = null;
    let status = "unsupported", truncated = false;
    if (decision.supported) {
      const full = projection.project(document.body);
      const local = localProjection(snapshot.range), localPosition = selectionPosition(local, snapshot.range);
      const globalPosition = selectionPosition(full, snapshot.range);
      if (localPosition && comparable(local.text.slice(localPosition.start, localPosition.end)) === comparable(snapshot.text)) {
        selectedText = local.text.slice(localPosition.start, localPosition.end);
        const context = boundedText(local.text, localPosition, Math.min(900, Math.max(1, maxChars)));
        text = context.text; truncated = context.truncated || Boolean(local.localWindow);
        prefix = local.text.slice(Math.max(0, localPosition.start - 120), localPosition.start);
        suffix = local.text.slice(localPosition.end, localPosition.end + 120);
        if (!local.localWindow) blockText = local.text;
      }
      if (globalPosition && localPosition && full.text.slice(globalPosition.start, globalPosition.end) === selectedText && blockText !== null) {
        status = "resolved"; position = globalPosition;
      }
    }
    const context = Object.freeze({ text, sensitive: decision.sensitive, source: text ? "visible-local" : "selection-only", truncated });
    const frozen = { schemaVersion: 1, sourceSnapshotId: randomId("source-"), selectedText, contextText: text,
      contextMode: text ? "bounded-context" : "selection-only", projectionVersion: policy.projectionVersion,
      documentGeneration, selectionGeneration: snapshot.selectionGeneration || 1,
      anchor: { status, quote: { exact: selectedText, prefix, suffix }, position, blockDigest: null }, capturedAt: Date.now() };
    const result = { sourceRevision, selectedText, capability: status, context, sourceSnapshot: null };
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
  async function digest(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function canonicalize(range, text) {
    if (!policy.rangePolicy(range, text).supported) return { range, text };
    const value = localProjection(range), position = selectionPosition(value, range);
    return position && comparable(value.text.slice(position.start, position.end)) === comparable(text)
      ? { range: projection.rangeForPosition(value, position), text: value.text.slice(position.start, position.end) } : { range, text };
  }
  app.modules.selectionSourceSnapshot = { capture, contextRoot, canonicalize };
})();
