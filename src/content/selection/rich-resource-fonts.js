(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richResourceFonts || !app.modules.richResourcePath) return;

  // Scan the already-validated, bounded stylesheet, rewriting only bare family
  // tokens inside declaration values. Selectors and strings remain byte-for-byte.
  function rewriteFamilyDeclarations(css, replacement) {
    const parts = []; let offset = 0, start = 0, declarationStart = false, parentheses = 0, brackets = 0;
    while (offset < css.length) {
      const char = css[offset];
      if (char === '"' || char === "'") { offset = skipString(css, offset); continue; }
      if (char === "\\") { offset += 2; continue; }
      if (css.startsWith("/*", offset)) { const end = css.indexOf("*/", offset + 2); offset = end === -1 ? css.length : end + 2; continue; }
      if (char === "(") { parentheses += 1; offset += 1; continue; }
      if (char === ")") { parentheses = Math.max(0, parentheses - 1); offset += 1; continue; }
      if (char === "[") { brackets += 1; offset += 1; continue; }
      if (char === "]") { brackets = Math.max(0, brackets - 1); offset += 1; continue; }
      if (!parentheses && !brackets) {
        if (char === "{" || char === ";") { declarationStart = true; offset += 1; continue; }
        if (char === "}") { declarationStart = false; offset += 1; continue; }
        if (declarationStart && !/\s/u.test(char)) {
          declarationStart = false;
          const property = /^font-family\s*:/iu.exec(css.slice(offset, offset + 64));
          if (property) {
            const begin = offset + property[0].length, end = declarationEnd(css, begin);
            parts.push(css.slice(start, begin), rewriteFamilyValue(css.slice(begin, end), replacement));
            start = end; offset = end; continue;
          }
        }
      }
      offset += 1;
    }
    parts.push(css.slice(start)); return parts.join("");
  }

  function skipString(css, start) {
    const quote = css[start]; let offset = start + 1;
    while (offset < css.length) {
      if (css[offset] === "\\") { offset += 2; continue; }
      if (css[offset++] === quote) break;
    }
    return offset;
  }

  function declarationEnd(css, start) {
    let offset = start, parentheses = 0;
    while (offset < css.length) {
      const char = css[offset];
      if (char === '"' || char === "'") { offset = skipString(css, offset); continue; }
      if (char === "\\") { offset += 2; continue; }
      if (css.startsWith("/*", offset)) { const end = css.indexOf("*/", offset + 2); offset = end === -1 ? css.length : end + 2; continue; }
      if (char === "(") parentheses += 1;
      else if (char === ")") parentheses = Math.max(0, parentheses - 1);
      else if (!parentheses && (char === ";" || char === "}")) break;
      offset += 1;
    }
    return offset;
  }

  function rewriteFamilyValue(value, replacement) {
    const parts = []; let offset = 0, start = 0, parentheses = 0;
    while (offset < value.length) {
      const char = value[offset];
      if (char === '"' || char === "'") { offset = skipString(value, offset); continue; }
      if (char === "\\") { offset += 2; continue; }
      if (value.startsWith("/*", offset)) { const end = value.indexOf("*/", offset + 2); offset = end === -1 ? value.length : end + 2; continue; }
      if (char === "(") { parentheses += 1; offset += 1; continue; }
      if (char === ")") { parentheses = Math.max(0, parentheses - 1); offset += 1; continue; }
      if (!parentheses && /[-_a-z]/iu.test(char)) {
        const begin = offset; let escaped = false;
        while (offset < value.length && /[-_a-z0-9\\]/iu.test(value[offset])) {
          if (value[offset] === "\\") { escaped = true; offset += 2; } else offset += 1;
        }
        const token = value.slice(begin, offset);
        if (!escaped && /^tffamily[0-7]$/u.test(token)) { parts.push(value.slice(start, begin), replacement(token)); start = offset; }
        continue;
      }
      offset += 1;
    }
    parts.push(value.slice(start)); return parts.join("");
  }

  function create({ isCurrent, scheduleRead, fetchAsset, maxAssetBytes, maxActiveBytes, onRelease }) {
    const records = new WeakMap();
    let activeBytes = 0;

    function normalizeFaces(input, imageSlots) {
      if (input === undefined) return { faces: [], invalid: false };
      if (!Array.isArray(input) || input.length + imageSlots > 8) return { faces: [], invalid: true };
      const faces = [], variants = new Set();
      for (const item of input) {
        const token = item?.familyToken, path = app.modules.richResourcePath.normalize(item?.path);
        if (!/^tffamily[0-7]$/u.test(token || "") || !path || path !== item.path || !/\.ttf$/iu.test(path) ||
            !["normal", "italic"].includes(item.style) || !["400", "700"].includes(item.weight) || !["swap", "fallback"].includes(item.display)) return { faces: [], invalid: true };
        const key = `${token}\u0000${item.weight}\u0000${item.style}`;
        if (variants.has(key)) return { faces: [], invalid: true };
        variants.add(key); faces.push({ familyToken: token, path, style: item.style, weight: item.weight, display: item.display });
      }
      return { faces, invalid: false };
    }

    function fallbackNotice(session, resource) {
      if (!isCurrent(session) || resource.fontFallbackNote) return;
      const doc = session.container.ownerDocument || document;
      const note = doc.createElement("div"); note.className = "tf-rich-truncated";
      app.modules.contentI18n.bindText(note, "content.rich.fontsUnavailable");
      session.viewport.appendChild(note); resource.fontFallbackNote = note;
    }

    function apply(session, resource, asset) {
      const { faces, invalid } = normalizeFaces(asset.fontFaces, asset.assetSlots.length);
      if (invalid) fallbackNotice(session, resource);
      if (!faces.length) return rewriteFamilyDeclarations(asset.safeCss, () => "serif");
      if (typeof globalThis.crypto?.getRandomValues !== "function") {
        fallbackNotice(session, resource);
        return rewriteFamilyDeclarations(asset.safeCss, () => "serif");
      }
      const aliases = new Map();
      const random = new Uint8Array(16); globalThis.crypto.getRandomValues(random);
      const salt = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
      for (const face of faces) if (!aliases.has(face.familyToken)) aliases.set(face.familyToken, `tf-rich-font-${salt}-${aliases.size}`);
      const css = rewriteFamilyDeclarations(asset.safeCss, (token) => aliases.get(token) || "serif");
      if (new TextEncoder().encode(css).byteLength > 64 * 1024) {
        fallbackNotice(session, resource);
        return rewriteFamilyDeclarations(asset.safeCss, () => "serif");
      }
      for (const face of faces) void scheduleRead(session, () => load(session, resource, face, aliases.get(face.familyToken))).catch(() => fallbackNotice(session, resource));
      return css;
    }

    function release(session, record) {
      if (record.released) return;
      record.released = true;
      if (record.face) record.document.fonts?.delete(record.face);
      session.objectBytes = Math.max(0, session.objectBytes - record.size);
      activeBytes = Math.max(0, activeBytes - record.size);
      records.get(session)?.delete(record);
      if (isCurrent(session)) onRelease(session);
    }

    async function load(session, resource, descriptor, alias) {
      let record;
      try {
        if (!isCurrent(session)) return;
        const asset = await fetchAsset(session, { kind: "font", path: descriptor.path });
        if (!isCurrent(session)) return;
        if (asset.size > maxAssetBytes || session.objectBytes + asset.size > maxActiveBytes) throw new Error("Font resource budget exceeded.");
        const doc = session.container.ownerDocument || document;
        if (!doc.fonts || typeof FontFace !== "function") throw new Error("Font loading is unavailable.");
        record = { size: asset.size, document: doc, face: null, pending: true, released: false };
        if (!records.has(session)) records.set(session, new Set());
        records.get(session).add(record); session.objectBytes += asset.size; activeBytes += asset.size;
        record.face = new FontFace(alias, asset.bytes.buffer, { style: descriptor.style, weight: descriptor.weight, display: descriptor.display });
        await record.face.load();
        record.pending = false;
        if (!isCurrent(session)) { release(session, record); return; }
        doc.fonts.add(record.face);
      } catch {
        if (record) { record.pending = false; release(session, record); }
        fallbackNotice(session, resource);
      }
    }

    function close(session) {
      for (const record of records.get(session) || []) {
        if (record.face) record.document.fonts?.delete(record.face);
        // Pending native decoding keeps its byte reservation and the existing
        // two-read slot until settlement; repeated closes cannot spawn more work.
        if (!record.pending) release(session, record);
      }
      for (const resource of session.resources) resource.fontFallbackNote?.remove();
    }

    return Object.freeze({ apply, close, get activeBytes() { return activeBytes; } });
  }

  app.modules.richResourceFonts = Object.freeze({ create });
})();
