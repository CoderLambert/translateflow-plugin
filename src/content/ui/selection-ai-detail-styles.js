(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiSelectionAiDetailStyles) return;

  const css = `
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
