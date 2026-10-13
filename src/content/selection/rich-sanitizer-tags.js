(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richDictionarySanitizerTags) return;
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
    return { name, end, closing, selfClosing: parsed.selfClosing, attrs: parsed.attrs, duplicate: parsed.duplicate };
  }

  function parseAttributes(source, cursor, end, limits) {
    const attrs = Object.create(null);
    let count = 0;
    let selfClosing = false;
    let duplicate = false;
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
      if (Object.hasOwn(attrs, name)) duplicate = true;
      if (!Object.hasOwn(attrs, name)) attrs[name] = app.modules.richDictionarySanitizerTokenizer.decodeEntities(value);
    }
    return { attrs, selfClosing, duplicate };
  }

  app.modules.richDictionarySanitizerTags = Object.freeze({ scanTag });
})();
