import * as cssTree from "css-tree";
import { collectRichMddFontFaces, sanitizeRichFontFamily } from "./rich-mdd-fonts.js";
import { normalizeMddResourcePath } from "./importers/mdd-resource-path.js";

const MAX_STYLESHEET_BYTES = 64 * 1024;
const MAX_VISITED_RULES = 1024;
const MAX_OUTPUT_RULES = 512;
const MAX_DECLARATIONS = 12;
const MAX_ASSET_SLOTS = 8;
const TAGS = new Set([
  "div", "span", "p", "br", "b", "strong", "i", "em", "u", "ul", "ol",
  "li", "table", "tr", "td", "th", "ruby", "rt", "rp", "img", "audio",
  "details", "summary", "nav", "section", "input", "label"
]);
const PROPERTIES = new Set([
  "color", "background-color", "background-image", "font-size", "font-weight",
  "font-style", "text-decoration", "text-align", "vertical-align", "white-space",
  "line-height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border",
  "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width",
  "border-style", "border-collapse", "border-spacing", "display", "width", "max-width", "height",
  "align-items", "justify-content", "position", "content"
]);
const COLOR_NAMES = new Set([
  "black", "silver", "gray", "white", "maroon", "red", "purple", "fuchsia", "green", "lime",
  "olive", "yellow", "navy", "blue", "teal", "aqua", "orange", "aliceblue", "antiquewhite",
  "cornflowerblue", "crimson", "darkblue", "darkgray", "darkgreen", "darkgrey", "darkred",
  "dodgerblue", "gold", "indigo", "lightblue", "lightgray", "lightgreen", "lightgrey", "magenta",
  "pink", "rebeccapurple", "tomato", "transparent"
]);
const COLOR_PROPERTIES = new Set(["color", "background-color", "border-color"]);
const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla"]);
const SPACING_PROPERTIES = /^(?:margin|padding)(?:-(?:top|right|bottom|left))?$|^border-(?:width|spacing)$/u;
const BORDER_PROPERTIES = /^(?:border|border-(?:top|right|bottom|left))$/u;

/** Parse untrusted package CSS into a tiny, scoped stylesheet and local asset slots. */
export function sanitizeRichMddStylesheet(bytes, stylesheetPath) {
  const diagnostics = [];
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { css: "", assetSlots: [], diagnostics: ["css.invalid_utf8"] }; }
  if (!source || bytes.byteLength > MAX_STYLESHEET_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) {
    return { css: "", assetSlots: [], diagnostics: ["css.input_limit"] };
  }

  let ast;
  let parseFailed = false;
  try { ast = cssTree.parse(source, { context: "stylesheet", positions: true, onParseError: () => { parseFailed = true; } }); }
  catch { return { css: "", assetSlots: [], diagnostics: ["css.parse_failed"] }; }
  if (parseFailed) return { css: "", assetSlots: [], diagnostics: ["css.parse_failed"] };
  let unclosedBlock = false;
  cssTree.walk(ast, (node) => {
    if ((node.type === "Rule" || node.type === "Atrule") && node.block &&
        source[node.block.loc.end.offset - 1] !== "}") unclosedBlock = true;
  });
  if (unclosedBlock) return { css: "", assetSlots: [], diagnostics: ["css.parse_failed"] };

  const slots = new Map();
  const fonts = collectRichMddFontFaces(ast, stylesheetPath, diagnostics);
  const context = { fonts, slots, stylesheetPath, diagnostics, rules: 0, accepted: 0, overflow: false };
  const css = sanitizeList(ast.children, context, 0);
  if (context.overflow || new TextEncoder().encode(css).byteLength > MAX_STYLESHEET_BYTES) {
    return { css: "", assetSlots: [], diagnostics: [...new Set([...diagnostics, "css.output_limit"])].slice(0, 24) };
  }
  return {
    css,
    assetSlots: [...slots].map(([token, path]) => ({ token, path, kind: "image" })),
    ...(fonts.faces.length ? { fontFaces: fonts.faces } : {}),
    diagnostics: [...new Set(diagnostics)].slice(0, 24)
  };
}

function sanitizeList(list, context, depth) {
  if (depth > 2) {
    context.overflow = true; context.diagnostics.push("css.depth_limit");
    return "";
  }
  const output = [];
  list.forEach((node) => {
    if (node.type === "Rule") {
      if (++context.rules > MAX_VISITED_RULES) {
        context.overflow = true;
        context.diagnostics.push("css.rule_limit");
        return;
      }
      const selectors = [];
      node.prelude.children.forEach((selectorNode) => {
        const safe = normalizeSelector(selectorNode);
        if (safe) selectors.push(`.tf-rich-viewer ${safe}`);
        else context.diagnostics.push("css.selector_filtered");
      });
      const declarations = [];
      let declarationCount = 0;
      node.block.children.forEach((declaration) => {
        if (declaration.type !== "Declaration") return;
        if (++declarationCount > MAX_DECLARATIONS) {
          context.diagnostics.push("css.declaration_limit");
          return;
        }
        const safe = sanitizeDeclaration(declaration, context, selectors.length > 0 && selectors.every((selector) => /::(?:before|after)$/u.test(selector)));
        if (safe) declarations.push(safe);
        else context.diagnostics.push("css.declaration_filtered");
      });
      if (selectors.length && declarations.length) {
        if (++context.accepted > MAX_OUTPUT_RULES) {
          context.overflow = true; context.diagnostics.push("css.accepted_rule_limit");
        } else output.push(`${selectors.join(",")}{${declarations.join(";")}}`);
      }
      return;
    }
    if (node.type === "Atrule" && String(node.name || "").toLowerCase() === "media" && node.block) {
      const canonicalQuery = normalizeMedia(node.prelude);
      if (!canonicalQuery) {
        context.diagnostics.push("css.media_filtered");
        return;
      }
      const nested = sanitizeList(node.block.children, context, depth + 1);
      if (nested) output.push(`@media ${canonicalQuery}{${nested}}`);
      return;
    }
    if (node.type === "Atrule" && String(node.name).toLowerCase() === "font-face") return;
    context.diagnostics.push("css.rule_filtered");
  });
  return output.join("");
}

function sanitizeDeclaration(declaration, context, allowContent = false) {
  const property = String(declaration.property || "").toLowerCase();
  if (property === "font-family" && !declaration.important) return sanitizeRichFontFamily(declaration.value, context.fonts.families);
  if (!PROPERTIES.has(property) || declaration.important) return "";
  if (property === "content") {
    if (!allowContent) return "";
    const nodes = declaration.value?.type === "Value" ? [...declaration.value.children] : [];
    if (nodes.length !== 1 || nodes[0].type !== "String") return "";
    const text = nodes[0].value;
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > 80 || /[\u0000-\u001f\u007f<>"'\\]/u.test(text)) return "";
    return `content:"${text}"`;
  }
  const value = declaration.value;
  let assetCount = 0;
  let unsafe = false;
  if (value?.type === "Value") {
    value.children.forEach((node) => {
      if (node.type !== "Url") {
        if (node.type === "Function") {
          const functionName = String(node.name || "").toLowerCase();
          if (!COLOR_PROPERTIES.has(property) || !COLOR_FUNCTIONS.has(functionName)) unsafe = true;
        }
        return;
      }
      if (property !== "background-image" || ++assetCount > 1) {
        unsafe = true;
        return;
      }
      const path = resolveLocalAssetPath(context.stylesheetPath, node.value);
      if (!path) {
        unsafe = true;
        return;
      }
      let token = [...context.slots.keys()].find((key) => context.slots.get(key) === path);
      if (!token) {
        if (context.slots.size + context.fonts.faces.length >= MAX_ASSET_SLOTS) {
          unsafe = true;
          return;
        }
        token = `tfasset${context.slots.size}`;
        context.slots.set(token, path);
      }
      node.type = "Identifier";
      delete node.value;
      node.name = token;
    });
  }
  if (unsafe) return "";
  const normalized = cssTree.generate(value).trim().toLowerCase();
  if (!safeValue(property, normalized, assetCount > 0)) return "";
  return `${property}:${normalized}`;
}

function resolveLocalAssetPath(stylesheetPath, value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f%?#:]/u.test(raw) || raw.includes("\\") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(raw)) return "";
  try {
    const segments = raw.startsWith("/") ? [] : String(stylesheetPath).split("/").slice(0, -1).filter(Boolean);
    for (const segment of raw.replace(/^\//u, "").split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (!segments.length) return "";
        segments.pop();
      } else segments.push(segment);
    }
    const path = normalizeMddResourcePath(segments.join("/"));
    return /\.(?:png|jpe?g|gif|webp)$/iu.test(path) ? path : "";
  } catch { return ""; }
}

function normalizeSelector(selector) {
  if (selector?.type !== "Selector") return "";
  const parts = [];
  let atoms = 0, combinators = 0, compound = false, pseudo = false, unsafe = false;
  selector.children.forEach((node) => {
    if (unsafe) return;
    if (node.type === "Combinator") {
      if (!compound || pseudo || ![" ", ">", "+", "~"].includes(node.name) || ++combinators > 8) { unsafe = true; return; }
      parts.push(node.name === " " ? " " : ` ${node.name} `); compound = false; return;
    }
    if (++atoms > 32 || pseudo) { unsafe = true; return; }
    const name = String(node.name || "");
    if (node.type === "TypeSelector" && TAGS.has(name.toLowerCase())) parts.push(name.toLowerCase());
    else if (node.type === "ClassSelector" && /^[-_a-z][-_a-z0-9]{0,47}$/iu.test(name)) parts.push(`.${name}`);
    else if (node.type === "IdSelector" && /^[a-z0-9_-]{1,80}$/iu.test(name)) parts.push(`[data-rich-target-id="${name}"]`);
    else if (node.type === "PseudoClassSelector" && !node.children && ["checked", "first-child", "last-child", "focus"].includes(name)) parts.push(`:${name}`);
    else if (node.type === "PseudoElementSelector" && !node.children && ["before", "after"].includes(name)) { parts.push(`::${name}`); pseudo = true; }
    else if (node.type === "AttributeSelector" && node.name?.type === "Identifier" && node.name.name === "open" && !node.matcher && !node.value && !node.flags) parts.push("[open]");
    else { unsafe = true; return; }
    compound = true;
  });
  const output = parts.join("");
  return !unsafe && compound && output.length <= 1024 ? output : "";
}

function normalizeMedia(prelude) {
  const queries = prelude?.type === "AtrulePrelude" ? [...prelude.children] : [];
  if (queries.length !== 1 || queries[0].type !== "MediaQueryList") return "";
  const items = [...queries[0].children];
  if (items.length !== 1 || items[0].type !== "MediaQuery") return "";
  const query = items[0];
  if (query.modifier || (query.mediaType && query.mediaType !== "screen") || query.condition?.type !== "Condition") return "";
  const features = [...query.condition.children];
  if (features.length !== 1 || features[0].type !== "Feature" || features[0].kind !== "media") return "";
  const feature = features[0], value = feature.value;
  if (!query.mediaType && feature.name === "prefers-color-scheme" && value?.type === "Identifier" && ["dark", "light"].includes(value.name)) {
    return `(prefers-color-scheme: ${value.name})`;
  }
  if (feature.name !== "max-width" || value?.type !== "Dimension" || value.unit !== "px" || !/^\d{3}$/u.test(value.value)) return "";
  const width = Number(value.value);
  return width >= 240 && width <= 800 ? `${query.mediaType ? "screen and " : ""}(max-width: ${width}px)` : "";
}

function safeValue(property, value, hasAsset) {
  if (!value || value.length > 128 || /[<>\\"'{};]/u.test(value) || /(?:javascript|vbscript|expression|var|env|calc|attr)\s*\(/iu.test(value)) return false;
  if (property === "background-image") return hasAsset && /^tfasset[0-7]$/u.test(value);
  if (COLOR_PROPERTIES.has(property)) {
    return COLOR_NAMES.has(value) || /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.test(value) ||
      /^(?:rgb|rgba|hsl|hsla)\([0-9.% ,+-]+\)$/u.test(value);
  }
  if (property === "font-size") return safeSpacing(value, 48) || safeSpacing(value, 36, "pt") || safeSpacing(value, 3, "em", "rem") || safeSpacing(value, 300, "%");
  if (property === "font-weight") return /^(?:normal|bold|bolder|lighter|[1-9]00)$/u.test(value);
  if (property === "font-style") return /^(?:normal|italic|oblique)$/u.test(value);
  if (property === "text-decoration") return /^(?:none|underline|overline|line-through)(?:\s+(?:underline|overline|line-through))*$/u.test(value);
  if (property === "text-align") return /^(?:left|right|center|justify|start|end)$/u.test(value);
  if (property === "vertical-align") return /^(?:baseline|sub|super|top|middle|bottom|text-top|text-bottom)$/u.test(value) || safeSpacing(value, 16);
  if (property === "white-space") return /^(?:normal|pre|pre-wrap|pre-line|nowrap)$/u.test(value);
  if (property === "line-height") return /^(?:normal|(?:0?\.[7-9][0-9]?|[1-3](?:\.\d{1,2})?))$/u.test(value) || safeSpacing(value, 48);
  if (property === "border-collapse") return /^(?:collapse|separate)$/u.test(value);
  if (property === "border-style") return /^(?:none|solid|dotted|dashed|double)$/u.test(value);
  if (SPACING_PROPERTIES.test(property)) return value.split(/\s+/u).length <= (property === "margin" || property === "padding" ? 4 : 1) && value.split(/\s+/u).every((item) => item === "0" || safeSpacing(item, 64));
  if (BORDER_PROPERTIES.test(property)) return value.split(/\s+/u).length <= 3 && value.split(/\s+/u).every((item) => item === "0" || safeSpacing(item, 8) || /^(?:none|solid|dotted|dashed|double)$/u.test(item) || COLOR_NAMES.has(item) || /^#[0-9a-f]{3,8}$/u.test(item));
  if (["display"].includes(property)) return /^(?:block|inline|inline-block|none|table|table-row|table-cell|flex)$/u.test(value);
  if (property === "position") return value === "relative";
  if (property === "align-items") return /^(?:center|stretch|flex-start|flex-end|baseline)$/u.test(value);
  if (property === "justify-content") return /^(?:flex-start|flex-end|center|space-between|space-around)$/u.test(value);
  if (property === "width" && value === "max-content") return true;
  if (["width", "max-width", "height"].includes(property)) return /^(?:auto|none|100%|0|\d{1,3}(?:\.\d{1,2})?(?:px|em|rem|%))$/u.test(value);
  return false;
}

function safeSpacing(value, max, unit = "px", alternate = "") {
  const units = alternate ? `${unit}|${alternate}` : unit;
  const match = new RegExp(`^(\\d{1,3}(?:\\.\\d{1,2})?)(?:${units})$`, "u").exec(value);
  if (!match) return false;
  return Number(match[1]) <= max;
}
