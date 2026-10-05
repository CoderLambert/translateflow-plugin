(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules?.richDictionarySanitizerStyle || app.modules.richResourceStylesheet) return;
  const ALLOWED_STYLESHEET_TAGS = new Set(["div", "span", "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "table", "tr", "td", "th", "ruby", "rt", "rp"]);
  const ALLOWED_STYLESHEET_PROPERTIES = new Set([
    "color", "background-color", "font-size", "font-weight", "font-style", "text-decoration", "text-align",
    "vertical-align", "white-space", "line-height", "margin", "margin-top", "margin-right", "margin-bottom",
    "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border",
    "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width", "border-style",
    "border-collapse", "border-spacing"
  ]);

  function compileLocalStylesheet(bytes) {
    let source;
    try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return ""; }
    if (!source || bytes.byteLength > 64 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) return "";
    if (/@|\/\*|\*\/|\\|url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:/iu.test(source)) return "";
    const styleApi = app.modules.richDictionarySanitizerStyle;
    if (!styleApi?.safeStyleValue) return "";
    const rules = [];
    let offset = 0;
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of source.matchAll(pattern)) {
      if (match.index !== offset && source.slice(offset, match.index).trim()) return "";
      offset = match.index + match[0].length;
      const selectors = match[1].split(",").map((item) => item.trim()).filter(Boolean);
      if (!selectors.length || selectors.length > 3) return "";
      const safeSelectors = selectors.map(normalizeLocalSelector);
      if (safeSelectors.some((selector) => !selector)) return "";
      const declarations = [];
      for (const declaration of match[2].split(";")) {
        if (!declaration.trim()) continue;
        const separator = declaration.indexOf(":");
        if (separator <= 0 || declarations.length >= 12) return "";
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const rawValue = declaration.slice(separator + 1).trim();
        const value = styleApi.safeStyleValue(property, rawValue);
        if (!value || !ALLOWED_STYLESHEET_PROPERTIES.has(property)) continue;
        declarations.push(`${property}:${property === "font-size" ? `clamp(8px, ${value}, 48px)` : value}`);
      }
      if (!declarations.length) continue;
      rules.push(`${safeSelectors.map((selector) => `.tf-rich-viewer ${selector}`).join(",")}{${declarations.join(";")}}`);
      if (rules.length > 64) return "";
    }
    if (source.slice(offset).trim()) return "";
    return rules.join("\n");
  }

  function normalizeLocalSelector(value) {
    const selector = String(value || "").trim();
    const match = /^(?:(div|span|p|br|b|strong|i|em|u|ul|ol|li|table|tr|td|th|ruby|rt|rp))?(?:\.([-_a-z][-_a-z0-9]{0,47}))?$/iu.exec(selector);
    if (!match || (!match[1] && !match[2])) return "";
    if (match[1] && !ALLOWED_STYLESHEET_TAGS.has(match[1].toLowerCase())) return "";
    return `${match[1] ? match[1].toLowerCase() : ""}${match[2] ? `.${match[2]}` : ""}`;
  }

  app.modules.richResourceStylesheet = Object.freeze({ compileLocalStylesheet });
})();
