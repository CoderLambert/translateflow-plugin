(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app || app.modules.quickControlPosition) return;

  function create({ trigger, panel, position = null, onCommit, onMove }) {
    let value = position, pointer = null, keyboard = null, suppressClick = false;
    const listeners = [];
    const listen = (node, name, fn, options) => {
      node.addEventListener(name, fn, options);
      listeners.push(() => node.removeEventListener(name, fn, options));
    };
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    function bounds() {
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const mx = Math.min(18, Math.max(0, (width - trigger.offsetWidth) / 2));
      const my = Math.min(18, Math.max(0, (height - trigger.offsetHeight) / 2));
      return { left, top, width, height, x: left + mx, y: top + my,
        dx: Math.max(0, width - trigger.offsetWidth - mx * 2), dy: Math.max(0, height - trigger.offsetHeight - my * 2) };
    }
    function point() {
      const b = bounds();
      return { x: b.x + (value?.x ?? 1) * b.dx, y: b.y + (value?.y ?? 1) * b.dy };
    }
    function move(x, y) {
      const b = bounds();
      value = { x: b.dx ? clamp((x - b.x) / b.dx, 0, 1) : 0, y: b.dy ? clamp((y - b.y) / b.dy, 0, 1) : 0 };
      reposition();
    }
    function reposition() {
      const p = point(), b = bounds();
      Object.assign(trigger.style, { left: `${p.x}px`, top: `${p.y}px`, right: "auto", bottom: "auto" });
      if (panel.hidden) return;
      panel.style.width = `${Math.min(356, Math.max(0, b.width - 24))}px`;
      const aboveSpace = p.y - b.top - 24, belowSpace = b.top + b.height - p.y - trigger.offsetHeight - 24;
      panel.style.maxHeight = `${Math.max(0, Math.min(560, Math.max(aboveSpace, belowSpace)))}px`;
      const width = panel.offsetWidth, height = panel.offsetHeight;
      const above = p.y - height - 12, below = p.y + trigger.offsetHeight + 12;
      const y = above >= b.top + 12 ? above : below + height <= b.top + b.height - 12 ? below : above;
      Object.assign(panel.style, {
        left: `${clamp(p.x + trigger.offsetWidth - width, b.left + 12, b.left + b.width - width - 12)}px`,
        top: `${clamp(y, b.top + 12, b.top + b.height - height - 12)}px`, right: "auto", bottom: "auto"
      });
    }
    function endPointer(commit) {
      if (!pointer) return;
      const old = pointer;
      pointer = null;
      delete trigger.dataset.dragging;
      if (!commit) suppressClick = true;
      if (old.moved) {
        suppressClick = true;
        if (commit) onCommit?.(value);
        else { value = old.value; reposition(); }
      }
      if (trigger.hasPointerCapture(old.id)) trigger.releasePointerCapture(old.id);
    }
    function endKeyboard(commit) {
      if (!keyboard) return;
      const old = keyboard;
      keyboard = null;
      if (commit) onCommit?.(value);
      else { value = old.value; reposition(); }
    }
    function cancel() { endPointer(false); endKeyboard(false); }
    function reset() { cancel(); value = null; reposition(); onCommit?.(null); }
    listen(trigger, "pointerdown", event => {
      if (!event.isTrusted || !event.isPrimary || event.button !== 0 || pointer) return;
      endKeyboard(true);
      suppressClick = false;
      pointer = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, point: point(), value, moved: false };
      trigger.setPointerCapture(event.pointerId);
    });
    listen(trigger, "pointermove", event => {
      if (!pointer || event.pointerId !== pointer.id || !event.isTrusted) return;
      const dx = event.clientX - pointer.clientX, dy = event.clientY - pointer.clientY;
      if (!pointer.moved && Math.hypot(dx, dy) < 6) return;
      if (!pointer.moved) { pointer.moved = true; trigger.dataset.dragging = "true"; onMove?.(); }
      event.preventDefault();
      move(pointer.point.x + dx, pointer.point.y + dy);
    });
    listen(trigger, "pointerup", event => { if (event.pointerId === pointer?.id) endPointer(true); });
    listen(trigger, "pointercancel", () => endPointer(false));
    listen(trigger, "lostpointercapture", () => endPointer(false));
    listen(trigger, "click", event => {
      if (!suppressClick || !event.detail) return;
      suppressClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    listen(trigger, "keydown", event => {
      if (!event.isTrusted || !event.altKey) return;
      if (event.key === "Home") { event.preventDefault(); reset(); return; }
      const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
      if (!delta || pointer) return;
      event.preventDefault();
      keyboard ||= { value };
      onMove?.();
      const p = point(); move(p.x + delta[0], p.y + delta[1]);
    });
    listen(trigger, "keyup", event => { if (event.key.startsWith("Arrow") || event.key === "Alt") endKeyboard(true); });
    listen(trigger, "blur", () => endKeyboard(true));
    listen(window, "keydown", event => {
      if (event.key !== "Escape" || (!pointer && !keyboard)) return;
      event.preventDefault(); event.stopPropagation(); cancel();
    }, true);
    listen(window, "blur", cancel);
    listen(window, "resize", () => { cancel(); reposition(); });
    if (window.visualViewport) {
      listen(window.visualViewport, "resize", () => { cancel(); reposition(); });
      listen(window.visualViewport, "scroll", reposition);
    }
    const observer = new ResizeObserver(reposition);
    observer.observe(panel);
    reposition();
    return {
      reset, reposition, cancel,
      setPosition(position) { cancel(); value = position; reposition(); },
      dispose() { cancel(); observer.disconnect(); listeners.forEach(remove => remove()); }
    };
  }
  app.modules.quickControlPosition = { create };
})();
