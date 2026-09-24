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

.tf-quick-control {
  position: fixed;
  right: 18px;
  bottom: 18px;
}

.tf-quick-trigger {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .30);
  border-radius: var(--tf-radius-pill);
  background: linear-gradient(180deg, var(--tf-green-600), var(--tf-green-800));
  color: #fff;
  box-shadow:
    0 10px 26px rgba(55, 80, 54, .20),
    0 0 0 7px rgba(111, 150, 104, .07);
  font-size: var(--tf-font-size-md);
  font-weight: 750;
  opacity: .88;
  transition:
    opacity var(--tf-transition-fast),
    transform var(--tf-transition-fast),
    box-shadow var(--tf-transition);
}

.tf-quick-trigger-mark {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 17px;
  font-weight: 760;
  letter-spacing: -.02em;
}

.tf-quick-trigger:hover,
.tf-quick-trigger:focus-visible,
.tf-quick-trigger[aria-expanded="true"] {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow:
    0 13px 30px rgba(55, 80, 54, .24),
    0 0 0 7px rgba(111, 150, 104, .10);
}

.tf-quick-trigger:focus-visible {
  outline: none;
  box-shadow:
    0 13px 30px rgba(55, 80, 54, .24),
    0 0 0 7px rgba(111, 150, 104, .10),
    var(--tf-focus-ring);
}

.tf-quick-trigger[data-state="working"] {
  opacity: 1;
  box-shadow:
    0 12px 28px rgba(55, 80, 54, .24),
    0 0 0 7px rgba(111, 150, 104, .13);
}

.tf-quick-trigger[data-state="completed"] {
  opacity: .94;
}

.tf-quick-trigger[data-state="failed"] {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--tf-danger) 76%, var(--tf-bg-card)),
    color-mix(in srgb, var(--tf-danger) 88%, #6f514d)
  );
}

.tf-quick-panel {
  position: fixed;
  right: 18px;
  bottom: 82px;
  width: min(356px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 104px));
  overflow: auto;
  padding: var(--tf-space-4);
  border-color: var(--tf-border-soft);
  border-radius: var(--tf-radius-lg);
  background: var(--tf-bg-panel);
  box-shadow: var(--tf-shadow-lg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  animation: tf-quick-enter var(--tf-transition) both;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--tf-green-500) 34%, transparent) transparent;
}

.tf-quick-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tf-space-3);
}

.tf-quick-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.tf-quick-brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 11px;
  background: var(--tf-green-100);
  color: var(--tf-green-800);
  font-size: 14px;
  font-weight: 760;
}

.tf-quick-brand-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.tf-quick-title {
  overflow: hidden;
  color: var(--tf-text-strong);
  font-size: var(--tf-font-size-md);
  font-weight: 750;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tf-quick-subtitle {
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
  line-height: 1.3;
}

.tf-quick-header-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: var(--tf-space-2);
}

.tf-quick-state-badge {
  min-height: 24px;
}

.tf-quick-close {
  min-width: 30px;
  min-height: 30px;
  border-radius: 10px;
  color: var(--tf-text-muted);
}

.tf-quick-state-block {
  display: grid;
  gap: var(--tf-space-2);
  margin-top: var(--tf-space-4);
  padding: 11px 12px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-subtle) 72%, transparent);
}

.tf-quick-status {
  min-height: 19px;
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  line-height: 1.45;
}

.tf-quick-status[data-kind="error"] {
  color: var(--tf-danger);
}

.tf-quick-status[data-kind="success"] {
  color: var(--tf-green-800);
}

.tf-quick-progress {
  height: 5px;
}

.tf-quick-primary-actions {
  margin-top: var(--tf-space-3);
}

.tf-quick-translate {
  width: 100%;
  min-height: 46px;
  border-color: transparent;
  border-radius: var(--tf-radius-sm);
  background: linear-gradient(180deg, var(--tf-green-600), var(--tf-green-800));
  color: #fff;
  box-shadow: 0 7px 18px rgba(65, 101, 62, .16);
  font-size: var(--tf-font-size-sm);
  font-weight: 720;
}

.tf-quick-translate:hover:not(:disabled) {
  border-color: transparent;
  background: linear-gradient(180deg, #789f71, var(--tf-green-700));
  transform: translateY(-1px);
}

.tf-quick-inline-actions {
  display: flex;
  gap: var(--tf-space-2);
  margin-top: var(--tf-space-2);
}

.tf-quick-inline-actions:empty,
.tf-quick-inline-actions:not(:has(> :not([hidden]))) {
  display: none;
}

.tf-quick-retry,
.tf-quick-cancel {
  flex: 1 1 0;
  min-height: 36px;
  color: var(--tf-text-secondary);
}

.tf-quick-cancel {
  color: var(--tf-danger);
}

.tf-quick-auto {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 58px;
  margin-top: var(--tf-space-3);
  padding: 10px 12px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: var(--tf-bg-card);
  color: var(--tf-text-main);
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--tf-transition),
    border-color var(--tf-transition),
    box-shadow var(--tf-transition);
}

.tf-quick-auto:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--tf-green-600) 28%, var(--tf-border-main));
  background: var(--tf-green-50);
}

.tf-quick-auto:focus-visible {
  outline: none;
  border-color: var(--tf-green-500);
  box-shadow: var(--tf-focus-ring);
}

.tf-quick-auto:disabled {
  opacity: .52;
  cursor: default;
}

.tf-quick-auto-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.tf-quick-auto-copy strong {
  color: var(--tf-text-strong);
  font-size: var(--tf-font-size-sm);
  font-weight: 680;
}

.tf-quick-auto-status {
  overflow: hidden;
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tf-quick-switch-visual {
  position: relative;
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  margin-left: var(--tf-space-3);
  border-radius: var(--tf-radius-pill);
  background: #d8d9d1;
  transition: background-color var(--tf-transition);
}

.tf-quick-switch-visual::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fffdf8;
  box-shadow: 0 2px 6px rgba(36, 56, 40, .15);
  transition: transform var(--tf-transition);
}

.tf-quick-auto[data-active="true"] .tf-quick-switch-visual {
  background: var(--tf-green-500);
}

.tf-quick-auto[data-active="true"] .tf-quick-switch-visual::after {
  transform: translateX(18px);
}

.tf-quick-preferences {
  display: grid;
  gap: var(--tf-space-3);
  margin-top: var(--tf-space-4);
  padding-top: var(--tf-space-4);
  border-top: 1px solid var(--tf-border-soft);
}

.tf-quick-section-title {
  color: var(--tf-text-muted);
  font-size: 11px;
  font-weight: 720;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.tf-quick-field {
  display: grid;
  gap: 6px;
}

.tf-quick-field-label {
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  font-weight: 600;
}

.tf-quick-field .tf-ui-select {
  width: 100%;
  min-height: 38px;
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-card) 86%, transparent);
  color: var(--tf-text-main);
}

.tf-quick-footer {
  display: flex;
  gap: var(--tf-space-2);
  margin-top: var(--tf-space-4);
  padding-top: var(--tf-space-3);
  border-top: 1px solid var(--tf-border-soft);
}

.tf-quick-footer .tf-ui-button {
  flex: 1 1 0;
  min-height: 34px;
  border-color: transparent;
  background: transparent;
  color: var(--tf-text-muted);
  box-shadow: none;
}

.tf-quick-footer .tf-ui-button:hover {
  background: var(--tf-green-50);
  color: var(--tf-text-main);
}

.tf-quick-control[data-suppressed="true"] {
  display: none;
}

@keyframes tf-quick-enter {
  from {
    opacity: 0;
    transform: translateY(5px) scale(.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

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
  .tf-quick-trigger,
  .tf-quick-panel,
  .tf-quick-auto,
  .tf-quick-switch-visual,
  .tf-quick-switch-visual::after,
  .tf-toast {
    animation: none !important;
    transition: none !important;
  }
}
`;

  app.modules.uiTokens = Object.freeze({ css });
})();
