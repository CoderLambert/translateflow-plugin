(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richDictionarySanitizerTokenizer) return;

  const ALLOWED_TAGS = new Set([
    "div", "span", "p", "br", "b", "strong", "i", "em", "u", "ul", "ol",
    "li", "table", "tr", "td", "th", "ruby", "rt", "rp", "font", "a"
  ]);
  const ACTIVE_TAGS = new Set([
    "script", "style", "iframe", "object", "form", "button", "select", "textarea",
    "option", "optgroup", "fieldset", "legend", "datalist", "output", "video", "canvas",
    "template", "svg", "math", "foreignobject", "audio"
  ]);
  const VOID_DISCARD_TAGS = new Set(["embed", "input", "link", "meta", "base"]);
  const BREAK_TAGS = new Set(["div", "p", "li", "tr", "table"]);
  const NAMED_ENTITIES = Object.freeze({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ensp: " ",
    emsp: " ", thinsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
    mdash: "—", ndash: "–", hellip: "…", copy: "©", reg: "®", trade: "™",
    middot: "·", times: "×", divide: "÷", plusmn: "±", deg: "°"
  });
  const ENTITY_PATTERN = /&(#(?:x[0-9a-f]{1,8}|[0-9]{1,10})|[a-z][a-z0-9]{1,9});/giu;

  function parseHtml(source, limits) {
    const styleApi = app.modules.richDictionarySanitizerStyle;
    const resourcePath = app.modules.richResourcePath;
    const root = { children: [] };
    const stack = [{ name: "", children: root.children }];
    const skipped = [];
    let nodeCount = 0;
    const resourceKeys = new Set();
    let offset = 0;
    let invalid = false;
    let truncated = false;

    function appendText(value) {
      if (!value) return;
      const parent = stack[stack.length - 1].children;
      const decoded = decodeEntities(value);
      if (!decoded) return;
      const previous = parent[parent.length - 1];
      if (previous?.type === "text") {
        previous.text += decoded;
        return;
      }
      if (nodeCount >= limits.outputNodes) {
        truncated = true;
        return;
      }
      parent.push(textNode(decoded));
      nodeCount += 1;
    }

    function appendElement(tag, attrs = {}, style = {}, children = []) {
      const parent = stack[stack.length - 1].children;
      const childCount = children.length;
      if (nodeCount + 1 + childCount > limits.outputNodes) {
        truncated = true;
        return null;
      }
      const node = { type: "element", tag, children };
      if (Object.keys(attrs).length) node.attrs = attrs;
      if (Object.keys(style).length) node.style = style;
      parent.push(node);
      nodeCount += 1 + childCount;
      return node;
    }

    while (offset < source.length && !invalid && !truncated) {
      const open = source.indexOf("<", offset);
      if (open === -1) {
        if (!skipped.length) appendText(source.slice(offset));
        break;
      }
      if (open > offset && !skipped.length) appendText(source.slice(offset, open));
      if (source.startsWith("<!--", open)) {
        const close = source.indexOf("-->", open + 4);
        if (close === -1) {
          invalid = true;
          break;
        }
        offset = close + 3;
        continue;
      }

      const token = scanTag(source, open, limits);
      if (!token) {
        invalid = true;
        break;
      }
      offset = token.end + 1;
      if (skipped.length) {
        if (!updateSkippedStack(skipped, token, limits.depth)) truncated = true;
        continue;
      }
      if (!token.name) continue;
      if (token.closing) {
        if (token.name === "br") appendElement("br");
        else closeElement(stack, token.name);
        continue;
      }

      if (token.name === "img") {
        const path = resourcePath?.normalize?.(token.attrs.src || "") || "";
        if (!path) continue;
        const label = safeResourceLabel(token.attrs.alt || token.attrs.title || "");
        if (reserveResource("image", path)) {
          appendResource("image", path, label);
        } else {
          appendElement("span", { "data-rich-placeholder": "image", "data-rich-label": label }, {}, []);
        }
        continue;
      }
      if (token.name === "audio") {
        const path = resourcePath?.normalizeAudioReference?.(token.attrs.src || "") || "";
        if (!path) {
          if (!token.selfClosing && skipped.length < limits.depth) skipped.push("audio"); continue;
        }
        const label = safeResourceLabel(token.attrs.title || token.attrs["aria-label"] || "");
        if (reserveResource("audio", path)) appendResource("audio", path, label);
        else appendElement("span", { "data-rich-placeholder": "audio", "data-rich-label": label }, {}, []);
        if (!token.selfClosing) skipped.length >= limits.depth ? truncated = true : skipped.push("audio"); continue;
      }
      if (token.name === "a") {
        const path = resourcePath?.normalizeSoundReference?.(token.attrs.href || "") || "";
        if (path) {
          const label = safeResourceLabel(token.attrs.title || token.attrs["aria-label"] || "");
          if (reserveResource("audio", path)) appendResource("audio", path, label);
          else appendElement("span", { "data-rich-placeholder": "audio", "data-rich-label": label }, {}, []);
          continue;
        }
      }
      if (token.name === "link") {
        const rel = String(token.attrs.rel || "").trim().toLowerCase();
        const path = rel === "stylesheet" ? resourcePath?.normalize?.(token.attrs.href || "") || "" : "";
        if (path && reserveResource("stylesheet", path)) appendResource("stylesheet", path, "");
        continue;
      }
      if (VOID_DISCARD_TAGS.has(token.name)) continue;
      if (ACTIVE_TAGS.has(token.name)) {
        if (!token.selfClosing) {
          if (skipped.length >= limits.depth) truncated = true;
          else skipped.push(token.name);
        }
        continue;
      }
      if (!ALLOWED_TAGS.has(token.name)) continue;
      if (token.name === "br") {
        appendElement("br");
        continue;
      }

      const tag = token.name === "font" ? "span" : token.name;
      const attrs = styleApi.safeAttributes(token);
      const targetId = /^[a-z0-9_-]{1,80}$/iu.test(token.attrs.id || "") ? token.attrs.id : "";
      if (targetId) attrs["data-rich-target-id"] = targetId;
      if (token.name === "a") {
        const fragment = /^#([a-z0-9_-]{1,80})$/iu.exec(String(token.attrs.href || ""));
        if (fragment) attrs["data-rich-fragment-target"] = fragment[1];
      }
      const style = styleApi.safeStyle(token.attrs.style || "");
      if (token.name === "font" && !style.color && token.attrs.color) {
        const color = styleApi.safeStyleValue("color", token.attrs.color.trim());
        if (color) style.color = color;
      }
      if (token.attrs.align && !style["text-align"]) {
        const align = styleApi.safeStyleValue("text-align", token.attrs.align);
        if (align) style["text-align"] = align;
      }
      if (token.attrs.valign && !style["vertical-align"]) {
        const align = styleApi.safeStyleValue("vertical-align", token.attrs.valign);
        if (align) style["vertical-align"] = align;
      }
      const element = appendElement(tag, attrs, style);
      if (!element) continue;
      if (!token.selfClosing) {
        if (stack.length >= limits.depth + 1) {
          truncated = true;
          break;
        }
        stack.push({ name: token.name, children: element.children });
      }
    }
    return { nodes: root.children, invalid, truncated };

    function appendResource(kind, path, label) {
      if (nodeCount >= limits.outputNodes) {
        truncated = true;
        return;
      }
      stack[stack.length - 1].children.push({ type: "resource", kind, path, label });
      nodeCount += 1;
    }

    function reserveResource(kind, path) {
      const key = `${kind}\u0000${path}`;
      if (resourceKeys.has(key)) return true;
      if (resourceKeys.size >= limits.resourceCount) {
        truncated = true;
        return false;
      }
      resourceKeys.add(key);
      return true;
    }
  }

  function safeResourceLabel(value) {
    return String(value || "").replace(/[\u0000-\u001f\u007f<>]/gu, " ").slice(0, 160).trim();
  }

  function scanTag(source, start, limits) {
    const first = source[start + 1];
    if (!first || !(first === "/" || first === "!" || /[a-z?]/iu.test(first))) return null;
    let end = start + 1;
    let quote = "";
    while (end < source.length && end - start <= limits.tagBytes) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      } else if (char === "<") {
        return null;
      }
      end += 1;
    }
    if (end >= source.length || source[end] !== ">" || end - start > limits.tagBytes) return null;
    if (source.startsWith("<!", start) || source.startsWith("<?", start)) {
      return { name: "", end, closing: false, selfClosing: true, attrs: Object.create(null) };
    }

    let cursor = start + 1;
    while (/\s/u.test(source[cursor] || "")) cursor += 1;
    let closing = false;
    if (source[cursor] === "/") {
      closing = true;
      cursor += 1;
      while (/\s/u.test(source[cursor] || "")) cursor += 1;
    }
    const nameStart = cursor;
    while (/[a-z0-9:-]/iu.test(source[cursor] || "")) cursor += 1;
    if (cursor === nameStart) return null;
    const name = source.slice(nameStart, cursor).toLowerCase();
    const parsed = closing ? { attrs: Object.create(null), selfClosing: false } : parseAttributes(source, cursor, end, limits);
    if (!parsed) return null;
    return { name, end, closing, selfClosing: parsed.selfClosing, attrs: parsed.attrs };
  }

  function parseAttributes(source, cursor, end, limits) {
    const attrs = Object.create(null);
    let count = 0;
    let selfClosing = false;
    while (cursor < end) {
      while (/\s/u.test(source[cursor] || "")) cursor += 1;
      if (cursor >= end) break;
      if (source[cursor] === "/") {
        selfClosing = true;
        cursor += 1;
        while (/\s/u.test(source[cursor] || "")) cursor += 1;
        if (cursor < end) return null;
        break;
      }
      if (++count > limits.attributesPerTag) return null;
      const nameStart = cursor;
      while (cursor < end && !/[\s=/>]/u.test(source[cursor])) cursor += 1;
      if (cursor === nameStart) {
        cursor += 1;
        continue;
      }
      const name = source.slice(nameStart, cursor).toLowerCase();
      while (/\s/u.test(source[cursor] || "")) cursor += 1;
      let value = "";
      if (source[cursor] === "=") {
        cursor += 1;
        while (/\s/u.test(source[cursor] || "")) cursor += 1;
        const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor++] : "";
        const valueStart = cursor;
        if (quote) {
          while (cursor < end && source[cursor] !== quote) cursor += 1;
          if (cursor >= end) return null;
          value = source.slice(valueStart, cursor);
          cursor += 1;
        } else {
          while (cursor < end && !/[\s>]/u.test(source[cursor])) cursor += 1;
          value = source.slice(valueStart, cursor);
        }
        if (value.length > limits.attributeBytes) return null;
      }
      if (!Object.hasOwn(attrs, name)) attrs[name] = decodeEntities(value);
    }
    return { attrs, selfClosing };
  }

  function closeElement(stack, name) {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      if (stack[index].name === name) {
        stack.length = index;
        return;
      }
    }
  }

  function updateSkippedStack(skipped, token, maxDepth) {
    if (!token.name) return true;
    if (!token.closing) {
      if (ACTIVE_TAGS.has(token.name) && !token.selfClosing) {
        if (skipped.length >= maxDepth) return false;
        skipped.push(token.name);
      }
      return true;
    }
    for (let index = skipped.length - 1; index >= 0; index -= 1) {
      if (skipped[index] === token.name) {
        skipped.length = index;
        return true;
      }
    }
    return true;
  }

  function stripToPlainText(source, limits) {
    let output = "";
    let offset = 0;
    const skipped = [];
    while (offset < source.length && output.length < limits.fallbackBytes) {
      const open = source.indexOf("<", offset);
      if (open === -1) {
        if (!skipped.length) output += decodeEntities(source.slice(offset));
        break;
      }
      if (open > offset && !skipped.length) output += decodeEntities(source.slice(offset, open));
      if (source.startsWith("<!--", open)) {
        const close = source.indexOf("-->", open + 4);
        if (close === -1) break;
        offset = close + 3;
        continue;
      }
      const token = scanTag(source, open, limits);
      if (!token) {
        if (!skipped.length) output += "<";
        offset = open + 1;
        continue;
      }
      offset = token.end + 1;
      if (skipped.length) {
        if (!updateSkippedStack(skipped, token, limits.depth)) break;
        continue;
      }
      if (!token.name) continue;
      if (!token.closing && (ACTIVE_TAGS.has(token.name) || token.name === "audio")) {
        if (!token.selfClosing) {
          if (skipped.length >= limits.depth) break;
          skipped.push(token.name);
        }
      } else if (token.name === "br" || (token.closing && BREAK_TAGS.has(token.name))) {
        output += "\n";
      } else {
        output += " ";
      }
    }
    return output.replace(/[\t\u00a0 ]+/gu, " ").replace(/ *\n */gu, "\n").trim();
  }

  function decodeEntities(value) {
    return String(value).replace(ENTITY_PATTERN, (full, token) => {
      const lower = token.toLowerCase();
      if (Object.hasOwn(NAMED_ENTITIES, lower)) return NAMED_ENTITIES[lower];
      const hex = lower.startsWith("#x");
      const numeric = Number.parseInt(lower.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff)) return "\ufffd";
      return String.fromCodePoint(numeric);
    });
  }

  function boundedUtf8Bytes(value, maxBytes) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > maxBytes) return bytes;
    }
    return bytes;
  }

  function clipUtf8(value, maxBytes) {
    let bytes = 0;
    let end = 0;
    while (end < value.length) {
      const code = value.charCodeAt(end);
      let size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
      if (code >= 0xd800 && code <= 0xdbff && end + 1 < value.length && value.charCodeAt(end + 1) >= 0xdc00 && value.charCodeAt(end + 1) <= 0xdfff) size = 4;
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += size === 4 ? 2 : 1;
    }
    return value.slice(0, end);
  }

  function textNode(text) {
    return { type: "text", text };
  }

  app.modules.richDictionarySanitizerTokenizer = Object.freeze({
    parseHtml,
    stripToPlainText,
    decodeEntities,
    boundedUtf8Bytes,
    clipUtf8,
    textNode
  });
})();
