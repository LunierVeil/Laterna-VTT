import { useEffect, useRef } from "react";

/**
 * Маленький диалог подтверждения вместо window.confirm: тот блокирует
 * страницу (и сокет перестаёт рисовать события), выглядит чужим и не
 * переводится. Esc и клик мимо - отмена; фокус сразу на "Отмена", чтобы
 * случайный Enter ничего не удалил.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  text?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title" className="dialog-title">
          {title}
        </h3>
        {text && <div className="dialog-text">{text}</div>}
        <div className="dialog-actions">
          <button ref={cancel} className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button className={danger ? "btn btn-danger" : "btn btn-accent"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
