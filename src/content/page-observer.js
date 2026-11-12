(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.dom || app.modules.pageObserver) return;
  const { state, getPageIdentity } = app.modules.runtime;
  const dom = app.modules.dom;
  const observers = new Map();
  let timer = null, poll = null, running = false, dirty = false, generation = 0, attempted = new WeakSet();
  const active = () => state.auto || state.cacheRestore;
  const attributes = ['hidden', 'aria-hidden', 'aria-expanded', 'open', 'class', 'style', 'translate', 'contenteditable', 'slot', 'name', 'inert', 'href', 'title'];
  const sourceChanged = records => records.some(record => {
    if (dom.isTranslationNode(record.target)) return false;
    if (record.type !== 'childList') return true;
    return [...record.addedNodes, ...record.removedNodes].some(node => !dom.isTranslationNode(node));
  });
  function track() {
    let version = 0, stopped = false;
    const watched = new Map(), changed = () => { if (!stopped) version++; };
    const observeRoot = root => {
      if (stopped || watched.has(root)) return;
      const observer = new MutationObserver(records => { if(sourceChanged(records)) changed(); });
      observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
      root.addEventListener('slotchange',changed);watched.set(root,observer);
    };
    const events=['resize','load','toggle','transitionend','animationend'];
    for(const name of events)globalThis.addEventListener(name,changed,true);
    observeRoot(document.documentElement);
    return {observeRoot,revision() {for(const observer of watched.values())if(sourceChanged(observer.takeRecords()))changed();return version;},
      stop() {stopped=true;for(const [root,observer] of watched){observer.disconnect();root.removeEventListener('slotchange',changed);}watched.clear();for(const name of events)globalThis.removeEventListener(name,changed,true);} };
  }
  function observe(root) {
    if (observers.has(root)) return;
    const observer = new MutationObserver(records => {
      if (sourceChanged(records)) schedule();
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: attributes });
    root.addEventListener('slotchange', schedule);
    observers.set(root, observer);
  }
  function start() {
    if (!active()) return;
    observe(document.documentElement);
    // attachShadow does not emit a light-DOM mutation. A bounded, yielding sweep
    // discovers roots attached to existing hosts without patching page methods.
    if (!poll) poll = setInterval(() => schedule(), 5000);
    schedule();
  }
  function stop() {
    generation++; dirty = false; clearTimeout(timer); clearInterval(poll); timer = poll = null;
    for (const [root, observer] of observers) { observer.disconnect(); root.removeEventListener('slotchange', schedule); }
    observers.clear(); attempted = new WeakSet();
  }
  function reset() { generation++; attempted = new WeakSet(); state.pending.clear(); schedule(); }
  function schedule() {
    if (!active()) return;
    dirty = true;
    if (running || timer) return;
    timer = setTimeout(() => { timer = null; scan().catch(error => app.modules.auto?.handleAutoError(error)); }, 120);
  }
  async function scan() {
    if (!active() || running) return;
    if (state.manualRunning) { schedule(); return; }
    if (getPageIdentity(location.href) !== state.currentPageIdentity) {
      state.currentPageIdentity = getPageIdentity(location.href);
      dom.clearTranslations(); reset();
    }
    running = true; dirty = false;
    const expected = generation, identity = getPageIdentity(location.href);
    try {
      const found = await dom.collectUnitsAsync({ onRoot: observe, assertActive: () => {
        if (!active() || expected !== generation || getPageIdentity(location.href) !== identity)
          throw Object.assign(new Error('Page discovery cancelled'), { code: 'CANCELLED' });
      } });
      for (const unit of found) {
        if (!dom.hasTranslation(unit) && !attempted.has(unit)) { attempted.add(unit); state.pending.add(unit); }
      }
      for (const unit of state.pending) if (!dom.isUnitCurrent(unit)) state.pending.delete(unit);
      for (const [root, observer] of observers) if (root.host && !root.host.isConnected) {
        observer.disconnect(); root.removeEventListener('slotchange', schedule); observers.delete(root);
      }
      if (state.pending.size) app.modules.auto?.scheduleAutoDrain();
    } catch (error) { if (error?.code !== 'CANCELLED') throw error; }
    finally { running = false; if (dirty) schedule(); }
  }
  function invalidate(target) {
    // Remove only invalid snapshots. The next scan reuses unaffected units,
    // avoiding duplicate requests for siblings in a mixed-content container.
    app.modules.pageUnits.prune();
    if (target?.parts && !dom.isUnitCurrent(target)) state.pending.delete(target);
    schedule();
  }
  app.modules.pageObserver = { start, stop, schedule, reset, invalidate, track };
})();
