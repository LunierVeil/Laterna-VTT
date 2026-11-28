import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './index';

export function AnchoredPopover({ label, trigger, children, onOpen, className = 'primary full' }: {
  label: string; onOpen?: () => void; className?: string; trigger: ReactNode; children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement | null>(null);
  function close() { setOpen(false); anchor.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    root.current?.querySelector<HTMLButtonElement>('.anchored-popover button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return <div ref={root} className="popover-anchor">
    <span ref={node => { anchor.current = node?.querySelector('button') ?? null; }}>
      <Button className={className} aria-expanded={open} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>{trigger}</Button>
    </span>
    {open && <div className="anchored-popover glass" role="group" aria-label={label}>{children(close)}</div>}
  </div>;
}
