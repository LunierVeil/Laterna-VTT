import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./Tooltip.css";

export type TooltipProps = {
  content: ReactNode; placement?: "top" | "bottom" | "left" | "right"; delay?: number;
  children: ReactElement<{ "aria-describedby"?: string }>;
};

/** The single child must be focusable and forward aria-* props. */
export function Tooltip({ content, placement = "top", delay = 400, children }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const hovered = useRef(false), focused = useRef(false), dismissed = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false, side: placement });
  function clear() { clearTimeout(timer.current); }
  function closeIfIdle() { clear(); if (!hovered.current && !focused.current) { setOpen(false); dismissed.current = false; } }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (hovered.current || focused.current)) {
        clear();
        // A portal under the pointer disappears without firing mouseleave.
        // Only actual anchor hover may keep dismissal active after it closes.
        hovered.current = anchor.current?.matches(":hover") ?? false;
        dismissed.current = true;
        setOpen(false);
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  useEffect(() => {
    if (!open) return;
    function update() {
      const a = anchor.current?.getBoundingClientRect(), t = tooltip.current?.getBoundingClientRect();
      if (!a || !t) return;
      const gap = parseFloat(getComputedStyle(anchor.current!).getPropertyValue("--panel-gap")) || 8;
      const margin = gap;
      const available = { top: a.top, bottom: innerHeight - a.bottom, left: a.left, right: innerWidth - a.right };
      const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
      let side = placement;
      const needed = (side === "top" || side === "bottom" ? t.height : t.width) + gap + margin;
      if (available[side] < needed && available[opposite[side]] > available[side]) side = opposite[side];
      let left = a.left + (a.width - t.width) / 2, top = a.top + (a.height - t.height) / 2;
      if (side === "top") top = a.top - t.height - gap;
      if (side === "bottom") top = a.bottom + gap;
      if (side === "left") left = a.left - t.width - gap;
      if (side === "right") left = a.right + gap;
      left = Math.max(margin, Math.min(left, innerWidth - t.width - margin));
      top = Math.max(margin, Math.min(top, innerHeight - t.height - margin));
      setPosition({ left, top, ready: true, side });
    }
    update();
    const observer = new ResizeObserver(update);
    if (tooltip.current) observer.observe(tooltip.current);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, placement, content]);
  const describedBy = [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined;
  return <span ref={anchor} className="ds-tooltip-anchor" onMouseEnter={() => {
    hovered.current = true; clear();
    if (!dismissed.current) timer.current = setTimeout(() => setOpen(true), Math.max(0, delay));
  }} onMouseLeave={event => {
    hovered.current = event.relatedTarget instanceof Node && (tooltip.current?.contains(event.relatedTarget) ?? false); closeIfIdle();
  }} onFocusCapture={() => { focused.current = true; clear(); if (!dismissed.current) setOpen(true); }}
    onBlurCapture={() => { focused.current = false; closeIfIdle(); }}>
    {cloneElement(children, { "aria-describedby": describedBy })}
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className="ds-tooltip" data-placement={position.side}
      style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
      onMouseEnter={() => { hovered.current = true; }} onMouseLeave={() => { hovered.current = false; closeIfIdle(); }}>{content}</div>, anchor.current?.closest("dialog") ?? document.body)}
  </span>;
}
