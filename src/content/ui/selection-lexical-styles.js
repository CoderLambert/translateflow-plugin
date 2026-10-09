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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px 8px;
  margin-top: 7px;
  padding: 7px 2px 0;
  border: 0;
  border-top: 1px solid var(--tf-border-soft);
  border-radius: 0;
  background: transparent;
  color: var(--tf-text-secondary);
  font-size: var(--tf-font-size-xs);
  line-height: 1.35;
}
.tf-selection-record-status[data-state="saved"] {
  border-color: color-mix(in srgb, var(--tf-green-600) 18%, var(--tf-border-soft));
}
.tf-selection-record-message {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--tf-text-secondary);
  font-weight: 650;
}
.tf-selection-record-status[data-state="saved"] > .tf-selection-record-message::before {
  display: inline-grid;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  place-items: center;
  border-radius: 50%;
  background: var(--tf-green-100);
  color: var(--tf-green-800);
  content: "✓";
  font-size: 10px;
  line-height: 1;
}
.tf-selection-record-status > .tf-selection-record-actions {
  justify-content: flex-end;
  margin: 0 0 0 auto;
  padding: 0;
  border: 0;
}
.tf-selection-record-actions .tf-ui-button {
  min-height: 26px;
  padding: 3px 6px;
  color: var(--tf-text-muted);
  font-size: 10px;
}
@media (max-width: 360px) {
  .tf-selection-record-status[data-state="saved"] {
    padding-top: 5px;
  }
  .tf-selection-record-status[data-state="saved"] .tf-ui-button {
    width: 28px;
    min-height: 24px;
    overflow: hidden;
    padding: 3px;
    font-size: 0;
    white-space: nowrap;
  }
  .tf-selection-record-status[data-state="saved"] .tf-ui-button::before {
    content: "⚙";
    font-size: 12px;
  }
}
@media (max-height: 480px) {
  .tf-selection-record-status {
    padding-top: 4px;
  }
  .tf-selection-record-status > .tf-selection-record-message {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .tf-selection-record-status > .tf-selection-record-actions {
    grid-column: 1 / -1;
    justify-self: end;
  }
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
  gap: 8px;
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px solid var(--tf-border-soft);
}
.tf-selection-rich-heading {
  color: var(--tf-text-muted);
  font-size: var(--tf-font-size-xs);
  font-weight: 650;
  letter-spacing: .02em;
}
.tf-selection-rich-record {
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--tf-border-soft);
  border-radius: var(--tf-radius-sm);
  background: color-mix(in srgb, var(--tf-bg-subtle) 34%, var(--tf-bg-card));
}
.tf-selection-rich-record[open] {
  border-color: color-mix(in srgb, var(--tf-green-600) 22%, var(--tf-border-soft));
  background: var(--tf-bg-card);
  box-shadow: 0 5px 16px rgba(38, 58, 40, .07);
}
.tf-selection-rich-record[data-state="error"] {
  border-color: color-mix(in srgb, var(--tf-color-danger, #bd5550) 42%, var(--tf-border-soft));
}
.tf-selection-rich-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
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
  margin-top: 9px;
  padding-top: 10px;
  border-top: 1px solid var(--tf-border-soft);
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
  font-size: var(--tf-font-size-md);
  line-height: 1.62;
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
@media (max-width: 520px) {
  .tf-selection-panel { width: calc(100vw - 16px); max-height: calc(100vh - 16px); padding-inline: 13px; }
  .tf-selection-headword { font-size: 18px; }
}
`;

  app.modules.uiSelectionLexicalStyles = Object.freeze({ css });
})();
