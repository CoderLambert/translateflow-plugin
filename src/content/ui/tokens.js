(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiTokens) return;

  const css = `
:host {
  --tf-font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --tf-font-size-xs: 12px;
  --tf-font-size-sm: 13px;
  --tf-font-size-md: 14px;
  --tf-line-height: 1.5;

  --tf-space-1: 4px;
  --tf-space-2: 8px;
  --tf-space-3: 12px;
  --tf-space-4: 16px;
  --tf-space-5: 20px;
  --tf-space-6: 24px;

  --tf-radius-xs: 8px;
  --tf-radius-sm: 12px;
  --tf-radius-md: 16px;
  --tf-radius-lg: 20px;
  --tf-radius-pill: 999px;

  --tf-green-900: #2f4a32;
  --tf-green-800: #3f613f;
  --tf-green-700: #557b52;
  --tf-green-600: #6f9668;
  --tf-green-500: #8caf82;
  --tf-green-300: #cad8bf;
  --tf-green-100: #edf3e8;
  --tf-green-50: #f5f8f2;

  --tf-bg-panel: rgba(253, 250, 244, 0.96);
  --tf-bg-card: #fbf8f2;
  --tf-bg-subtle: #f1ece2;

  --tf-text-strong: #273128;
  --tf-text-main: #3c463d;
  --tf-text-secondary: #697268;
  --tf-text-muted: #8a9187;

  --tf-border-main: rgba(58, 75, 59, 0.14);
  --tf-border-soft: rgba(58, 75, 59, 0.08);

  --tf-success: #6f9668;
  --tf-warning: #c6964c;
  --tf-danger: #b66e65;
  --tf-info: #718d8d;

  --tf-shadow-sm: 0 2px 8px rgba(36, 56, 40, 0.08);
  --tf-shadow-md: 0 8px 24px rgba(36, 56, 40, 0.12);
  --tf-shadow-lg: 0 16px 40px rgba(36, 56, 40, 0.15);
  --tf-focus-ring: 0 0 0 3px rgba(111, 150, 104, 0.18);
  --tf-transition-fast: 120ms cubic-bezier(.22, 1, .36, 1);
  --tf-transition: 180ms cubic-bezier(.22, 1, .36, 1);

  --tf-color-text: var(--tf-text-main);
  --tf-color-muted: var(--tf-text-secondary);
  --tf-color-accent: var(--tf-green-700);
  --tf-color-danger: var(--tf-danger);
  --tf-color-surface: var(--tf-bg-panel);
  --tf-color-surface-muted: var(--tf-bg-subtle);
  --tf-color-hover: var(--tf-green-50);
  --tf-color-border: var(--tf-border-main);

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
  font-weight: 600;
  line-height: 1;
  padding: 8px 11px;
  transition: background-color var(--tf-transition), border-color var(--tf-transition), transform var(--tf-transition-fast), box-shadow var(--tf-transition);
}
.tf-ui-button:hover { background: var(--tf-color-hover); }
.tf-ui-button:active { transform: translateY(1px); }
.tf-ui-button:focus-visible { outline: none; border-color: var(--tf-green-500); box-shadow: var(--tf-focus-ring); }
.tf-ui-icon-button { min-width: 30px; min-height: 30px; padding: 0; border: 0; background: transparent; font-size: 20px; }
.tf-ui-surface {
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-lg);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
  box-shadow: var(--tf-shadow-lg);
}
.tf-ui-status { color: var(--tf-color-muted); }
.tf-ui-status[data-kind="error"] { color: var(--tf-color-danger); }
.tf-ui-status[data-kind="success"] { color: var(--tf-success); }

.tf-ui-select {
  min-height: 34px;
  padding: 6px 30px 6px 10px;
  border: 1px solid var(--tf-color-border);
  border-radius: var(--tf-radius-sm);
  background: var(--tf-color-surface);
  color: var(--tf-color-text);
}
.tf-ui-select:focus-visible { outline: none; border-color: var(--tf-green-500); box-shadow: var(--tf-focus-ring); }
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
  gap: 6px;
  min-height: 24px;
  padding: 3px 9px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-pill);
  background: var(--tf-green-100);
  color: var(--tf-green-800);
  font-size: var(--tf-font-size-xs);
  font-weight: 600;
  line-height: 1.2;
}
.tf-ui-badge[data-kind="neutral"] { background: var(--tf-bg-subtle); color: var(--tf-text-secondary); }
.tf-ui-badge[data-kind="success"],
.tf-ui-badge[data-kind="info"] { color: var(--tf-success); }
.tf-ui-badge[data-kind="error"] { background: color-mix(in srgb, var(--tf-danger) 12%, var(--tf-bg-card)); color: var(--tf-danger); }
.tf-ui-progress {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border-radius: var(--tf-radius-pill);
  background: var(--tf-color-surface-muted);
}
.tf-ui-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--tf-green-600);
  transition: width var(--tf-transition);
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

.tf-toast {
  position: fixed;
  z-index: 2147483647;
  right: 18px;
  bottom: 18px;
  max-width: 320px;
  padding: 10px 14px;
  border-radius: var(--tf-radius-sm);
  background: rgba(45, 58, 47, 0.94);
  color: #fff;
  font-size: var(--tf-font-size-sm);
  line-height: 1.45;
  box-shadow: var(--tf-shadow-md);
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
  transition: opacity var(--tf-transition), transform var(--tf-transition);
}
.tf-toast[data-visible="true"] { opacity: 1; transform: translateY(0); }

@media (prefers-color-scheme: dark) {
  :host {
    --tf-bg-panel: rgba(39, 49, 40, 0.96);
    --tf-bg-card: #2b352c;
    --tf-bg-subtle: #303b31;
    --tf-text-strong: #f0f4ed;
    --tf-text-main: #e1e9de;
    --tf-text-secondary: #b5c0b2;
    --tf-text-muted: #919d8f;
    --tf-border-main: rgba(221, 231, 212, 0.16);
    --tf-border-soft: rgba(221, 231, 212, 0.09);
    --tf-green-900: #dfe9da;
    --tf-green-800: #cbdac5;
    --tf-green-700: #a9c5a0;
    --tf-green-600: #9db993;
    --tf-green-500: #8caf82;
    --tf-green-100: #344535;
    --tf-green-50: #2f3d30;
    --tf-success: #9db993;
    --tf-warning: #d2ad69;
    --tf-danger: #d58b82;
    --tf-info: #9bb2b2;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tf-ui-button,
  .tf-ui-select,
  .tf-ui-progress-bar,
  .tf-toast {
    animation: none !important;
    transition: none !important;
  }
}
`;

  app.modules.uiTokens = Object.freeze({ css });
})();
