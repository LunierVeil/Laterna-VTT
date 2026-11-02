import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import "./Checkbox.css";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & {
  label: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, className, disabled, ...props }, ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <label className="ds-checkbox" htmlFor={inputId} data-disabled={disabled || undefined}>
    <input {...props} type="checkbox" ref={ref} id={inputId} disabled={disabled}
      className={["ds-checkbox-input", className].filter(Boolean).join(" ")} />
    <span>{label}</span>
  </label>;
});
