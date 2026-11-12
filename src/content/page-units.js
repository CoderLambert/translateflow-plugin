(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.pagePolicy || app.modules.pageUnits) return;
  const policy = app.modules.pagePolicy, structured = app.modules.structured;
  const { constants, state } = app.modules.runtime;
  const records = new Map(), identities = new WeakMap();
  let epoch = 0;
  function create(owner, parts, { whole = false, scope = 'content' } = {}) {
    parts = [...parts];
    while (parts.length && !parts[0].node.nodeValue.slice(parts[0].from, parts[0].to).trim()) parts.shift();
    while (parts.length && !parts.at(-1).node.nodeValue.slice(parts.at(-1).from, parts.at(-1).to).trim()) parts.pop();
    if (!parts.length) return null;
    if (owner.matches?.("body, main, article, section, div, header, nav, footer, [role='main']")) {
      let common = parts[0].node.parentElement;
      while (common && !parts.every(part => policy.contains(common, part.node))) common = policy.parent(common);
      if (common?.nodeType === 1 && common !== owner && !policy.isBlock(common)) {
        const value = app.modules.runtime.cleanText(parts.map(part => part.node.nodeValue.slice(part.from, part.to)).join(''));
        const entire = structured.stripMarkers(structured.encodeElement(common).text);
        if (value === entire) { owner = common; whole = true; }
      }
    }
    const prose = parts.filter(part => !part.marks.some(mark => ['CODE', 'KBD'].includes(mark.tagName))).map(part => part.node.nodeValue.slice(part.from, part.to)).join('');
    if (!prose.trim()) return null;
    // The host's enclosing link/formatting already applies to the inserted DOM.
    // Only marks inside this unit belong in its provider/cache representation.
    parts = parts.map(part => ({ ...part, marks: part.marks.filter(mark => mark !== owner && policy.contains(owner, mark)) }));
    const source = structured.encodeParts(parts);
    const first = parts[0], last = parts.at(-1);
    const existing = identities.get(first.node) || [];
    const same = existing.find(unit => unit.owner === owner && unit.parts[0].from === first.from && unit.parts.at(-1).node === last.node && unit.parts.at(-1).to === last.to && unit.scope === scope && unit.whole === whole && unit.source.text === source.text && isCurrent(unit));
    if (same) return same;
    const snapshots = new Map();
    for (const part of parts) {
      for (let node = part.node; node && node !== document; node = policy.parent(node)) {
        if (!snapshots.has(node)) snapshots.set(node, { parent: policy.parent(node), value: node.nodeType === 3 ? node.nodeValue : null,
          children: node.nodeType === 1 && policy.contains(owner, node) ? [...node.childNodes].filter(child => !policy.ownNode(child)) : null,
          href: node.nodeType === 1 ? node.getAttribute('href') : null, title: node.nodeType === 1 ? node.getAttribute('title') : null });
      }
    }
    let anchor = last.node;
    if (last.to === last.node.nodeValue.length) {
      while (anchor.parentElement && anchor.parentElement !== owner && !policy.isBlock(anchor.parentElement)) {
        let next = anchor.nextSibling;
        while (next && (policy.ownNode(next) || (next.nodeType === 3 && !next.nodeValue.trim()))) next = next.nextSibling;
        if (next) break;
        anchor = anchor.parentElement;
      }
    }
    const unit = { owner, parts, source, prose:app.modules.runtime.cleanText(prose), scope, whole, epoch, snapshots, anchor };
    identities.set(first.node, [...existing.filter(isCurrent), unit]);
    return unit;
  }
  function isCurrent(unit) {
    if (!unit || unit.retired || unit.epoch !== epoch || !unit.owner.isConnected) return false;
    for (const [node, saved] of unit.snapshots) {
      if (!node.isConnected || policy.parent(node) !== saved.parent) return false;
      if (node.nodeType === 3 && node.nodeValue !== saved.value) return false;
      if (saved.children) {
        const current = [...node.childNodes].filter(child => !policy.ownNode(child));
        if (current.length !== saved.children.length || current.some((child, i) => child !== saved.children[i])) return false;
      }
      if (node.nodeType === 1 && (node.getAttribute('href') !== saved.href || node.getAttribute('title') !== saved.title)) return false;
    }
    return policy.allowed(unit.owner, unit.scope) && unit.parts.every(part => policy.allowed(part.node, unit.scope));
  }
  function getTranslationNode(unit) {
    const node = records.get(unit);
    return node?.isConnected ? node : null;
  }
  function remove(unit) {
    unit.retired = true;
    records.get(unit)?.remove(); records.delete(unit);
    if (unit.whole) unit.owner.removeAttribute(constants.TRANSLATED_ATTR);
  }
  function prune() {
    for (const unit of records.keys()) if (!isCurrent(unit) || !getTranslationNode(unit)) remove(unit);
  }
  function insertTranslation(unit, translation, engine = '') {
    if (!translation || !isCurrent(unit) || getTranslationNode(unit)) return false;
    const node = document.createElement('span');
    node.className = constants.TRANSLATION_CLASS;
    if (policy.isControl(unit.owner) || unit.owner.tagName === 'A') node.classList.add('abt-translation-inline');
    node.hidden = state.hidden;
    node.setAttribute('aria-hidden', 'false');
    node.appendChild(structured.renderTranslation(translation, unit.source));
    if (engine === 'browser-translator') {
      const badge = document.createElement('small'); badge.className = 'abt-translation-source';
      badge.textContent = app.modules.contentI18n.t('content.basic.sourceBadge'); node.appendChild(badge);
    }
    if (unit.whole) unit.owner.appendChild(node);
    else {
      const siblings = [...records].filter(([other, rendered]) => other.anchor === unit.anchor && rendered.isConnected);
      const offset = unit.parts.at(-1).to;
      const next = siblings.filter(([other]) => other.parts.at(-1).to > offset).sort(([a], [b]) => a.parts.at(-1).to - b.parts.at(-1).to)[0];
      const previous = siblings.filter(([other]) => other.parts.at(-1).to < offset).sort(([a], [b]) => b.parts.at(-1).to - a.parts.at(-1).to)[0];
      if (next) next[1].before(node); else (previous?.[1] || unit.anchor).after(node);
    }
    const root = node.getRootNode();
    if (root.host && app.translationCss && !root.querySelector('[data-abt-shadow-style]')) {
      const style = document.createElement('style'); style.setAttribute('data-abt-shadow-style', '');
      style.setAttribute(constants.EXTENSION_UI_ATTR, 'translation-style'); style.textContent = app.translationCss; root.appendChild(style);
    }
    records.set(unit, node);
    if (unit.whole) unit.owner.setAttribute(constants.TRANSLATED_ATTR, '1');
    return true;
  }
  function clearTranslations() {
    epoch++;
    for (const unit of records.keys()) remove(unit);
    state.hidden = false;
    document.documentElement.classList.remove('abt-hide-translations');
  }
  function setTranslationsHidden(hidden) {
    state.hidden = Boolean(hidden);
    for (const node of records.values()) node.hidden = state.hidden;
    document.documentElement.classList.toggle('abt-hide-translations', state.hidden);
  }
  function removeTranslationFromElement(owner) {
    for (const unit of records.keys()) if (unit === owner || unit.owner === owner || policy.contains(owner, unit.owner)) remove(unit);
  }
  app.modules.pageUnits = { create, isCurrent, getTranslationNode, insertTranslation, clearTranslations, setTranslationsHidden, removeTranslationFromElement, prune, translationCount: () => [...records.values()].filter(node => node.isConnected).length };
})();
