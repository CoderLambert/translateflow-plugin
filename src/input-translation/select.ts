// A small select-only combobox over the existing native select model.
// Keyboard/AT semantics stay explicit; no React runtime is introduced here.
export function enhanceSelect(select: HTMLSelectElement) {
  const root = document.createElement("div"); root.className = "select-shell";
  select.before(root); root.append(select); select.hidden = true;
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "select-trigger";
  trigger.id = `${select.id}-trigger`; trigger.setAttribute("role", "combobox"); trigger.setAttribute("aria-haspopup", "listbox");
  const value = document.createElement("span"); value.id = `${select.id}-value`; value.className = "select-value";
  const chevron = document.createElement("span"); chevron.className = "select-chevron"; chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);
  trigger.setAttribute("aria-labelledby", `${select.id}-label ${value.id}`);
  const menu = document.createElement("div"); menu.className = "select-menu"; menu.id = `${select.id}-menu`;
  menu.setAttribute("role", "listbox"); menu.setAttribute("aria-labelledby", `${select.id}-label`); menu.hidden = true;
  trigger.setAttribute("aria-controls", menu.id); trigger.setAttribute("aria-expanded", "false");
  root.append(trigger, menu);
  let active = -1, prefix = "", typedAt = 0;
  function close() { menu.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.removeAttribute("aria-activedescendant"); }
  function highlight(index: number) {
    active = index;
    [...menu.children].forEach((node, i) => node.classList.toggle("highlighted", i === active));
    const item = menu.children[active] as HTMLElement | undefined;
    if (item) { trigger.setAttribute("aria-activedescendant", item.id); item.scrollIntoView({ block: "nearest" }); }
  }
  function choose(index: number) {
    const option = select.options[index];
    if (select.disabled || !option || option.disabled) return;
    select.value = option.value; close(); sync();
    select.dispatchEvent(new Event("change", { bubbles: true })); trigger.focus();
  }
  function sync() {
    value.textContent = select.selectedOptions[0]?.label || "—";
    trigger.title = value.textContent;
    trigger.disabled = select.disabled || select.options.length === 0;
    if (trigger.disabled) close();
    menu.replaceChildren(...[...select.options].map((option, index) => {
      const node = document.createElement("div"); node.className = "select-option"; node.id = `${select.id}-option-${index}`;
      node.setAttribute("role", "option"); node.setAttribute("aria-selected", String(option.selected));
      node.setAttribute("aria-disabled", String(option.disabled)); node.textContent = option.label; node.title = option.label;
      node.onpointerdown = event => event.preventDefault();
      node.onclick = () => choose(index);
      node.onpointermove = () => { if (!option.disabled) highlight(index); };
      return node;
    }));
    if (!menu.hidden) highlight(select.selectedIndex);
  }
  function open() {
    if (select.disabled || !select.options.length) return;
    sync(); menu.hidden = false; trigger.setAttribute("aria-expanded", "true");
    highlight(select.selectedIndex >= 0 ? select.selectedIndex : 0);
  }
  trigger.onclick = () => { if (menu.hidden) open(); else close(); };
  trigger.onkeydown = event => {
    if (select.disabled || event.isComposing) return;
    if (event.key === "Escape") { if (!menu.hidden) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (event.key === "Tab") { close(); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (menu.hidden) { open(); if (event.key === "ArrowDown" || event.key === "ArrowUp") return; }
      const enabled = [...select.options].map((option, i) => option.disabled ? -1 : i).filter(i => i >= 0);
      if (!enabled.length) return;
      const current = enabled.indexOf(active);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      highlight(enabled[next]!); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); if (menu.hidden) open(); else choose(active); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      prefix = performance.now() - typedAt < 600 ? prefix + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase(); typedAt = performance.now();
      const index = [...select.options].findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(prefix));
      if (index >= 0) { event.preventDefault(); if (menu.hidden) open(); highlight(index); }
    }
  };
  const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) close(); };
  const observer = new MutationObserver(sync);
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected"] });
  select.addEventListener("change", sync); document.addEventListener("pointerdown", outside);
  window.addEventListener("blur", close); window.addEventListener("resize", close);
  sync();
  return { sync, close, dispose() { observer.disconnect(); select.removeEventListener("change", sync); document.removeEventListener("pointerdown", outside); window.removeEventListener("blur", close); window.removeEventListener("resize", close); } };
}
