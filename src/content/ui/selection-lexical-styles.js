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
.tf-selection-vocabulary-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--tf-border-soft);
}
.tf-selection-vocabulary-actions[hidden] { display: none; }
.tf-selection-vocabulary-status {
  flex: 1 1 100%;
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  line-height: 1.4;
}
.tf-selection-vocabulary-status[hidden] { display: none; }
.tf-selection-vocabulary-actions button { min-height: 34px; }
.tf-selection-record-status {
  flex: 0 0 auto;
  margin-top: 8px;
  padding: 9px 10px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: var(--tf-bg-subtle);
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  line-height: 1.45;
}
.tf-selection-record-status[data-state="saved"] {
  border-color: color-mix(in srgb, var(--tf-green-600) 24%, var(--tf-border-soft));
  background: var(--tf-green-50);
  color: var(--tf-green-800);
}
.tf-selection-record-status > .tf-selection-actions {
  justify-content: flex-start;
  margin-top: 7px;
  padding-top: 7px;
}
.tf-selection-footer-actions {
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 10px;
}
.tf-selection-footer-actions .tf-selection-action-primary {
  min-height: 36px;
  padding-inline: 14px;
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
.tf-selection-example {
  margin: 8px 0 0;
  padding: 6px 9px;
  border-left: 2px solid var(--tf-warning);
  border-radius: 0 var(--tf-radius-xs) var(--tf-radius-xs) 0;
  background: color-mix(in srgb, var(--tf-bg-subtle) 70%, var(--tf-bg-card));
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-sm);
  line-height: 1.5;
  white-space: pre-wrap;
}
.tf-selection-dictionary-disclosure {
  margin-top: 9px;
  padding-top: 7px;
  border-top: 1px solid var(--tf-border-soft);
}
.tf-selection-dictionary-disclosure-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  color: var(--tf-green-800);
  font-size: var(--tf-font-size-xs);
  font-weight: 650;
  cursor: pointer;
  list-style: none;
}
.tf-selection-dictionary-disclosure-summary::-webkit-details-marker { display: none; }
.tf-selection-dictionary-disclosure-summary::before {
  display: inline-grid;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 50%;
  background: var(--tf-green-100);
  color: var(--tf-green-800);
  content: "+";
  font-size: 14px;
  line-height: 1;
}
.tf-selection-dictionary-disclosure[open] > .tf-selection-dictionary-disclosure-summary::before {
  content: "−";
}
.tf-selection-dictionary-disclosure-summary:focus-visible {
  border-radius: var(--tf-radius-xs);
  outline: 2px solid var(--tf-green-500);
  outline-offset: 2px;
}
.tf-selection-dictionary-disclosure-body { padding-top: 2px; }
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
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-card) 88%, transparent);
}
.tf-selection-rich-record[data-state="error"] {
  border-color: color-mix(in srgb, var(--tf-color-danger, #bd5550) 42%, var(--tf-border-soft));
}
.tf-selection-rich-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}
.tf-selection-rich-summary::-webkit-details-marker { display: none; }
.tf-selection-rich-order {
  display: inline-grid;
  min-width: 19px;
  height: 19px;
  place-items: center;
  border-radius: 50%;
  background: var(--tf-bg-subtle);
  color: var(--tf-text-secondary);
  font-size: 10px;
  font-weight: 700;
}
.tf-selection-rich-identity { display: grid; min-width: 0; gap: 3px; }
.tf-selection-rich-title {
  display: block;
  margin: 0;
  color: var(--tf-text-main);
  font-size: var(--tf-font-size-xs);
  font-weight: 700;
  line-height: 1.35;
}
.tf-selection-rich-preference {
  width: fit-content;
  color: var(--tf-text-secondary);
  font-size: 10px;
  font-weight: 700;
}
.tf-selection-rich-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  color: var(--tf-text-muted);
  font-size: 10px;
  line-height: 1.35;
}
.tf-selection-rich-format { font-weight: 650; }
.tf-selection-rich-card-status {
  max-width: 92px;
  padding: 2px 6px;
  border-radius: var(--tf-radius-pill);
  background: var(--tf-green-50);
  color: var(--tf-green-800);
  font-size: 10px;
  line-height: 1.35;
  text-align: right;
}
.tf-selection-rich-record[data-state="error"] .tf-selection-rich-card-status {
  color: var(--tf-color-danger, #bd5550);
}
.tf-selection-rich-card-body {
  min-width: 0;
  padding-top: 8px;
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
.tf-selection-rich-empty,
.tf-selection-rich-deferred {
  margin: 0;
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
}
.tf-selection-rich-retry {
  margin-top: 7px;
  padding: 4px 8px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-pill);
  background: var(--tf-bg-card);
  color: var(--tf-text-secondary);
  font: inherit;
  font-size: var(--tf-font-size-xs);
  cursor: pointer;
}
.tf-selection-rich-retry:hover { border-color: var(--tf-green-600); }
@media (max-width: 360px) {
  .tf-selection-rich-summary { grid-template-columns: auto minmax(0, 1fr); }
  .tf-selection-rich-card-status { grid-column: 2; max-width: none; text-align: left; }
}
`;

  app.modules.uiSelectionLexicalStyles = Object.freeze({ css });
})();
