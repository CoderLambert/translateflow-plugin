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
` });
})();
