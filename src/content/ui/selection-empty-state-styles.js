(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiSelectionEmptyStateStyles) return;

  const css = `
.tf-selection-ui { font-family: var(--tf-font-family); }
.tf-selection-routing {
  flex: 0 0 auto;
  min-width: 0;
  margin: 0 0 10px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-green-50) 45%, var(--tf-bg-card));
}
.tf-selection-method-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 10px;
  cursor: pointer;
  list-style: none;
  font-size: var(--tf-font-size-xs);
  line-height: 1.4;
  border-radius: inherit;
}
.tf-selection-method-summary::-webkit-details-marker { display: none; }
.tf-selection-method-summary:hover { background: var(--tf-color-hover); }
.tf-selection-method-summary:focus-visible,
.tf-selection-routing .tf-ui-button:focus-visible {
  outline: 2px solid var(--tf-color-accent);
  outline-offset: 2px;
}
.tf-selection-method-context { color: var(--tf-text-secondary); }
.tf-selection-method-current { color: var(--tf-text-strong); font-weight: 650; }
.tf-selection-method-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  color: var(--tf-color-accent);
  white-space: nowrap;
}
.tf-selection-method-switch::after {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  content: "";
  transform: translateY(-2px) rotate(45deg);
}
.tf-selection-routing[open] .tf-selection-method-switch::after { transform: translateY(1px) rotate(225deg); }
.tf-selection-method-body {
  max-height: min(330px, 45vh);
  overflow: auto;
  padding: 0 10px 8px;
  border-top: 1px solid var(--tf-border-soft);
}
.tf-selection-method-hint { margin: 9px 0; color: var(--tf-text-secondary); font-size: var(--tf-font-size-xs); line-height: 1.5; }
.tf-selection-method-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.tf-selection-method-choice.tf-ui-button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  min-height: 60px;
  padding: 9px 10px;
  border-radius: var(--tf-radius-xs);
  background: var(--tf-bg-card);
  text-align: left;
  box-shadow: none;
  line-height: 1.4;
}
.tf-selection-method-choice[aria-pressed="true"] {
  border-color: var(--tf-color-accent);
  background: color-mix(in srgb, var(--tf-green-100) 65%, var(--tf-bg-card));
}
.tf-selection-method-choice[aria-pressed="true"] .tf-selection-method-name::after { margin-left: 7px; color: var(--tf-color-accent); content: "✓"; }
.tf-selection-method-name { color: var(--tf-text-strong); font-size: var(--tf-font-size-sm); font-weight: 650; }
.tf-selection-method-description { color: var(--tf-text-secondary); font-size: var(--tf-font-size-xs); font-weight: 400; }
.tf-selection-method-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px; margin-top: 7px; }
.tf-selection-method-link.tf-ui-button { min-height: 32px; padding: 6px 0; border: 0; border-radius: 4px; background: transparent; color: var(--tf-color-accent); box-shadow: none; font-size: var(--tf-font-size-xs); font-weight: 500; }
.tf-selection-method-link:hover { text-decoration: underline; }

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
