import { useId, useLayoutEffect, useRef, useState } from "react";
import type { SelectHTMLAttributes } from "react";
import { PopupSelect } from "../popup/PopupSelect";
import type { SelectOption } from "../popup/PopupSelect";

// Preserve the native option tree and React change handler as the source of truth.
// Presentation changes only; saving, permissions and drafts keep their owners.
export function StyledSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId().replaceAll(":", ""), native = useRef<HTMLSelectElement>(null);
  const id = props.id || `settings-select-${generated}`;
  const [model, setModel] = useState<{ options: SelectOption[]; value: string; label: string }>({ options: [], value: "", label: "" });
  const signature = useRef("");
  useLayoutEffect(() => {
    const node = native.current;
    if (!node) return;
    const linked = props["aria-labelledby"]?.split(/\s+/u).map(labelId => document.getElementById(labelId)?.textContent || "").join(" ");
    const label = props["aria-label"] || linked || [...document.querySelectorAll("label")].find(item => item.htmlFor === id)?.textContent ||
      [...(node.closest("label")?.childNodes || [])].filter(item => item.nodeType === Node.TEXT_NODE).map(item => item.textContent).join(" ") || node.title || "";
    const options = [...node.options].map(option => ({ value: option.value, label: option.label,
      disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) }));
    const next = { options, value: node.value, label: label.trim() }, nextSignature = JSON.stringify(next);
    if (nextSignature !== signature.current) { signature.current = nextSignature; setModel(next); }
  });
  return <div className={"styled-select " + (props.className || "")} style={props.style}>
    <select {...props} id={`${id}-native`} ref={native} hidden tabIndex={-1} aria-hidden="true" className="styled-select-model" />
    <PopupSelect id={`${id}-model`} triggerId={id} label={model.label} describedBy={props["aria-describedby"]} title={props.title}
      value={model.value} options={model.options} disabled={props.disabled} onChange={value => {
        if (!native.current || props.disabled) return;
        native.current.value = value;
        native.current.dispatchEvent(new Event("change", { bubbles: true }));
      }} />
  </div>;
}
