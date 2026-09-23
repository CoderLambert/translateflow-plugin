(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiTokens) return;

  const css = `
:host {
  --tf-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --tf-font-size-xs: 12px;
  --tf-font-size-sm: 13px;
  --tf-font-size-md: 14px;
  --tf-line-height: 1.5;
  --tf-space-1: 4px;
  --tf-space-2: 8px;
  --tf-space-3: 12px;
  --tf-space-4: 16px;
  --tf-radius-sm: 7px;
  --tf-radius-md: 8px;
  --tf-radius-lg: 12px;
  --tf-color-text: #1f2328;
  --tf-color-muted: #57606a;
  --tf-color-accent: #1769aa;
  --tf-color-danger: #b42318;
  --tf-color-surface: #ffffff;
  --tf-color-surface-muted: #f6f8fa;
  --tf-color-hover: #f3f4f6;
  --tf-color-border: rgba(31, 35, 40, 0.16);
  --tf-shadow-sm: 0 4px 18px rgba(0, 0, 0, 0.18);
  --tf-shadow-lg: 0 12px 36px rgba(0, 0, 0, 0.2);
  color-scheme: light dark;
  font-family: var(--tf-font-family);
  font-size: var(--tf-font-size-sm);
  line-height: var(--tf-line-height);
  color: var(--tf-color-text);
}

*, *::before, *::after { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
button { color: inherit; }
[hidden] { display: none !important; }

.tf-ui-button {
  appearance: none;
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-sm);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
  cursor: pointer;
  font-size: var(--tf-font-size-xs);
  line-height: 1;
  padding: 7px 10px;
}
.tf-ui-button:hover { background: var(--tf-color-hover); }
.tf-ui-button:focus-visible { outline: 2px solid var(--tf-color-accent); outline-offset: 2px; }
.tf-ui-icon-button { min-width: 28px; min-height: 28px; padding: 0; border: 0; background: transparent; font-size: 20px; }
.tf-ui-surface {
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-lg);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
  box-shadow: var(--tf-shadow-lg);
}
.tf-ui-status { color: var(--tf-color-muted); }
.tf-ui-status[data-kind="error"] { color: var(--tf-color-danger); }
.tf-ui-status[data-kind="success"] { color: var(--tf-color-accent); }

.tf-ui-select {
  min-height: 32px;
  padding: 6px 28px 6px 9px;
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-sm);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
}
.tf-ui-select:focus-visible { outline: 2px solid var(--tf-color-accent); outline-offset: 2px; }
.tf-ui-menu {
  min-width: 160px;
  padding: var(--tf-space-1);
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-md);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
  box-shadow: var(--tf-shadow-sm);
}
.tf-ui-badge {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 2px 7px;
  border: 1px solid var(--tf-color-border);
  border-radius: 999px;
  background: var(--tf-color-surface-muted);
  color: var(--tf-color-muted);
  font-size: var(--tf-font-size-xs);
  line-height: 1.2;
}
.tf-ui-badge[data-kind="success"],
.tf-ui-badge[data-kind="info"] { color: var(--tf-color-accent); }
.tf-ui-badge[data-kind="error"] { color: var(--tf-color-danger); }
.tf-ui-progress {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--tf-color-surface-muted);
}
.tf-ui-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--tf-color-accent);
  transition: width .18s ease;
}

.tf-selection-ui { position: fixed; z-index: 2147483646; inset: 0 auto auto 0; }
.tf-selection-chip {
  position: fixed;
  min-width: 34px;
  min-height: 30px;
  padding: 0 10px;
  border-color: color-mix(in srgb, var(--tf-color-accent) 35%, transparent);
  box-shadow: var(--tf-shadow-sm);
  color: var(--tf-color-accent);
  font-size: var(--tf-font-size-md);
  font-weight: 700;
}
.tf-selection-panel {
  position: fixed;
  width: min(380px, calc(100vw - 20px));
  max-height: min(430px, calc(100vh - 20px));
  overflow: auto;
  margin: 0;
  padding: var(--tf-space-3);
}
.tf-selection-header { display: flex; align-items: center; justify-content: space-between; gap: var(--tf-space-2); margin-bottom: var(--tf-space-2); }
.tf-selection-header strong { color: var(--tf-color-accent); font-size: var(--tf-font-size-sm); font-weight: 700; }
.tf-selection-source {
  max-height: 110px;
  overflow: auto;
  margin-bottom: 10px;
  padding: 8px 9px;
  border-radius: var(--tf-radius-md);
  background: var(--tf-color-surface-muted);
  color: var(--tf-color-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.tf-selection-status { margin: var(--tf-space-2) 0; }
.tf-selection-result { margin: var(--tf-space-2) 0 10px; color: var(--tf-color-text); font-size: var(--tf-font-size-md); line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.tf-selection-actions { display: flex; justify-content: flex-end; gap: var(--tf-space-2); margin-top: 10px; }

.tf-quick-control { position: fixed; right: 18px; bottom: 18px; }
.tf-quick-trigger {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 42px;
  height: 42px;
  padding: 0;
  border-radius: 999px;
  border-color: color-mix(in srgb, var(--tf-color-accent) 45%, var(--tf-color-border));
  background: var(--tf-color-surface);
  color: var(--tf-color-accent);
  box-shadow: var(--tf-shadow-sm);
  font-size: var(--tf-font-size-md);
  font-weight: 750;
  opacity: .58;
  transition: opacity .15s ease, transform .15s ease, border-color .15s ease;
}
.tf-quick-trigger:hover,
.tf-quick-trigger:focus-visible,
.tf-quick-trigger[aria-expanded="true"] { opacity: 1; transform: translateY(-1px); }
.tf-quick-trigger[data-state="working"] { opacity: 1; }
.tf-quick-trigger[data-state="completed"] { border-color: var(--tf-color-accent); }
.tf-quick-trigger[data-state="failed"] { border-color: var(--tf-color-danger); color: var(--tf-color-danger); }
.tf-quick-panel {
  position: fixed;
  right: 18px;
  bottom: 68px;
  width: min(310px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 92px));
  overflow: auto;
  padding: var(--tf-space-3);
}
.tf-quick-header { display: flex; align-items: center; justify-content: space-between; gap: var(--tf-space-2); }
.tf-quick-title { font-weight: 750; }
.tf-quick-status { margin-top: var(--tf-space-2); min-height: 20px; }
.tf-quick-progress { margin-top: var(--tf-space-2); }
.tf-quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: var(--tf-space-2); margin-top: var(--tf-space-3); }
.tf-quick-field { display: grid; gap: var(--tf-space-1); margin-top: var(--tf-space-3); }
.tf-quick-field label { color: var(--tf-color-muted); font-size: var(--tf-font-size-xs); }
.tf-quick-footer { display: flex; flex-wrap: wrap; gap: var(--tf-space-2); margin-top: var(--tf-space-3); padding-top: var(--tf-space-2); border-top: 1px solid var(--tf-color-border); }
.tf-quick-footer .tf-ui-button { flex: 1 1 auto; }
.tf-quick-control[data-suppressed="true"] { display: none; }

.tf-toast {
  position: fixed;
  z-index: 2147483647;
  right: 18px;
  bottom: 18px;
  max-width: 360px;
  padding: 10px 14px;
  border-radius: var(--tf-radius-md);
  background: rgba(25, 25, 25, 0.92);
  color: #fff;
  font-size: var(--tf-font-size-sm);
  line-height: 1.45;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
  transition: opacity .18s ease, transform .18s ease;
}
.tf-toast[data-visible="true"] { opacity: 1; transform: translateY(0); }

@media (prefers-color-scheme: dark) {
  :host {
    --tf-color-text: #e6edf3;
    --tf-color-muted: #8b949e;
    --tf-color-accent: #58a6ff;
    --tf-color-danger: #ff7b72;
    --tf-color-surface: #161b22;
    --tf-color-surface-muted: #0d1117;
    --tf-color-hover: #21262d;
    --tf-color-border: rgba(240, 246, 252, 0.16);
  }
}
`;

  app.modules.uiTokens = Object.freeze({ css });
})();
