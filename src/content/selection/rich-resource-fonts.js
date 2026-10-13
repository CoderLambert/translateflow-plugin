(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
  if (app.modules.richResourceFonts || !app.modules.richResourcePath) return;

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
      if (!faces.length) return asset.safeCss.replace(/\btffamily[0-7]\b/gu, "serif");
      if (typeof globalThis.crypto?.getRandomValues !== "function") {
        fallbackNotice(session, resource);
        return asset.safeCss.replace(/\btffamily[0-7]\b/gu, "serif");
      }
      const aliases = new Map();
      const random = new Uint8Array(16); globalThis.crypto.getRandomValues(random);
      const salt = Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
      for (const face of faces) if (!aliases.has(face.familyToken)) aliases.set(face.familyToken, `tf-rich-font-${salt}-${aliases.size}`);
      const css = asset.safeCss.replace(/\btffamily[0-7]\b/gu, (token) => aliases.get(token) || "serif");
      if (new TextEncoder().encode(css).byteLength > 64 * 1024) {
        fallbackNotice(session, resource);
        return asset.safeCss.replace(/\btffamily[0-7]\b/gu, "serif");
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
