import { normalizeMddResourcePath } from "./importers/mdd-resource-path.js";
const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

export function collectRichMddFontFaces(ast, stylesheetPath, diagnostics) {
  const families = new Map(), faces = [], variants = new Set();
  ast.children.forEach((node) => {
    if (node.type !== "Atrule" || String(node.name).toLowerCase() !== "font-face") return;
    const face = parseFace(node, stylesheetPath);
    if (!face) { diagnostics.push("css.font_filtered"); return; }
    const variant = `${face.family.toLowerCase()}\u0000${face.weight}\u0000${face.style}`;
    if (variants.has(variant)) { diagnostics.push("css.font_duplicate"); return; }
    if (faces.length >= 8) { diagnostics.push("css.font_limit"); return; }
    const name = face.family.toLowerCase();
    if (!families.has(name)) families.set(name, `tffamily${families.size}`);
    const { family, ...descriptor } = face;
    faces.push({ familyToken: families.get(name), ...descriptor }); variants.add(variant);
  });
  return { faces, families };
}

function parseFace(node, stylesheetPath) {
  if (node.prelude || !node.block) return null;
  const declarations = new Map(); let invalid = false;
  node.block.children.forEach((declaration) => {
    const name = String(declaration.property || "").toLowerCase();
    if (declaration.type !== "Declaration" || declaration.important || declarations.has(name) ||
        !["font-family", "src", "font-weight", "font-style", "font-display"].includes(name)) { invalid = true; return; }
    declarations.set(name, declaration.value);
  });
  if (invalid) return null;
  const family = readFamily(declarations.get("font-family"));
  const src = declarations.get("src");
  const nodes = src?.type === "Value" ? [...src.children] : [];
  if (!family || !nodes.length || nodes.length > 2 || nodes[0].type !== "Url") return null;
  if (nodes.length === 2) {
    const format = nodes[1];
    const args = format.children ? [...format.children] : [];
    if (format.type !== "Function" || format.name !== "format" || args.length !== 1 || args[0].type !== "String" || args[0].value.toLowerCase() !== "truetype") return null;
  }
  const path = fontPath(stylesheetPath, nodes[0].value);
  const weight = descriptorValue(declarations.get("font-weight"), "400");
  const style = descriptorValue(declarations.get("font-style"), "normal");
  const display = descriptorValue(declarations.get("font-display"), "swap");
  if (!path || !["400", "700", "normal", "bold"].includes(weight) || !["normal", "italic"].includes(style) || !["swap", "fallback"].includes(display)) return null;
  return { family, path, weight: weight === "normal" ? "400" : weight === "bold" ? "700" : weight, style, display };
}

function descriptorValue(value, fallback) {
  if (!value) return fallback;
  const nodes = value.type === "Value" ? [...value.children] : [];
  return nodes.length === 1 && ["Identifier", "Number"].includes(nodes[0].type) ? String(nodes[0].type === "Identifier" ? nodes[0].name : nodes[0].value).toLowerCase() : "";
}

function readFamily(value) {
  const nodes = value?.type === "Value" ? [...value.children] : [];
  if (!nodes.length || nodes.length > 8) return "";
  const family = nodes.length === 1 && nodes[0].type === "String" ? nodes[0].value
    : nodes.every((node) => node.type === "Identifier") ? nodes.map((node) => node.name).join(" ") : "";
  return /^[a-z][a-z0-9 _-]{0,63}$/iu.test(family) ? family : "";
}

export function sanitizeRichFontFamily(value, families) {
  if (value?.type !== "Value") return "";
  const groups = [[]]; let invalid = false;
  value.children.forEach((node) => {
    if (node.type === "Operator" && node.value === ",") groups.push([]);
    else if (["Identifier", "String"].includes(node.type)) groups.at(-1).push(node);
    else invalid = true;
  });
  if (invalid || groups.length > 8) return "";
  const output = [];
  for (const nodes of groups) {
    const name = readFamily({ type: "Value", children: nodes });
    if (!name) continue;
    const token = families.get(name.toLowerCase());
    if (nodes.length === 1 && nodes[0].type === "Identifier" && GENERIC.has(name.toLowerCase())) output.push(name.toLowerCase());
    else if (token) output.push(token);
  }
  return output.length ? `font-family:${[...new Set(output)].join(",")}` : "";
}

function fontPath(stylesheetPath, value) {
  const raw = String(value || "");
  if (!raw || raw.length > 512 || /[\u0000-\u001f\u007f%?#:\\]/u.test(raw) || raw.startsWith("//")) return "";
  const segments = raw.startsWith("/") ? [] : String(stylesheetPath).split("/").slice(0, -1).filter(Boolean);
  for (const segment of raw.replace(/^\//u, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if (!segments.length) return ""; segments.pop(); }
    else segments.push(segment);
  }
  try { const path = normalizeMddResourcePath(segments.join("/")); return /\.ttf$/iu.test(path) ? path : ""; }
  catch { return ""; }
}
