(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiSelectionAiDetailStyles) return;

  const css = `
.tf-selection-view-tabs {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  margin: 1px 0 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--tf-border-soft);
  scrollbar-width: none;
}
.tf-selection-view-tabs::-webkit-scrollbar { display: none; }
.tf-selection-view-tab.tf-ui-button {
  position: relative;
  flex: 0 0 auto;
  min-height: 34px;
  padding: 8px 12px 9px;
  border: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-sm);
  font-weight: 650;
  box-shadow: none;
}
.tf-selection-view-tab.tf-ui-button[data-view="understand"] {
  margin-left: 6px;
}
.tf-selection-view-tab.tf-ui-button[data-view="understand"]::before {
  position: absolute;
  left: -5px;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: var(--tf-border-soft);
  content: "";
}
.tf-selection-view-tab.tf-ui-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--tf-green-50) 68%, transparent);
  color: var(--tf-text-secondary);
}
.tf-selection-view-tab.tf-ui-button[aria-selected="true"] {
  background: color-mix(in srgb, var(--tf-green-50) 84%, var(--tf-bg-card));
  color: var(--tf-green-800);
}
.tf-selection-view-tab.tf-ui-button[aria-selected="true"]::after {
  position: absolute;
  right: 10px;
  bottom: -1px;
  left: 10px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--tf-green-600);
  content: "";
}
.tf-selection-view-tab.tf-ui-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--tf-green-500) 58%, transparent);
  outline-offset: -3px;
}
.tf-selection-view-tab.tf-ui-button:disabled {
  cursor: default;
  opacity: .42;
}
.tf-selection-view-tab[data-state="starting"]::after,
.tf-selection-view-tab[data-state="loading"]::after,
.tf-selection-view-tab[data-state="streaming"]::after,
.tf-selection-view-tab[data-state="stopping"]::after {
  background: var(--tf-info);
}
.tf-selection-workspace {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.tf-selection-view-panel {
  flex: 1 1 auto;
  width: 100%;
}
.tf-selection-ai-panel {
  min-height: 0;
  max-height: min(472px, calc(100vh - 196px));
  overflow: auto;
  overflow-anchor: none;
  margin: 0 -6px;
  padding: 3px 8px 10px;
  color: var(--tf-color-text);
  font-size: var(--tf-font-size-md);
  line-height: 1.6;
  overflow-wrap: anywhere;
  scrollbar-color: color-mix(in srgb, var(--tf-green-600) 45%, transparent) transparent;
  scrollbar-width: thin;
}
.tf-selection-ai-panel .tf-selection-generated {
  margin-top: 0;
  padding-top: 3px;
  border-top: 0;
}
@media (max-height: 480px) {
  .tf-selection-ai-panel { flex: 1 1 0; min-height: 56px; max-height: none; }
}
.tf-selection-ai-detail[aria-busy="true"] {
  opacity: .92;
}
.tf-selection-ai-detail[data-state="actions"] {
  margin-top: 12px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--tf-green-600) 18%, var(--tf-border-soft));
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-green-50) 82%, var(--tf-bg-card));
}
.tf-selection-ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.tf-selection-ai-header .tf-selection-generated-label {
  margin-bottom: 0;
}
.tf-selection-ai-status {
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-sm);
  line-height: 1.5;
}
.tf-selection-ai-status[data-kind="error"] {
  color: var(--tf-danger);
}
.tf-selection-ai-status[data-kind="cancelled"] {
  color: var(--tf-text-muted);
}
.tf-selection-ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}
.tf-selection-ai-actions .tf-ui-button {
  flex: 1 1 92px;
  padding: 7px 10px;
  background: var(--tf-bg-card);
}
`;

  app.modules.uiSelectionAiDetailStyles = Object.freeze({ css });
})();
