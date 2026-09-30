(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richDictionarySanitizerStyle) return;

  const PROPERTIES = new Set([
    "color", "background-color", "font-size", "font-weight", "font-style",
    "text-decoration", "text-align", "vertical-align", "white-space", "line-height",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-width", "border-style", "border-collapse", "border-spacing"
  ]);
  const COLOR_NAMES = new Set([
    "black", "silver", "gray", "white", "maroon", "red", "purple", "fuchsia",
    "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "orange",
    "aliceblue", "antiquewhite", "cornflowerblue", "crimson", "darkblue", "darkgray",
    "darkgreen", "darkgrey", "darkred", "dodgerblue", "gold", "indigo", "lightblue",
    "lightgray", "lightgreen", "lightgrey", "magenta", "pink", "rebeccapurple", "tomato",
    "transparent"
  ]);
  const DANGEROUS = /(?:url\s*\(|expression\s*\(|@import|javascript\s*:|data\s*:|var\s*\(|env\s*\(|calc\s*\(|behavior\s*:|-moz-binding|!important)/iu;

  function safeAttributes(token) {
    const attrs = {};
    const classes = String(token.attrs.class || "")
      .split(/\s+/u)
      .filter((name) => /^[-_a-z][-_a-z0-9]{0,47}$/iu.test(name))
      .slice(0, 4);
    if (classes.length) attrs.class = [...new Set(classes)].join(" ");
    for (const name of ["colspan", "rowspan"]) {
      const value = token.attrs[name];
      if (/^[1-9][0-9]{0,2}$/u.test(value || "")) {
        const number = Number(value);
        if (number <= 100 && (token.name === "td" || token.name === "th")) attrs[name] = String(number);
      }
    }
    if (/^[1-9][0-9]{0,2}$/u.test(token.attrs["data-compact-id"] || "")) {
      const number = Number(token.attrs["data-compact-id"]);
      if (number <= 255) attrs["data-compact-id"] = String(number);
    }
    return attrs;
  }

  function safeStyle(rawStyle) {
    const style = {};
    if (typeof rawStyle !== "string" || rawStyle.length > 2048) return style;
    for (const declaration of rawStyle.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator <= 0) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const rawValue = declaration.slice(separator + 1).trim();
      if (!PROPERTIES.has(property) || DANGEROUS.test(rawValue)) continue;
      const value = safeStyleValue(property, rawValue);
      if (value) style[property] = value;
    }
    return style;
  }

  function safeStyleValue(property, rawValue) {
    const value = String(rawValue).trim().toLowerCase();
    if (!value || value.length > 128 || /[\u0000-\u001f\u007f<>"'\\]/u.test(value)) return "";
    if (["color", "background-color", "border-color"].includes(property)) return safeColor(value);
    if (property === "font-size") {
      const match = /^(\d{1,3}(?:\.\d{1,2})?)(px|pt|em|rem|%)$/u.exec(value);
      if (!match) return "";
      const number = Number(match[1]);
      const max = { px: 48, pt: 36, em: 3, rem: 3, "%": 300 }[match[2]];
      return number > 0 && number <= max ? `${number}${match[2]}` : "";
    }
    if (property === "font-weight") return /^(?:normal|bold|bolder|lighter|[1-9]00)$/u.test(value) ? value : "";
    if (property === "font-style") return /^(?:normal|italic|oblique)$/u.test(value) ? value : "";
    if (property === "text-decoration") {
      return /^(?:none|underline|overline|line-through)(?:\s+(?:underline|overline|line-through))*$/u.test(value) ? value : "";
    }
    if (property === "text-align") return /^(?:left|right|center|justify|start|end)$/u.test(value) ? value : "";
    if (property === "vertical-align") {
      if (/^(?:baseline|sub|super|top|middle|bottom|text-top|text-bottom)$/u.test(value)) return value;
      return safeSpacing(value, 16);
    }
    if (property === "white-space") return /^(?:normal|pre|pre-wrap|pre-line|nowrap)$/u.test(value) ? value : "";
    if (property === "line-height") {
      if (/^(?:normal|(?:0?\.[7-9][0-9]?|[1-3](?:\.\d{1,2})?))$/u.test(value)) return value;
      return safeSpacing(value, 48);
    }
    if (property === "border-collapse") return /^(?:collapse|separate)$/u.test(value) ? value : "";
    if (property === "border-style") return /^(?:none|solid|dotted|dashed|double)$/u.test(value) ? value : "";
    if (property === "border-width") return safeSpacing(value, 8);
    if (property === "border-spacing") return safeSpacing(value, 16);
    if (property === "border" || /^border-(?:top|right|bottom|left)$/u.test(property)) return safeBorder(value);
    if (property === "margin" || property.startsWith("margin-") || property === "padding" || property.startsWith("padding-")) {
      const values = value.split(/\s+/u);
      if (values.length > (property === "margin" || property === "padding" ? 4 : 1)) return "";
      if (values.some((item) => !safeSpacing(item, 64))) return "";
      return values.join(" ");
    }
    return "";
  }

  function safeSpacing(value, maxPixels) {
    const match = /^(\d{1,3}(?:\.\d{1,2})?)(px|pt|em|rem|%)$/u.exec(value);
    if (!match) return "";
    const number = Number(match[1]);
    const max = { px: maxPixels, pt: maxPixels * 0.75, em: 3, rem: 3, "%": 100 }[match[2]];
    return number <= max ? `${number}${match[2]}` : "";
  }

  function safeBorder(value) {
    const tokens = value.split(/\s+/u);
    if (tokens.length < 1 || tokens.length > 3) return "";
    const normalized = [];
    let hasWidth = false;
    let hasStyle = false;
    let hasColor = false;
    for (const token of tokens) {
      if (!hasWidth) {
        const width = safeSpacing(token, 8);
        if (width) { normalized.push(width); hasWidth = true; continue; }
      }
      if (!hasStyle && /^(?:none|solid|dotted|dashed|double)$/u.test(token)) {
        normalized.push(token); hasStyle = true; continue;
      }
      if (!hasColor) {
        const color = safeColor(token);
        if (color) { normalized.push(color); hasColor = true; continue; }
      }
      return "";
    }
    return normalized.join(" ");
  }

  function safeColor(value) {
    if (COLOR_NAMES.has(value)) return value;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.test(value)) return value;
    if (/^(?:rgb|rgba)\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d{1,3}))?\s*\)$/u.test(value)) return value;
    if (/^(?:hsl|hsla)\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d{1,3}))?\s*\)$/u.test(value)) return value;
    return "";
  }

  app.modules.richDictionarySanitizerStyle = Object.freeze({
    safeAttributes,
    safeStyle,
    safeStyleValue
  });
})();
