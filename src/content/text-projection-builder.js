(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.textProjectionPolicy || app.modules.textProjectionBuilder) return;
  function createBuilder({ maxUnits = Infinity } = {}) {
    const units = [], mapping = [], nodes = new Map();
    let whitespace = false;
    function boundary() {
      if (units.at(-1) === " ") { units.pop(); mapping.pop(); }
      if (units.length && units.at(-1) !== "\n") { if (units.length >= maxUnits) throw new Error("char-budget"); units.push("\n"); mapping.push(null); }
      whitespace = false;
    }
    function append(nodeKey, text, baseOffset = 0, check = () => {}) {
      let node = nodes.get(nodeKey);
      if (!node) { node = { cells: [], baseOffset }; nodes.set(nodeKey, node); }
      const { cells } = node;
      for (let index = 0; index < text.length; index++) {
        if (index % 64 === 0) check();
        const char = text[index], offset = baseOffset + index;
        if (/[\t\n\r\f ]/u.test(char)) {
          if (units.length && !whitespace && units.at(-1) !== "\n") {
            if (units.length >= maxUnits) throw new Error("char-budget");
            units.push(" ");
            mapping.push({ start: { nodeKey, offset }, end: { nodeKey, offset: offset + 1 } });
          } else if (whitespace && mapping.at(-1)) mapping.at(-1).end = { nodeKey, offset: offset + 1 };
          whitespace = true;
        } else {
          if (units.length >= maxUnits) throw new Error("char-budget");
          units.push(char);
          mapping.push({ start: { nodeKey, offset }, end: { nodeKey, offset: offset + 1 } });
          whitespace = false;
        }
        cells.push(whitespace && (!units.length || units.at(-1) === "\n") ? null : { index: units.length - 1, entry: mapping.at(-1) });
      }
    }
    function finish() {
      if ([" ", "\n"].includes(units.at(-1))) { units.pop(); mapping.pop(); }
      return { text: units.join(""), mapping, nodes };
    }
    function view(start = 0, end = units.length) {
      const from = Math.max(0, start), to = Math.min(units.length, end);
      return { text: units.slice(from, to).join(""), mapping: mapping.slice(from, to), nodes, sourceOffset: from };
    }
    return { append, boundary, finish, view, get size() { return units.length; } };
  }
  app.modules.textProjectionBuilder = { createBuilder };
})();
