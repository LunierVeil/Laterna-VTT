import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../Button/Button.tsx";
import "./Dialog.css";

export type DialogProps = {
  open: boolean; kind?: "confirmation" | "danger" | "information"; title: string; description?: ReactNode;
  confirmLabel: string; onConfirm: () => void | Promise<void>; onClose: () => void; pending?: boolean;
};

export function Dialog({ open, kind = "confirmation", title, description, confirmLabel, onConfirm, onClose, pending = false }: DialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const busy = pending || running;
  useEffect(() => {
    if (!open) return;
    const node = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(undefined);
    node.showModal();
    (kind === "information" ? confirm.current : cancel.current)?.focus();
    return () => {
      generation.current++;
      locked.current = false;
      setRunning(false);
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open, kind]);
  useEffect(() => {
    if (open && busy) dialog.current?.focus();
  }, [open, busy]);
  async function submit() {
    if (pending || locked.current) return;
    locked.current = true;
    const current = generation.current;
    setRunning(true); setError(undefined);
    try { await onConfirm(); }
    catch (reason) {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : "Не удалось выполнить действие. Повторите попытку.");
    } finally {
      if (generation.current === current) { locked.current = false; setRunning(false); }
    }
  }
  if (!open || typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="ds-dialog" role={kind === "information" ? "dialog" : "alertdialog"}
    aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description != null ? `${id}-description` : undefined}
    aria-busy={busy || undefined} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(node => node.getClientRects().length > 0 && !node.closest('[hidden], [inert]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!busy && event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose();
    }}>
    <h3 className="ds-dialog-title" id={`${id}-title`}>{title}</h3>
    <div className="ds-dialog-body">
      {description != null && <div id={`${id}-description`}>{description}</div>}
      {error && <p className="ds-dialog-error" role="alert">{error}</p>}
    </div>
    <div className="ds-dialog-actions">
      {kind !== "information" && <Button ref={cancel} disabled={busy} onClick={onClose}>Отмена</Button>}
      <Button ref={confirm} disabled={busy} variant={kind === "danger" ? "danger" : "primary"} onClick={() => { void submit(); }}>{confirmLabel}</Button>
    </div>
    {busy && <span role="status">Выполняется…</span>}
  </dialog>, document.body);
}
