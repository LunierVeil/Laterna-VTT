import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./Button.css";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", type = "button", className, ...props }, ref,
) {
  return <button {...props} ref={ref} type={type}
    className={["ds-button", `ds-button--${variant}`, className].filter(Boolean).join(" ")} />;
});
