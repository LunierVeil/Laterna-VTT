import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from "react";
import "./Select.css";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label?: ReactNode; options: readonly { value: string; label: string; disabled?: boolean }[];
  error?: ReactNode; loading?: boolean; placeholder?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, loading = false, placeholder, disabled, id, className, "aria-describedby": describedBy, "aria-invalid": invalid, ...props }, ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return <div className="ds-select-field">
    {label != null && <label htmlFor={inputId}>{label}</label>}
    <select {...props} ref={ref} id={inputId} disabled={disabled || loading} aria-busy={loading || undefined}
      className={["ds-select", className].filter(Boolean).join(" ")} aria-invalid={error ? true : invalid}
      aria-describedby={[describedBy, error ? `${inputId}-error` : undefined, loading ? `${inputId}-loading` : undefined].filter(Boolean).join(" ") || undefined}>
      {placeholder != null && <option value="" disabled>{placeholder}</option>}
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    {loading && <span role="status" id={`${inputId}-loading`}>Загрузка…</span>}
    {error && <span className="ds-select-error" role="alert" id={`${inputId}-error`}>{error}</span>}
  </div>;
});
