(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.uiReadingReturnStyles) return;
  app.modules.uiReadingReturnStyles = Object.freeze({ css: `
.tf-reading-return-card { position: fixed; right: 20px; bottom: 20px; width: min(360px, calc(100vw - 32px)); padding: 16px; display: grid; gap: 10px; }
.tf-reading-return-card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tf-reading-return-card h2 { margin: 0; font-size: 15px; color: var(--tf-text-strong); }
.tf-reading-return-card blockquote { margin: 0; padding: 10px 12px; border-left: 3px solid var(--tf-green-500); background: var(--tf-bg-subtle); border-radius: var(--tf-radius-xs); overflow-wrap: anywhere; }
.tf-reading-return-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.tf-reading-return-highlight { position: fixed; pointer-events: none; border: 2px solid var(--tf-green-700); background: color-mix(in srgb, var(--tf-green-300) 42%, transparent); border-radius: 4px; box-shadow: 0 0 0 2px rgba(255,255,255,.78); }
@media (max-width: 480px) { .tf-reading-return-card { right: 12px; bottom: 12px; width: calc(100vw - 24px); } }
@media (prefers-reduced-motion: reduce) { .tf-reading-return-card, .tf-reading-return-highlight { transition: none !important; } }
.tf-reading-page-highlight { position: fixed; display: block; pointer-events: none !important; border-bottom: 2px solid color-mix(in srgb, var(--tf-green-700) 84%, transparent); border-radius: 3px; background: color-mix(in srgb, var(--tf-green-300) 22%, transparent); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--tf-green-900) 12%, transparent); transition: background-color .16s ease, border-color .16s ease; }
.tf-reading-hover-preview { position: fixed; height: min(260px, calc(100vh - 16px)); max-height: min(560px, calc(100vh - 16px)); padding: 0; overflow: hidden; border-color: color-mix(in srgb, var(--tf-green-700) 34%, var(--tf-color-border)); box-shadow: 0 14px 36px rgba(30,50,30,.2); }
.tf-reading-hover-frame { display: block; width: 100%; height: 100%; border: 0; background: var(--tf-color-surface); color-scheme: light dark; }
.tf-reading-preview-shell { position: fixed; right: 16px; bottom: 16px; width: min(560px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
.tf-reading-preview-shell header { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--tf-color-border); }
.tf-reading-preview-frame { width: 100%; height: 100%; min-height: 0; border: 0; background: var(--tf-color-surface); color-scheme: light dark; }
@media (max-width: 480px) { .tf-reading-hover-preview { width: calc(100vw - 16px); max-height: calc(100vh - 16px); } .tf-reading-preview-shell { right: 8px; bottom: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); } }
@media (prefers-reduced-motion: reduce) { .tf-reading-page-highlight { transition: none !important; } }
` });
})();
