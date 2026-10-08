(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.selectionRichSanitizer) return;
  const tokenizer = app.modules.richDictionarySanitizerTokenizer;
  if (!tokenizer || !app.modules.richDictionarySanitizerStyle) return;

  const LIMITS = Object.freeze({
    inputBytes: 2 * 1024 * 1024,
    expandedBytes: 2 * 1024 * 1024,
    outputNodes: 32768,
    depth: 32,
    tagBytes: 4096,
    attributeBytes: 2048,
    attributesPerTag: 32,
    stylesheetRules: 255,
    stylesheetBytes: 64 * 1024,
    resourceCount: 1024,
    fallbackBytes: 2 * 1024 * 1024
  });
  const MARKER = /^`([0-9]{1,3})`/u;

  function sanitizeRichDictionaryRecord(input = {}) {
    const { rawRecord, format, styleSheetRules } = input && typeof input === "object" ? input : {};
    let source;
    try {
      source = typeof rawRecord === "string" ? rawRecord : String(rawRecord ?? "");
    } catch {
      return fallbackResult("");
    }

    const byteLength = tokenizer.boundedUtf8Bytes(source, LIMITS.inputBytes);
    const oversized = byteLength > LIMITS.inputBytes;
    const boundedSource = oversized ? tokenizer.clipUtf8(source, LIMITS.inputBytes) : source;
    if (String(format || "HTML").toUpperCase() !== "HTML") {
      const plain = tokenizer.clipUtf8(boundedSource, LIMITS.fallbackBytes);
      return {
        nodes: plain ? [tokenizer.textNode(plain)] : [],
        truncated: oversized || plain.length < boundedSource.length
      };
    }

    const rules = normalizeRules(styleSheetRules);
    const expanded = expandCompactMarkers(boundedSource, rules);
    if (expanded.overflow || oversized) return fallbackResult(boundedSource, rules, true);
    const parsed = tokenizer.parseHtml(expanded.value, LIMITS);
    if (parsed.invalid) return fallbackResult(boundedSource, rules, true);
    if (parsed.truncated && !containsDisplayContent(parsed.nodes)) return fallbackResult(boundedSource, rules, true);
    annotateOxfordSemantics(parsed.nodes);
    return { nodes: parsed.nodes, truncated: Boolean(parsed.truncated) };
  }

  function annotateOxfordSemantics(nodes, context = {}) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node.type === "resource") {
        if (node.kind !== "image") continue;
        if (node.path === "img/OPP.png" && context.opposition && context.oppositionIcon) {
          node.presentation = "oxford-opposition";
        } else if ((node.path === "img/Ox3000_key_L.png" || node.path === "img/Ox3000_key_S.png") && context.oxfordKey) {
          node.presentation = "oxford-key";
        }
        continue;
      }
      if (node.type !== "element") continue;
      const classes = new Set(String(node.attrs?.class || "").split(/\s+/u).filter(Boolean));
      const nextContext = {
        opposition: context.opposition || classes.has("o-ref-opp"),
        oppositionIcon: context.oppositionIcon || (classes.has("o-symbol-opp") && classes.has("o-symbol-source-img")),
        oxfordKey: context.oxfordKey || (classes.has("o-symbol-key") && classes.has("o-symbol-ox3000"))
      };
      if (classes.has("o-pron-chunk")) replacePronunciationIcon(node, classes);
      annotateOxfordSemantics(node.children, nextContext);
    }
  }

  function replacePronunciationIcon(chunk, classes) {
    const language = classes.has("o-pron-BrE") ? "british"
      : classes.has("o-pron-NAmE") ? "american" : "";
    if (!language || !containsAudioResource(chunk.children)) return;
    chunk.children = chunk.children.map((node) => {
      const label = language === "british" ? "BrE" : "NAmE";
      const expectedPath = language === "british" ? "img/voicebre.svg" : "img/voicenam.svg";
      if (node.type === "resource" && node.kind === "image" && node.path === expectedPath) {
        return {
          type: "element", tag: "span",
          attrs: { class: "tf-rich-pronunciation-label", "data-rich-pronunciation": language },
          children: [tokenizer.textNode(label)]
        };
      }
      return node;
    });
  }

  function containsAudioResource(nodes) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node.type === "resource" && node.kind === "audio") return true;
      if (node.type === "element" && containsAudioResource(node.children)) return true;
    }
    return false;
  }

  function containsDisplayContent(nodes) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if ((node.type === "text" && node.text) || node.type === "resource") return true;
      if (node.type === "element" && containsDisplayContent(node.children)) return true;
    }
    return false;
  }

  function normalizeRules(input) {
    if (!Array.isArray(input) || input.length > LIMITS.stylesheetRules) return new Map();
    const result = new Map();
    let bytes = 0;
    for (const rule of input) {
      if (!rule || !Number.isInteger(rule.id) || rule.id < 1 || rule.id > 255 || result.has(String(rule.id))) return new Map();
      if (typeof rule.begin !== "string" || typeof rule.end !== "string") return new Map();
      const beginBytes = tokenizer.boundedUtf8Bytes(rule.begin, 4096);
      const endBytes = tokenizer.boundedUtf8Bytes(rule.end, 4096);
      if (beginBytes > 4096 || endBytes > 4096) return new Map();
      bytes += beginBytes + endBytes;
      if (bytes > LIMITS.stylesheetBytes) return new Map();
      result.set(String(rule.id), { begin: rule.begin, end: rule.end });
    }
    return result;
  }

  // MDict Compact markers delimit a segment. The matching stylesheet rule wraps
  // that segment, so marker-provided markup goes through the same safe tokenizer.
  function expandCompactMarkers(source, rules) {
    if (!rules.size) return { value: source, overflow: false };
    const parts = [];
    let outputBytes = 0;
    let offset = 0;
    let overflow = false;

    function append(value) {
      outputBytes += tokenizer.boundedUtf8Bytes(value, LIMITS.expandedBytes - outputBytes);
      if (outputBytes > LIMITS.expandedBytes) {
        overflow = true;
        return;
      }
      parts.push(value);
    }

    while (offset < source.length && !overflow) {
      if (source[offset] !== "`") {
        const next = source.indexOf("`", offset);
        const end = next === -1 ? source.length : next;
        append(source.slice(offset, end));
        offset = end;
        continue;
      }
      const marker = MARKER.exec(source.slice(offset, offset + 6));
      const rule = marker && rules.get(marker[1]);
      if (!rule) {
        append("`");
        offset += 1;
        continue;
      }

      append(`<span data-compact-id="${marker[1]}">`);
      append(rule.begin);
      offset += marker[0].length;
      const segmentStart = offset;
      while (offset < source.length) {
        if (source[offset] === "`") {
          const nextMarker = MARKER.exec(source.slice(offset, offset + 6));
          if (nextMarker && rules.has(nextMarker[1])) break;
        }
        offset += 1;
      }
      append(source.slice(segmentStart, offset));
      append(rule.end);
      append("</span>");
    }
    return { value: parts.join(""), overflow };
  }

  function fallbackResult(source, rules = new Map(), truncated = false) {
    const expanded = expandCompactMarkers(source, rules);
    const value = tokenizer.stripToPlainText(expanded.overflow ? source : expanded.value, LIMITS);
    const bounded = tokenizer.clipUtf8(value, LIMITS.fallbackBytes);
    return {
      nodes: bounded ? [tokenizer.textNode(bounded)] : [],
      truncated: truncated || expanded.overflow || bounded.length < value.length
    };
  }

  app.modules.selectionRichSanitizer = Object.freeze({
    sanitizeRichDictionaryRecord,
    limits: LIMITS
  });
})();
