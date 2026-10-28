(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiQuickControlStyles) return;
  const css = `
.tf-quick-trigger{width:52px;height:52px;padding:4px;border:1px solid var(--tf-border-main);border-radius:18px;background:var(--tf-bg-card);color:var(--tf-text-strong);box-shadow:0 4px 18px rgba(25,40,30,.14);transition:box-shadow 140ms,transform 140ms;opacity:.96}
.tf-quick-trigger-mark{display:grid;place-items:center;width:100%;height:100%;font-size:18px;font-weight:700}
.tf-quick-trigger:hover,.tf-quick-trigger[aria-expanded="true"]{opacity:1;transform:translateY(-1px);box-shadow:0 6px 22px rgba(25,40,30,.19)}
.tf-quick-trigger[data-state="working"]{border-color:var(--tf-green-600)}
.tf-quick-trigger[data-state="failed"]{border-color:var(--tf-danger)}
.tf-quick-trigger:focus-visible,.tf-quick-panel button:focus-visible,.tf-quick-panel select:focus-visible,.tf-quick-panel summary:focus-visible{outline:2px solid var(--tf-green-700);outline-offset:3px}
.tf-quick-panel{overflow:auto;padding:18px;border:1px solid var(--tf-border-main);border-radius:18px;background:var(--tf-bg-card);box-shadow:0 12px 45px rgba(20,32,25,.18);font-family:var(--tf-font-family);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--tf-control-track) transparent;animation:tf-quick-enter 140ms ease-out}
.tf-quick-header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:16px}
.tf-quick-brand{display:flex;align-items:center;min-width:0;gap:10px}
.tf-quick-brand-mark{display:grid;place-items:center;width:34px;height:34px;flex:0 0 auto;border-radius:10px;background:var(--tf-green-100);color:var(--tf-green-800)}
.tf-quick-brand-copy{display:grid;min-width:0;gap:2px}
.tf-quick-title{overflow:hidden;color:var(--tf-text-strong);font-size:14px;font-weight:650;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}
.tf-quick-subtitle{color:var(--tf-text-secondary);font-size:11px;line-height:1.3}
.tf-quick-header-actions{display:flex;align-items:center;flex:0 0 auto;gap:6px}
.tf-quick-state-badge{min-height:22px;padding:2px 7px;border:0;background:var(--tf-bg-subtle);font-size:10px;font-weight:500}
.tf-quick-close{width:28px;min-width:28px;height:28px;min-height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--tf-text-secondary);box-shadow:none}
.tf-quick-close:hover{background:var(--tf-bg-subtle)}
.tf-quick-primary-actions{margin:0}
.tf-quick-translate{width:100%;min-height:42px;padding:10px 14px;border:1px solid transparent;border-radius:10px;background:var(--tf-green-800);color:var(--tf-bg-card);box-shadow:none;font-size:13px;font-weight:600}
.tf-quick-translate:hover:not(:disabled){background:var(--tf-green-700);border-color:transparent;transform:none}
.tf-quick-text-entry{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;margin-top:10px;padding:11px 12px;border:1px solid var(--tf-border-main);border-radius:11px;background:var(--tf-bg-card);color:var(--tf-text-strong);text-align:left;box-shadow:none}
.tf-quick-text-entry:hover:not(:disabled){border-color:var(--tf-green-500);background:var(--tf-green-50);transform:none}
.tf-quick-text-icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 auto;border-radius:9px;background:var(--tf-green-100);color:var(--tf-green-800);font-size:15px;font-weight:600;letter-spacing:-.05em}
.tf-quick-text-copy{display:grid;flex:1;gap:3px;min-width:0}
.tf-quick-text-copy strong{font-size:13px;line-height:1.3;font-weight:600}
.tf-quick-text-copy small{font-size:11px;line-height:1.3;color:var(--tf-text-secondary)}
.tf-quick-text-entry>span:last-child{color:var(--tf-text-secondary);font-size:17px}
.tf-quick-state-block{display:grid;gap:7px;margin-top:12px;padding:10px 11px;border-radius:9px;background:var(--tf-bg-subtle)}
.tf-quick-panel[data-state="idle"]:not([data-message="true"]) .tf-quick-state-block{display:none}
.tf-quick-status{min-height:16px;color:var(--tf-text-secondary);font-size:12px;line-height:1.45}
.tf-quick-status[data-kind="error"]{color:var(--tf-danger)}
.tf-quick-status[data-kind="success"]{color:var(--tf-green-800)}
.tf-quick-progress{height:3px}
.tf-quick-inline-actions{display:flex;gap:8px;margin-top:8px}
.tf-quick-inline-actions:empty,.tf-quick-inline-actions:not(:has(> :not([hidden]))){display:none}
.tf-quick-retry,.tf-quick-cancel{flex:1;min-height:32px;padding:6px 10px;border:1px solid var(--tf-border-main);border-radius:8px;background:var(--tf-bg-card);box-shadow:none;color:var(--tf-text-secondary);font-size:12px}
.tf-quick-cancel{color:var(--tf-danger)}
.tf-quick-auto{appearance:none;display:flex;align-items:center;justify-content:space-between;width:100%;min-height:62px;margin-top:14px;padding:12px 0;border:0;border-top:1px solid var(--tf-border-soft);border-radius:0;background:transparent;color:var(--tf-text-main);cursor:pointer;text-align:left}
.tf-quick-auto:hover:not(:disabled){background:transparent;border-color:var(--tf-border-main)}
.tf-quick-auto:disabled{opacity:.5;cursor:default}
.tf-quick-auto-copy{display:grid;gap:3px;min-width:0}
.tf-quick-auto-copy strong{color:var(--tf-text-strong);font-size:12px;font-weight:550}
.tf-quick-auto-status{overflow:hidden;color:var(--tf-text-secondary);font-size:11px;line-height:1.35;text-overflow:ellipsis;white-space:nowrap}
.tf-quick-switch-visual{position:relative;width:34px;height:20px;flex:0 0 auto;margin-left:12px;border-radius:999px;background:var(--tf-control-track);transition:background-color 140ms}
.tf-quick-switch-visual::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--tf-control-thumb);box-shadow:0 1px 3px rgba(0,0,0,.15);transition:transform 140ms}
.tf-quick-auto[data-active="true"] .tf-quick-switch-visual{background:var(--tf-green-700)}
.tf-quick-auto[data-active="true"] .tf-quick-switch-visual::after{transform:translateX(14px)}
.tf-quick-preferences{margin-top:2px;padding:10px 0 0;border-top:1px solid var(--tf-border-soft)}
.tf-quick-preferences[open]{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tf-quick-section-title{grid-column:1/-1;cursor:pointer;color:var(--tf-text-secondary);font-size:12px;font-weight:500;padding:3px 0;list-style:none}
.tf-quick-section-title::-webkit-details-marker{display:none}
.tf-quick-section-title::after{content:"⌄";float:right;font-size:14px;color:var(--tf-text-secondary)}
.tf-quick-preferences[open] .tf-quick-section-title::after{content:"⌃"}
.tf-quick-field{display:grid;gap:6px;min-width:0}
.tf-quick-field-label{color:var(--tf-text-secondary);font-size:11px;font-weight:500}
.tf-quick-field .tf-ui-select{width:100%;min-height:36px;padding:7px 25px 7px 9px;border:1px solid var(--tf-border-main);border-radius:8px;background-color:var(--tf-bg-card);color:var(--tf-text-main);box-shadow:0 1px 2px rgba(0,0,0,.025);font-size:12px;text-overflow:ellipsis}
.tf-quick-footer{display:flex;gap:4px;margin-top:14px;padding-top:10px;border-top:1px solid var(--tf-border-soft)}
.tf-quick-footer .tf-ui-button{flex:1;min-height:30px;padding:5px 7px;border:0;border-radius:7px;background:transparent;color:var(--tf-text-secondary);box-shadow:none;font-size:11px;font-weight:450}
.tf-quick-footer .tf-ui-button:hover{background:var(--tf-bg-subtle);color:var(--tf-text-strong);transform:none}
.tf-quick-control[data-suppressed="true"]{display:none}
@keyframes tf-quick-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.tf-quick-trigger,.tf-quick-panel,.tf-quick-auto,.tf-quick-switch-visual,.tf-quick-switch-visual::after{animation:none!important;transition:none!important}}
`;
  app.modules.uiQuickControlStyles = Object.freeze({ css });
})();
