(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiSelectionEmptyStateStyles) return;

  const css = `
.tf-selection-empty {
  padding: 8px 2px 4px;
}
.tf-selection-empty-title {
  display: block;
  color: var(--tf-text-strong);
  font-size: 15px;
  line-height: 1.4;
}
.tf-selection-empty-message {
  margin-top: 5px;
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-sm);
  line-height: 1.55;
}
.tf-selection-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
`;

  app.modules.uiSelectionEmptyStateStyles = Object.freeze({ css });
})();
