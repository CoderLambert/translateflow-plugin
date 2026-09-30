(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiSelectionLexicalStyles) return;

  const css = `
.tf-selection-action-primary {
  border-color: color-mix(in srgb, var(--tf-color-accent) 48%, transparent);
  background: var(--tf-green-700);
  color: var(--tf-primary-foreground);
  box-shadow: var(--tf-accent-shadow);
}
.tf-selection-action-primary:hover {
  background: var(--tf-primary-hover-start);
}
.tf-selection-action-quiet {
  border-color: transparent;
  background: transparent;
  color: var(--tf-text-secondary);
  box-shadow: none;
}
.tf-selection-action-quiet:hover {
  border-color: var(--tf-border-soft);
  background: var(--tf-bg-subtle);
}
.tf-selection-dictionary-entries {
  display: grid;
  gap: 7px;
  margin-top: 6px;
}
.tf-selection-dictionary-entry {
  padding: 8px 9px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-card) 84%, transparent);
}
.tf-selection-dictionary-entry[data-primary="true"] {
  border-color: color-mix(in srgb, var(--tf-green-600) 26%, var(--tf-border-soft));
  background: color-mix(in srgb, var(--tf-green-50) 64%, var(--tf-bg-card));
}
.tf-selection-entry-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 7px;
  margin-bottom: 4px;
}
.tf-selection-entry-number {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--tf-radius-pill);
  background: var(--tf-bg-subtle);
  color: var(--tf-text-secondary);
  font-size: 11px;
  font-weight: 700;
}
.tf-selection-entry-meta {
  overflow-wrap: anywhere;
  color: var(--tf-text-muted);
  font-size: 11px;
  line-height: 1.3;
}
.tf-selection-entry-meaning {
  overflow-wrap: anywhere;
  color: var(--tf-text-strong);
  font-size: var(--tf-font-size-md);
  font-weight: 650;
  line-height: 1.5;
}
.tf-selection-entry-alternative {
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: var(--tf-text-main);
  font-size: var(--tf-font-size-sm);
  line-height: 1.5;
}
.tf-selection-entry-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.tf-selection-entry-facts span {
  padding: 2px 6px;
  border-radius: var(--tf-radius-pill);
  background: var(--tf-bg-subtle);
  color: var(--tf-text-secondary);
  font-size: 11px;
}
.tf-selection-entry-provenance {
  margin-top: 6px;
  color: var(--tf-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
.tf-selection-more-entries {
  padding: 3px 2px 0;
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
}
.tf-selection-rich-details {
  display: grid;
  gap: 7px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--tf-border-soft);
}
.tf-selection-rich-heading {
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  letter-spacing: .02em;
}
.tf-selection-rich-record {
  padding: 8px 9px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-card) 88%, transparent);
}
.tf-selection-rich-title {
  margin-bottom: 3px;
  color: var(--tf-text-muted);
  font-size: 11px;
  font-weight: 650;
}
.tf-selection-rich-headword {
  margin-bottom: 4px;
  color: var(--tf-text-strong);
  font-size: var(--tf-font-size-sm);
  font-weight: 700;
}
.tf-selection-rich-text {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: var(--tf-text-main);
  font-size: var(--tf-font-size-sm);
  line-height: 1.55;
}
.tf-selection-rich-error {
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
}
`;

  app.modules.uiSelectionLexicalStyles = Object.freeze({ css });
})();
