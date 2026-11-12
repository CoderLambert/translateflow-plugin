(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.tasks || !app.modules.uiHost || !app.modules.uiPrimitives || app.modules.pageProgress) return;
  const { tasks, uiHost, uiPrimitives, runtime, contentI18n } = app.modules;
  const working = new Set(['queued', 'cache_lookup', 'translating', 'storing']);
  const labels = {queued:'taskQueued', cache_lookup:'taskCacheLookup', translating:'taskTranslating', storing:'taskStoring', completed:'taskCompleted', failed:'taskFailed', cancelled:'taskCancelled'};
  let started = false, task = null, node, phase, count, meter, hideTimer, stylesheet;
  const t = (key, args) => contentI18n.t(key, args);
  const css = `
.tf-page-progress { position:fixed; right:82px; bottom:18px; z-index:2147483647; width:320px; max-width:calc(100vw - 100px); padding:10px 12px; border:1px solid var(--tf-border-main); border-radius:var(--tf-radius-md); background:var(--tf-bg-card); color:var(--tf-text-main); box-shadow:var(--tf-shadow-md); pointer-events:none; }
.tf-page-progress[hidden] { display:none; }
.tf-page-progress-header { display:flex; align-items:center; gap:12px; min-width:0; font-size:var(--tf-font-size-sm); line-height:20px; }
.tf-page-progress-phase { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tf-page-progress-count { flex-shrink:0; font-variant-numeric:tabular-nums; color:var(--tf-text-secondary); }
.tf-page-progress .tf-ui-progress { margin-top:8px; }
.tf-page-progress .tf-ui-progress[hidden] { display:none; }
.tf-page-progress[data-indeterminate="true"] .tf-ui-progress-bar { width:30% !important; opacity:.6; }
.tf-page-progress[data-kind="error"] { border-color:var(--tf-danger); }
`;
  function ensure() {
    if (node?.isConnected) return;
    const layer = uiHost.getLayer('page-progress');
    if (!stylesheet?.isConnected) { stylesheet = document.createElement('style'); stylesheet.textContent = css; layer.appendChild(stylesheet); }
    node = document.createElement('div'); node.className = 'tf-page-progress'; node.hidden = true;
    node.setAttribute('role','status'); node.setAttribute('aria-live','polite');
    const header = document.createElement('div'); header.className = 'tf-page-progress-header';
    phase = document.createElement('span'); phase.className = 'tf-page-progress-phase';
    count = document.createElement('span'); count.className = 'tf-page-progress-count';
    meter = uiPrimitives.progress({label:t('content.quick.progress')});
    header.append(phase,count); node.append(header,meter); layer.appendChild(node);
  }
  function hide() { clearTimeout(hideTimer); hideTimer = null; if (node) node.hidden = true; }
  function visible() { return Boolean(node?.isConnected && !node.hidden); }
  function render(next, event) {
    if (!next || next.surface !== 'page') return;
    if (event === 'released') { if (task?.id === next.id) hide(); return; }
    if (runtime.getPageIdentity(next.pageUrl) !== runtime.getPageIdentity(location.href)) { if (task?.id === next.id) hide(); return; }
    if (task && task.id !== next.id && next.createdAt < task.createdAt) return;
    task = next; clearTimeout(hideTimer); hideTimer = null; ensure();
    node.hidden = false; node.dataset.state = next.state; node.dataset.kind = next.state === 'failed' ? 'error' : next.state === 'completed' ? 'success' : 'info';
    const provider = next.machineProvider ? ` · ${next.machineSwitching ? t('mt.switching') : ''}${next.machineProvider}` : '';
    const text = (next.state === 'failed' && next.error ? next.error : t(`content.quick.${labels[next.state] || 'taskProcessing'}`,{progress:''})) + provider;
    phase.textContent = text; phase.title = text;
    count.textContent = next.total > 0 ? `${Math.min(next.done || 0,next.total)}/${next.total}` : '';
    uiPrimitives.setProgress(meter,next.done || 0,next.total || 1);
    node.dataset.indeterminate = String(!(next.total > 0));
    if (!(next.total > 0)) meter.removeAttribute('aria-valuenow');
    meter.hidden = !working.has(next.state) && next.state !== 'completed';
    if (!working.has(next.state)) {
      const id = next.id;
      hideTimer = setTimeout(() => { if (task?.id === id) hide(); },3200);
    }
  }
  function announce(id, message, kind) {
    if (!id || task?.id !== id) return false;
    if (!node?.isConnected && working.has(task.state)) render(task);
    if (!visible()) return false;
    if (!working.has(task.state)) {
      phase.textContent = String(message || phase.textContent); phase.title = phase.textContent;
      if (kind === 'error' || kind === 'warning') node.dataset.kind = kind;
    }
    return true;
  }
  function start() {
    if (started) return; started = true;
    tasks.subscribe(render);
    const latest = tasks.getLatestTask('page'); if (latest && working.has(latest.state)) render(latest);
    contentI18n.subscribe?.(() => { if (visible() && task) render(task); });
    window.addEventListener('pagehide',hide);
  }
  app.modules.pageProgress = {start, announce, visible};
})();
