(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.uiQuickControlPositionStyles) return;
  const css = `
.tf-quick-control, .tf-quick-trigger {
  position: fixed;
  right: 18px;
  bottom: 18px;
}
.tf-quick-trigger {
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.tf-quick-trigger[data-dragging="true"] {
  cursor: grabbing;
  transform: none;
}
.tf-quick-panel {
  position: fixed;
  right: 18px;
  bottom: 82px;
  width: min(356px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 104px));
}
`;
  app.modules.uiQuickControlPositionStyles = Object.freeze({ css });
})();
