import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string; disabled?: boolean };
type Props = { id: string; label: string; value: string; options: SelectOption[]; disabled?: boolean; title?: string; className?: string; onChange: (value: string) => void };
export function PopupSelect({ id, label, value, options, disabled, title, className = "", onChange }: Props) {
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 220 });
  const typing = useRef({ prefix: "", at: 0 });
  const selected = options.find(option => option.value === value);
  function close() { setOpen(false); }
  function show() { if (disabled || !options.length) return; setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
  function choose(index: number) {
    const option = options[index]; if (!option || option.disabled || disabled) return;
    onChange(option.value); close(); trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 190), innerWidth - 24);
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const height = Math.min(220, options.length * 35 + 10);
    const up = below < height && above > below;
    const available = Math.max(36, up ? above : below), maxHeight = Math.min(height, available);
    setPosition({ top: up ? rect.top - maxHeight - 6 : rect.bottom + 6, left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)), width, maxHeight });
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(); };
    const blur = () => close();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", blur); window.addEventListener("blur", blur); document.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", blur); window.removeEventListener("blur", blur); document.removeEventListener("scroll", scroll, true); };
  }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (open) menu.current?.children[active]?.scrollIntoView({ block: "nearest" }); }, [open, active]);
  return <div className={`popup-select ${className}`}>
    <select id={id} hidden aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>
    <button ref={trigger} id={`${id}-trigger`} type="button" className="popup-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} aria-activedescendant={open ? `${id}-option-${active}` : undefined} disabled={disabled} title={title || selected?.label} onClick={() => open ? close() : show()} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); close(); } return; }
      if (event.key === "Tab") { close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!open) { show(); return; }
        const enabled = options.map((option, i) => option.disabled ? -1 : i).filter(i => i >= 0); if (!enabled.length) return;
        const current = enabled.indexOf(active), index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
        setActive(enabled[index]!); return;
      }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active); else show(); return; }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = performance.now(), prefix = now - typing.current.at < 600 ? typing.current.prefix + event.key.toLowerCase() : event.key.toLowerCase(); typing.current = { prefix, at: now };
        const index = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(prefix));
        if (index >= 0) { event.preventDefault(); setOpen(true); setActive(index); }
      }
    }}><span>{selected?.label || "—"}</span><span className="popup-select-chevron" aria-hidden="true" /></button>
    {open && !disabled && createPortal(<div ref={menu} id={`${id}-menu`} className="popup-select-menu" role="listbox" aria-label={label} style={{ position: "fixed", ...position }}>{options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} aria-disabled={Boolean(option.disabled)} className={`popup-select-option${index === active ? " highlighted" : ""}`} title={option.label} onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}><span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}</div>)}</div>, document.body)}
  </div>;
}
