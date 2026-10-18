// Closed static scene contract shared by the MDD reader and isolated Content.
export const SAFE_SVG_LIMITS = Object.freeze({ sourceBytes: 65536, nodes: 128, depth: 8, attributeBytes: 4096, geometryTokens: 4096 });
const TAGS = new Set(["svg", "g", "path", "polygon", "circle"]);
const PAINTS = new Set(["none", "currentColor", "transparent", "black", "white", "red", "green", "blue", "gray", "grey", "yellow", "orange", "purple"]);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/u;
const COMMON = new Set(["fill", "stroke", "stroke-width", "fill-rule", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "transform"]);
const ATTRS = { svg: new Set(["viewBox", "width", "height"]), g: new Set(), path: new Set(["d"]), polygon: new Set(["points"]), circle: new Set(["cx", "cy", "r"]) };
const utf8 = (value) => new TextEncoder().encode(value).byteLength;
const closed = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const scalar = (value) => NUMBER.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 16384;

export function validateSafeSvgScene(input) {
  if (!closed(input, ["format", "root"]) || input.format !== "safe-svg-v1") return null;
  const budget = { nodes: 0, attributeBytes: 0, geometryTokens: 0, depth: 0 };
  function visit(node, depth) {
    if (depth > SAFE_SVG_LIMITS.depth || ++budget.nodes > SAFE_SVG_LIMITS.nodes ||
        !closed(node, ["tag", "attrs", "children"]) || !TAGS.has(node.tag) ||
        (depth === 1 ? node.tag !== "svg" : node.tag === "svg") ||
        !closed(node.attrs, Object.keys(node.attrs || {})) || !Array.isArray(node.children) || node.children.length > 128 ||
        (!["svg", "g"].includes(node.tag) && node.children.length)) return null;
    budget.depth = Math.max(budget.depth, depth);
    const attrs = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      if (typeof value !== "string" || value.length > 4096 || (!COMMON.has(name) && !ATTRS[node.tag].has(name))) return null;
      budget.attributeBytes += utf8(name) + utf8(value);
      if (budget.attributeBytes > SAFE_SVG_LIMITS.attributeBytes || !attribute(name, value, budget)) return null;
      attrs[name] = value;
    }
    if (node.tag === "path" && !attrs.d || node.tag === "polygon" && !attrs.points || node.tag === "circle" && !attrs.r) return null;
    const children = [];
    for (const child of node.children) {
      const safe = visit(child, depth + 1);
      if (!safe) return null;
      children.push(safe);
    }
    return { tag: node.tag, attrs, children };
  }
  const root = visit(input.root, 1);
  if (!root) return null;
  const box = root.attrs.viewBox ? numbers(root.attrs.viewBox) : null;
  const width = Math.ceil(Number(root.attrs.width?.replace(/px$/u, "") || box?.[2] || 16));
  const height = Math.ceil(Number(root.attrs.height?.replace(/px$/u, "") || box?.[3] || 16));
  if (!(width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 16777216)) return null;
  return { scene: { format: "safe-svg-v1", root }, ...budget, width, height };
}

function numbers(value) {
  if (!value.trim() || /[^\d+\-.eE,\s]/u.test(value)) return null;
  const tokens = value.trim().split(/[\s,]+/u);
  return tokens.every(scalar) ? tokens.map(Number) : null;
}

function charge(budget, count) {
  budget.geometryTokens += count;
  return budget.geometryTokens <= SAFE_SVG_LIMITS.geometryTokens;
}

function attribute(name, value, budget) {
  if (name === "fill" || name === "stroke") return PAINTS.has(value) || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value);
  if (name === "fill-rule") return ["nonzero", "evenodd"].includes(value);
  if (name === "stroke-linecap") return ["butt", "round", "square"].includes(value);
  if (name === "stroke-linejoin") return ["miter", "round", "bevel"].includes(value);
  if (["opacity", "fill-opacity", "stroke-opacity"].includes(name)) return scalar(value) && Number(value) >= 0 && Number(value) <= 1;
  if (["width", "height"].includes(name)) return scalar(value.replace(/px$/u, "")) && Number(value.replace(/px$/u, "")) > 0;
  if (name === "transform") {
    const expression = /\s*(translate|rotate)\(\s*([^()]*)\)\s*/gyu;
    let offset = 0;
    while (offset < value.length) {
      expression.lastIndex = offset;
      const match = expression.exec(value);
      if (!match) return false;
      const args = numbers(match[2]);
      if (!args || !(match[1] === "translate" ? [1, 2] : [1, 3]).includes(args.length) || !charge(budget, args.length + 1)) return false;
      offset = expression.lastIndex;
    }
    return offset > 0;
  }
  if (name === "d") return pathData(value, budget);
  if (name === "viewBox" || name === "points") {
    const args = numbers(value);
    return args && charge(budget, args.length) && (name === "viewBox"
      ? args.length === 4 && args[2] > 0 && args[3] > 0
      : args.length >= 6 && args.length % 2 === 0);
  }
  return scalar(value) && (!["r", "stroke-width"].includes(name) || Number(value) > 0) && charge(budget, 1);
}

function pathData(value, budget) {
  const token = /[MmZzLlHhVvCcSsQqTtAa]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?/gyu;
  const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let offset = 0;
  let command = "";
  let args = [];
  let first = true;
  function validArgs() {
    const size = arity[command.toUpperCase()];
    if (size === 0) return args.length === 0;
    if (!args.length || args.length % size) return false;
    if (command.toUpperCase() === "A") {
      for (let index = 0; index < args.length; index += 7) {
        if (args[index] < 0 || args[index + 1] < 0 || ![0, 1].includes(args[index + 3]) || ![0, 1].includes(args[index + 4])) return false;
      }
    }
    return true;
  }
  while (offset < value.length) {
    if (/[\s,]/u.test(value[offset])) { offset += 1; continue; }
    token.lastIndex = offset;
    const match = token.exec(value);
    if (!match || !charge(budget, 1)) return false;
    offset = token.lastIndex;
    if (/^[a-z]$/iu.test(match[0])) {
      if (command && !validArgs() || first && !/m/iu.test(match[0])) return false;
      first = false;
      command = match[0]; args = [];
    } else {
      if (!command || !scalar(match[0])) return false;
      args.push(Number(match[0]));
    }
  }
  return Boolean(command) && validArgs();
}

// A bounded XML subset; it never invokes an XML/HTML parser or expands entities.
export function parseSafeSvg(source) {
  if (typeof source !== "string" || source.length > SAFE_SVG_LIMITS.sourceBytes || utf8(source) > SAFE_SVG_LIMITS.sourceBytes ||
      /[&\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source)) return null;
  let value = source.trim();
  value = value.replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/iu, "");
  const stack = [];
  let root = null;
  let offset = 0;
  let count = 0;
  let attributeBytes = 0;
  while (offset < value.length) {
    if (/\s/u.test(value[offset])) { offset += 1; continue; }
    if (value[offset] !== "<") return null;
    const head = /^<(\/)?(svg|g|path|polygon|circle)(?=[\s/>])/u.exec(value.slice(offset));
    if (!head) return null;
    let cursor = offset + head[0].length;
    const attrs = {};
    let selfClosing = false;
    while (cursor < value.length) {
      while (/\s/u.test(value[cursor] || "") && cursor < value.length) cursor += 1;
      if (value.startsWith("/>", cursor)) { selfClosing = true; cursor += 2; break; }
      if (value[cursor] === ">") { cursor += 1; break; }
      if (head[1]) return null;
      const attr = /^([a-zA-Z][a-zA-Z-]*)\s*=\s*(["'])/u.exec(value.slice(cursor));
      if (!attr || Object.hasOwn(attrs, attr[1])) return null;
      cursor += attr[0].length;
      const end = value.indexOf(attr[2], cursor);
      if (end < 0 || /[<>]/u.test(value.slice(cursor, end))) return null;
      attributeBytes += utf8(attr[1]) + utf8(value.slice(cursor, end));
      if (attributeBytes > SAFE_SVG_LIMITS.attributeBytes) return null;
      attrs[attr[1]] = value.slice(cursor, end);
      cursor = end + 1;
    }
    if (cursor > value.length || value[cursor - 1] !== ">") return null;
    offset = cursor;
    if (head[1]) {
      if (selfClosing || stack.pop()?.tag !== head[2]) return null;
      continue;
    }
    if (++count > 128 || stack.length >= 8 || (!stack.length && root)) return null;
    if (attrs.xmlns === "http://www.w3.org/2000/svg" && !root) delete attrs.xmlns;
    const node = { tag: head[2], attrs, children: [] };
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    if (!selfClosing) stack.push(node);
  }
  return root && !stack.length ? validateSafeSvgScene({ format: "safe-svg-v1", root }) : null;
}

export function extractSafeSvg(source, offset) {
  const tail = source.slice(offset, offset + SAFE_SVG_LIMITS.sourceBytes + 1);
  const end = tail.indexOf("</svg>");
  const self = /^<svg\b[^<>]*\/>/u.exec(tail);
  const length = self ? self[0].length : end >= 0 ? end + 6 : 0;
  if (!length) return null;
  const result = parseSafeSvg(tail.slice(0, length));
  return result ? { ...result, end: offset + length } : null;
}
