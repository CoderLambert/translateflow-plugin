(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.structured || app.modules.pagePolicy) return;
  const { constants, state } = app.modules.runtime;
  const blocks = new Set('ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P SECTION TABLE TBODY TD TFOOT TH THEAD TR UL'.split(' '));
  const parent = node => node?.assignedSlot || (node?.parentNode?.nodeType === 11 ? node.parentNode.host : node?.parentNode);
  const contains = (root, node) => { for (let p = node; p; p = parent(p)) if (p === root) return true; return false; };
  function ownNode(node) {
    for (let p = node?.nodeType === 1 ? node : parent(node); p; p = parent(p))
      if (p.nodeType === 1 && p.matches(`.${constants.TRANSLATION_CLASS}, [${constants.EXTENSION_UI_ATTR}]`)) return true;
    return false;
  }
  function decision(el, scope) {
    if (el.nodeType !== 1) return {action:'pass'};
    const source = app.modules.structured.sourceDecision(el);
    if (source.action === 'prune') return source;
    const outside = {action:'prune',status:'excluded',reason:'outside-scope'};
    if (scope === 'content' && el.matches("nav, footer, [role='navigation'], [role='banner'], [role='contentinfo']")) return outside;
    if (scope === 'content' && el.tagName === 'HEADER') {
      for (let p = parent(el); p; p = parent(p)) if (p.nodeType === 1 && p.matches("main, article, [role='main'], [role='article']")) return source;
      return outside;
    }
    return source;
  }
  const excluded = (el, scope) => decision(el, scope).action === 'prune';
  function allowed(node, scope = state.pageScope || 'content') {
    const target = node?.nodeType === 1 ? node : parent(node);
    if (target && decision(target, scope).action !== 'pass') return false;
    for (let p = target; p; p = parent(p)) {
      if (excluded(p, scope)) return false;
      if (p.nodeType === 1 && p.tagName === 'DETAILS' && !p.open && p !== node) {
        const summary = [...p.children].find(child => child.tagName === 'SUMMARY');
        if (!summary || !contains(summary, node)) return false;
      }
    }
    return true;
  }
  function textDecision(text) {
    if (!text || !/\p{L}/u.test(text)) return {status:'excluded',reason:'nonlinguistic'};
    if (/^(https?:\/\/|www\.)\S+$/i.test(text.trim())) return {status:'excluded',reason:'url-only'};
    return {status:'eligible',reason:'readable-text'};
  }
  function isBlock(el) {
    if (el.nodeType !== 1) return false;
    const display = getComputedStyle(el).display;
    if (display === 'contents') return false;
    return blocks.has(el.tagName) || Boolean(display && !display.startsWith('inline') && !['ruby', 'none'].includes(display));
  }
  const isControl = el => el.nodeType === 1 && el.matches("button, summary, [role='button']");
  function children(node, onRoot) {
    if (node.nodeType === 1 && node.tagName === 'DETAILS' && !node.open)
      return [...node.children].filter(child => child.tagName === 'SUMMARY').slice(0, 1);
    if (node.shadowRoot) { onRoot?.(node.shadowRoot); return [...node.shadowRoot.childNodes]; }
    if (node.nodeType === 1 && node.tagName === 'SLOT') {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
    return [...node.childNodes];
  }
  function roots(scope, subtree) {
    const rootAllowed = root => { for(let p=root;p;p=parent(p)) if(excluded(p,scope))return false; return true; };
    const main = [...document.querySelectorAll("main, [role='main']")].filter(rootAllowed);
    const article = main.length ? [] : [...document.querySelectorAll("article, [role='article']")].filter(rootAllowed);
    const candidates = scope === 'all' ? [document.body] : main.length ? main : article.length ? article : [document.body];
    const unique = candidates.filter((root, i) => root && !candidates.some((other, j) => j !== i && contains(other, root)));
    if (!subtree) return unique;
    return unique.flatMap(root => contains(subtree, root) ? [root] : contains(root, subtree) ? [subtree] : []);
  }
  app.modules.pagePolicy = { parent, contains, ownNode, decision, textDecision, excluded, allowed, isBlock, isControl, children, roots };
})();
