import lanternMicro from '../assets/laterna-micro.svg?inline';
import lanternEmblem from '../assets/laterna-emblem.svg?inline';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, Axe, Bird, BookOpen, Boxes, Castle, Crosshair, Flame, Lamp, Map, PawPrint, Shield, Skull, Sparkles, Swords, UserRound, WandSparkles, X } from 'lucide-react';

export function Glyph({ name, size = 19 }: { name: string; size?: number }) {
  const Icon = ({ bow: Crosshair, shield: Shield, wand: WandSparkles, skull: Skull, lantern: Lamp, chest: Boxes, map: Map, statue: Castle, paw: PawPrint, bird: Bird, user: UserRound, swords: Swords, flame: Flame, axe: Axe, book: BookOpen } as const)[name as 'bow'] ?? Sparkles;
  return <Icon size={size} strokeWidth={1.65} aria-hidden />;
}

export function Lantern({ size = 36, full = false }: { size?: number; full?: boolean }) {
  return <img src={full ? lanternEmblem : lanternMicro} alt="" className="laterna-emblem" style={{ height: size }}/>;
}

export function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`button ${className}`}>{children}</button>;
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Button {...props} className={`icon-button ${props.className ?? ''}`} aria-label={label} title={label}>{children}</Button>;
}

export function Dialog({ title, eyebrow, onClose, children, wide = false }: {
  title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const node = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = node.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={node} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-frame">
      <header className="dialog-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div><IconButton label="Закрыть окно" onClick={onClose}><X size={20}/></IconButton></header>
      <div className="dialog-body">{children}</div>
    </div>
  </dialog>;
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function Back({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <Button className="ghost" onClick={onClick}><ArrowLeft size={15}/>{children}</Button>;
}
export function Section({ label, children }: { label: string; children: ReactNode }) {
  return <section className="section"><h3>{label}</h3>{children}</section>;
}
