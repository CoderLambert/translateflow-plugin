import { useEffect, useRef } from "react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import type { I18n } from "../../i18n/index.js";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button type="button" {...props} />; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{children}</p>;
}
export function Confirmation({ text, i18n, onConfirm, onCancel }: { text: string; i18n: I18n; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current; dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); onCancel(); }} aria-labelledby="confirmation-title">
    <h2 id="confirmation-title">{text}</h2><p>{i18n.t("learning.deleteHelp")}</p>
    <div className="actions"><Button autoFocus onClick={onCancel}>{i18n.t("learning.cancel")}</Button>
      <Button className="danger" onClick={onConfirm}>{i18n.t("learning.confirm")}</Button></div>
  </dialog>;
}
