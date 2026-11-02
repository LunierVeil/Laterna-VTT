import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./TextField.css";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "children"> & {
  label?: ReactNode;
  error?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, id, className, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }, ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return <div className="ds-text-field">
    {label != null && <label className="ds-field-label" htmlFor={inputId}>{label}</label>}
    <input {...props} ref={ref} id={inputId}
      className={["ds-text-input", className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : invalid}
      aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined} />
    {error && <span className="ds-field-error" id={errorId} role="alert">{error}</span>}
  </div>;
});
