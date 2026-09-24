(() => {
  const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
  const GLOBAL = "__TRANSLATE_FLOW_YOUTUBE_TIMEDTEXT__";

  function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

  function byteLength(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }

  function failure(code, message) { return { ok: false, errorCode: code, errorMessage: message }; }

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) && result >= 0 ? result : null;
  }

  function makeCue(startMs, durationMs, text, index) {
    const start = number(startMs);
    const duration = number(durationMs);
    const body = clean(text);
    if (start === null || !body) return null;
    const safeDuration = duration ?? 0;
    return {
      id: `yt:${start}:${safeDuration}:${index}`,
      startTime: start / 1000,
      endTime: (start + safeDuration) / 1000,
      text: body
    };
  }

  function parseJson3(input) {
    let value;
    try { value = typeof input === "string" ? JSON.parse(input) : input; } catch { return failure("invalid-json", "Timedtext JSON is malformed."); }
    if (!value || !Array.isArray(value.events)) return failure("json-shape", "Timedtext JSON has no events array.");
    const cues = [];
    value.events.forEach((event, index) => {
      if (!event || !Array.isArray(event.segs)) return;
      const text = event.segs.map((segment) => String(segment?.utf8 ?? "")).join("");
      const cue = makeCue(event.tStartMs, event.dDurationMs, text, index);
      if (cue) cues.push(cue);
    });
    return cues.length ? { ok: true, format: "json3", cues } : failure("empty-json", "Timedtext JSON contains no usable cues.");
  }

  function readAttribute(attributes, name) {
    const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*([\\\"'])(.*?)\\1`, "i"));
    return match?.[2] ?? "";
  }

  function decodeEntities(value) {
    const source = String(value ?? "");
    return source.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
      const lower = entity.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "nbsp") return " ";
      const radix = lower.startsWith("#x") ? 16 : 10;
      const digits = lower.replace(/^#x?/, "");
      const code = Number.parseInt(digits, radix);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : whole;
    });
  }

  function stripTags(value) { return decodeEntities(String(value ?? "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "")); }

  function parseXmlWithDomParser(input, format) {
    if (typeof DOMParser !== "function") return null;
    const document = new DOMParser().parseFromString(input, "application/xml");
    if (document.querySelector?.("parsererror")) return failure("invalid-xml", "Timedtext XML is malformed.");
    const nodes = [...(document.querySelectorAll?.("text, p") || [])];
    const cues = [];
    nodes.forEach((node, index) => {
      const tag = String(node.localName || node.tagName || "").toLowerCase();
      const start = tag === "text" ? number(node.getAttribute("start")) : number(node.getAttribute("t"));
      const duration = tag === "text" ? number(node.getAttribute("dur")) : number(node.getAttribute("d"));
      const cue = makeCue(tag === "text" ? (start ?? 0) * 1000 : start, tag === "text" ? (duration ?? 0) * 1000 : duration, node.textContent, index);
      if (cue) cues.push(cue);
    });
    return cues.length ? { ok: true, format, cues } : failure("empty-xml", "Timedtext XML contains no usable cues.");
  }

  function parseXmlFallback(input, format) {
    const source = String(input ?? "");
    const pNodes = [...source.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)];
    const textNodes = [...source.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)];
    const nodes = pNodes.length ? pNodes.map((match) => ({ tag: "p", attributes: match[1], body: match[2] })) : textNodes.map((match) => ({ tag: "text", attributes: match[1], body: match[2] }));
    const cues = [];
    nodes.forEach((node, index) => {
      const isText = node.tag === "text";
      const start = number(readAttribute(node.attributes, isText ? "start" : "t"));
      const duration = number(readAttribute(node.attributes, isText ? "dur" : "d"));
      const cue = makeCue(isText ? (start ?? 0) * 1000 : start, isText ? (duration ?? 0) * 1000 : duration, stripTags(node.body), index);
      if (cue) cues.push(cue);
    });
    return cues.length ? { ok: true, format, cues } : failure("empty-xml", "Timedtext XML contains no usable cues.");
  }

  function parseTimedtext(input, { format = "", contentType = "" } = {}) {
    try {
      if (input === null || input === undefined) return failure("empty-payload", "Timedtext payload is empty.");
      if (byteLength(input) > MAX_PAYLOAD_BYTES) return failure("payload-too-large", "Timedtext payload exceeds 2 MiB.");
      const text = typeof input === "string" ? input.trim() : "";
      const hint = `${format} ${contentType}`.toLowerCase();
      const isJson = typeof input === "object" || /json|json3/.test(hint) || text.startsWith("{");
      if (isJson) return parseJson3(input);
      if (!text.startsWith("<") || !/(?:text|p)\b/i.test(text)) return failure("unknown-format", "Timedtext payload format is unsupported.");
      const xmlFormat = /srv3|<p\b/i.test(hint) || /<p\b/i.test(text) ? "srv3" : "xml";
      return parseXmlWithDomParser(text, xmlFormat) || parseXmlFallback(text, xmlFormat);
    } catch {
      return failure("parse-failed", "Timedtext payload could not be parsed.");
    }
  }

  function trackLabel(track) {
    const name = track?.name;
    if (typeof name === "string") return clean(name);
    if (name?.simpleText) return clean(name.simpleText);
    if (Array.isArray(name?.runs)) return clean(name.runs.map((run) => run?.text || "").join(""));
    return clean(track?.label);
  }

  function normalizeTrackMetadata(track = {}) {
    const language = clean(track.languageCode ?? track.language ?? track.srclang).toLowerCase();
    const kind = clean(track.kind ?? track.type).toLowerCase();
    const vssId = clean(track.vssId ?? track.vss_id ?? track.id);
    const label = trackLabel(track);
    const stableKey = vssId || [language, kind, label].filter(Boolean).join(":") || "default";
    const autoGenerated = track.autoGenerated === true || /\basr\b|auto[- ]?generated|automatic captions?/i.test(`${kind} ${vssId} ${label}`) ? true : null;
    return {
      id: `yt:${stableKey}`,
      kind,
      label,
      language,
      mode: clean(track.mode).toLowerCase() || "showing",
      autoGenerated
    };
  }

  function trackIdentity(track) { return normalizeTrackMetadata(track).id; }

  const api = Object.freeze({ MAX_PAYLOAD_BYTES, clean, byteLength, parseTimedtext, parseJson3, normalizeTrackMetadata, trackIdentity });
  globalThis[GLOBAL] = api;
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (app) app.modules.youtubeTimedtext = api;
})();
