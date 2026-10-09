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
.tf-reading-page-toggle { position: fixed; left: 14px; bottom: 14px; }
.tf-reading-page-panel { position: fixed; left: 14px; bottom: 58px; width: min(380px, calc(100vw - 28px)); max-height: min(520px, calc(100vh - 84px)); overflow: auto; padding: 14px; display: grid; gap: 9px; }
.tf-reading-page-panel header, .tf-reading-page-panel article { display: grid; grid-template-columns: minmax(0,1fr) auto auto; align-items: center; gap: 8px; }
.tf-reading-page-item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.tf-reading-page-panel span { color: var(--tf-color-muted); font-size: var(--tf-font-size-xs); }
.tf-reading-page-marker { position: fixed; display: block; width: 16px; height: 16px; min-width: 16px; min-height: 16px; padding: 0 !important; border: 3px solid var(--tf-color-surface); border-radius: 50%; color: transparent; background: var(--tf-green-700); box-shadow: 0 0 0 1px color-mix(in srgb, var(--tf-green-800) 74%, transparent), 0 2px 7px rgba(30,50,30,.22); font-size: 0; line-height: 0; opacity: .92; transition: transform .14s ease, opacity .14s ease, background-color .14s ease; }
.tf-reading-page-marker:hover { background: var(--tf-green-900); opacity: 1; transform: scale(1.1); }
.tf-reading-page-marker:focus-visible { outline: 3px solid var(--tf-green-500); outline-offset: 3px; }
.tf-reading-preview-shell { position: fixed; right: 16px; bottom: 16px; width: min(560px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; }
.tf-reading-preview-shell header { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--tf-color-border); }
.tf-reading-preview-frame { width: 100%; height: 100%; min-height: 0; border: 0; background: var(--tf-color-surface); color-scheme: light dark; }
@media (max-width: 480px) { .tf-reading-preview-shell { right: 8px; bottom: 8px; width: calc(100vw - 16px); height: calc(100vh - 16px); } }
` });
})();
