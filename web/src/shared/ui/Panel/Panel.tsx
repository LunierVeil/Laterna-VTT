import { forwardRef, type HTMLAttributes } from "react";
import "./Panel.css";

export type PanelProps = HTMLAttributes<HTMLDivElement>;

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ className, ...props }, ref) {
  return <div {...props} ref={ref} className={["ds-panel", className].filter(Boolean).join(" ")} />;
});
