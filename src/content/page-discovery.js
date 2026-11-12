(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.pageUnits || app.modules.pageDiscovery) return;
  const policy = app.modules.pagePolicy, units = app.modules.pageUnits;
  const marks = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'KBD', 'MARK']);
  const characters = text => text.replace(/\s/gu, '').length;
  function* report(units, audit, scope, scanComplete = true) {
    const spans = new Map(), reasons = {...audit.reasons};
    let duplicateCharacters = 0, unexpectedCharacters = 0, sourceCharacters = 0, accountedCharacters = 0, eligibleUnits = 0;
    for (const unit of units) {
      yield null;
      const decision = policy.textDecision(unit.prose ?? app.modules.structured.stripMarkers(unit.source.text));
      if (decision.status === 'eligible') eligibleUnits++;
      else reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
      for (const part of unit.parts) {
        if (part.marks.some(mark => ['CODE','KBD'].includes(mark.tagName))) continue;
        if (!audit.text.has(part.node)) { unexpectedCharacters += characters(part.node.nodeValue.slice(part.from,part.to)); continue; }
        if (!spans.has(part.node)) spans.set(part.node, []);
        spans.get(part.node).push([part.from,part.to]);
      }
    }
    for (const [node, value] of audit.text) {
      yield null;
      sourceCharacters += characters(value);
      let end = 0;
      for (const [from,to] of (spans.get(node) || []).sort((a,b)=>a[0]-b[0])) {
        duplicateCharacters += characters(value.slice(from,Math.min(to,end)));
        accountedCharacters += characters(value.slice(Math.max(from,end),Math.max(to,end)));
        end = Math.max(end,to);
      }
    }
    return {scope,scanComplete,sourceCharacters,accountedCharacters,unaccountedCharacters:sourceCharacters-accountedCharacters,
      duplicateCharacters,unexpectedCharacters,eligibleUnits,reasons,
      limitations:['closed-shadow-roots','unloaded-content','non-dom-text']};
  }
  function finish(result, audit, scope, scanComplete = true) {
    const generator=report(result,audit,scope,scanComplete);let next;
    do {next=generator.next();} while(!next.done);
    Object.defineProperty(result,'coverage',{value:next.value});
    return result;
  }
  function partition(parts, limit = 3500) {
    const chunks = []; let current = [], size = 0;
    const flush = () => { if (current.length) chunks.push(current); current = []; size = 0; };
    for (const part of parts) {
      const length = part.to - part.from;
      if (length <= limit && size + length > limit) flush();
      let from = part.from;
      while (from < part.to) {
        if (size >= limit) flush();
        let to = Math.min(part.to, from + limit - size);
        if (to < part.to) {
          const text = part.node.nodeValue;
          const space = text.lastIndexOf(' ', to);
          if (space > from + (to - from) / 2) to = space + 1;
          if (/[\uD800-\uDBFF]/.test(text[to - 1])) to--;
        }
        current.push({ ...part, from, to }); size += to - from; from = to;
        if (from < part.to) flush();
      }
    }
    flush(); return chunks;
  }
  function* discover(options = {}) {
    const scope = options.scope || app.modules.runtime.state.pageScope || 'content';
    const audit = options.audit;
    const note = decision => { if(audit && decision.reason) audit.reasons[decision.reason]=(audit.reasons[decision.reason]||0)+1; };
    const selectedRoots = policy.roots(scope, options.subtree);
    const seen = new WeakSet(); let count = 0, textSize = 0;
    const flush = function* (holder, end = false) {
      const pending = partition(holder.parts), chunks = []; holder.parts = [];
      while (pending.length) {
        const parts = pending.shift();
        if (app.modules.structured.encodeParts(parts).text.length <= 4000) { chunks.push(parts); continue; }
        const size = parts.reduce((sum, part) => sum + part.to - part.from, 0);
        if (size < 2) throw Object.assign(new Error('Text structure exceeds the safe scan limit'), { code: 'PAGE_SCAN_LIMIT' });
        pending.unshift(...partition(parts, Math.max(1, Math.floor(size / 2))));
      }
      for (const parts of chunks) {
        const whole = end && !holder.boundary && chunks.length === 1 && !holder.root;
        const unit = units.create(holder.owner, parts, { whole, scope });
        if (unit) yield unit;
      }
    };
    for (const root of [options.subtree || document.body].filter(Boolean)) {
      let guarded = false;
      for(let p=policy.parent(root);p;p=policy.parent(p)) { const decision=policy.decision(p,scope);if(decision.action==='prune'){note(decision);guarded=true;break;} }
      if (guarded) continue;
      const holder = { owner: root, parts: [], root: root.matches?.("body, main, article, [role='main'], [role='article']"), boundary: false, control: policy.isControl(root) };
      const stack = [{ node: root, holder, marks: [], depth: 0, initial: true }];
      while (stack.length) {
        options.assertActive?.();
        if (options.signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
        const frame = stack.pop(), { node } = frame;
        if (frame.exit) { yield* flush(frame.holder, true); continue; }
        if (seen.has(node)) continue;
        seen.add(node);
        if (++count > (options.maxNodes || 200000) || frame.depth > 256)
          throw Object.assign(new Error('Page exceeds the safe scan limit'), { code: 'PAGE_SCAN_LIMIT' });
        yield null;
        if (node.nodeType === 3) {
          if(frame.skipText) continue;
          textSize += node.nodeValue?.length || 0;
          if (textSize > 10000000) throw Object.assign(new Error('Page text exceeds the safe scan limit'), { code: 'PAGE_SCAN_LIMIT' });
          if (node.nodeValue) {
            if (!frame.marks.some(mark => ['CODE','KBD'].includes(mark.tagName))) audit?.text.set(node,node.nodeValue);
            frame.holder.parts.push({ node, from: 0, to: node.nodeValue.length, marks: frame.marks });
          }
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (policy.ownNode(node)) continue;
        let decision = policy.decision(node, scope);
        if (decision.action !== 'prune' && !selectedRoots.some(root => policy.contains(root,node))) {
          decision = {action:selectedRoots.some(root => policy.contains(node,root))?'skip-self':'prune',status:'excluded',reason:'outside-scope'};
        }
        if (decision.action !== 'pass') note(decision);
        if (decision.action === 'prune' || node.tagName === 'BR') {
          frame.holder.boundary = true; yield* flush(frame.holder); continue;
        }
        let current = frame.holder;
        if (!frame.initial && (frame.skipText || decision.action === 'skip-self' || policy.isControl(node) || (!current.control && policy.isBlock(node)))) {
          current.boundary = true; yield* flush(current);
          current = { owner: node, parts: [], root: false, boundary: false, control: policy.isControl(node) };
        }
        if (frame.initial || current !== frame.holder) stack.push({ exit: true, holder: current });
        const nextMarks = marks.has(node.tagName) ? [...frame.marks, node] : frame.marks;
        if(node.tagName==='DETAILS'&&!node.open&&[...node.childNodes].some(child=>child.nodeType===3?child.nodeValue.trim():child.tagName!=='SUMMARY')) note({reason:'disclosure-closed'});
        const children = policy.children(node, options.onRoot);
        for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], holder: current, marks: nextMarks, depth: frame.depth + 1, skipText:decision.action==='skip-self' });
      }
    }
  }
  function collectUnits(options = {}) {
    units.prune();const audit={text:new Map(),reasons:{}};
    return finish([...discover({...options,audit})].filter(Boolean),audit,options.scope||app.modules.runtime.state.pageScope||'content');
  }
  async function collectUnitsAsync(options = {}) {
    units.prune();
    const audit={text:new Map(),reasons:{}};
    const result = []; let steps = 0, started = performance.now();
    for (const unit of discover({...options,audit})) {
      if (unit) result.push(unit);
      if (++steps >= (options.yieldEvery || 250) || performance.now() - started > 8) {
        options.onYield?.();
        await new Promise(resolve => setTimeout(resolve, 0));
        steps = 0; started = performance.now();
      }
    }
    options.assertActive?.();
    if (options.signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const accounting=report(result,audit,options.scope||app.modules.runtime.state.pageScope||'content');
    let next;
    do {
      options.assertActive?.();
      if(options.signal?.aborted)throw new DOMException('Scan cancelled','AbortError');
      next=accounting.next();
      if(!next.done && (++steps >= (options.yieldEvery||250) || performance.now()-started>8)) {
        options.onYield?.('coverage');await new Promise(resolve=>setTimeout(resolve,0));steps=0;started=performance.now();
      }
    } while(!next.done);
    if (result.some(unit => !units.isCurrent(unit))) {
      if ((options.restarts || 0) >= 2) throw Object.assign(new Error('Page changed during discovery'), { code: 'PAGE_CHANGED' });
      return collectUnitsAsync({ ...options, restarts: (options.restarts || 0) + 1 });
    }
    Object.defineProperty(result,'coverage',{value:next.value});
    return result;
  }
  app.modules.pageDiscovery = { collectUnits, collectUnitsAsync };
})();
