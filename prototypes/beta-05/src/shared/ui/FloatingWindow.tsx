import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Expand, Minimize2, Minus, Plus, X } from 'lucide-react';
import { IconButton } from './index';

type Bounds = { x: number; y: number; w: number; h: number };
const layouts = new Map<string, Bounds>();
let layer = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

function fit(bounds: Bounds): Bounds {
  const w = clamp(bounds.w, 260, window.innerWidth - 16);
  const h = clamp(bounds.h, 145, window.innerHeight - 16);
  return { w, h, x: clamp(bounds.x, 8, window.innerWidth - w - 8), y: clamp(bounds.y, 8, window.innerHeight - h - 8) };
}

export function FloatingWindow({ id, label, title, onClose, className, children }: {
  id: string; label: string; title?: string; onClose?: () => void; className: string; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ origin: Bounds; x: number; y: number; edge: string }>();
  const [bounds, setBounds] = useState(() => layouts.get(id));
  const [folded, setFolded] = useState(false);
  const [z, setZ] = useState(8);
  useEffect(() => {
    const resize = () => setBounds(value => value && fit(value));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const measure = () => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  };
  function save(next: Bounds) { const value = fit(next); layouts.set(id, value); setBounds(value); }
  function begin(event: PointerEvent<HTMLElement>) {
    setZ(++layer);
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const edge = event.target.closest<HTMLElement>('[data-resize]')?.dataset.resize;
    const header = event.target.closest('.floating-title, .dialog-head, .character-heading');
    if (!edge && (!header || event.target.closest('button,input,select,textarea,a'))) return;
    event.preventDefault();
    drag.current = { origin: bounds ?? measure(), x: event.clientX, y: event.clientY, edge: edge ?? 'move' };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    if (!drag.current) return;
    const { origin, x, y, edge } = drag.current;
    const dx = event.clientX - x, dy = event.clientY - y;
    if (edge === 'move') { save({ ...origin, x: origin.x + dx, y: origin.y + dy }); return; }
    const w = edge.includes('w') ? clamp(origin.w - dx, 260, origin.x + origin.w - 8)
      : edge.includes('e') ? clamp(origin.w + dx, 260, window.innerWidth - origin.x - 8) : origin.w;
    const h = edge.includes('n') ? clamp(origin.h - dy, 145, origin.y + origin.h - 8)
      : edge.includes('s') ? clamp(origin.h + dy, 145, window.innerHeight - origin.y - 8) : origin.h;
    save({ w, h, x: edge.includes('w') ? origin.x + origin.w - w : origin.x,
      y: edge.includes('n') ? origin.y + origin.h - h : origin.y });
  }
  return <section ref={ref} aria-label={label} className={`floating-window ${className}`} data-folded={folded}
    onPointerDown={begin} onPointerMove={move} onLostPointerCapture={() => { drag.current = undefined; }}
    style={bounds ? { zIndex: z, left: bounds.x, top: bounds.y, width: bounds.w, height: folded ? undefined : bounds.h, maxHeight: 'none' } : { zIndex: z }}>
    <div className="floating-title">
      <strong>{title ?? label}</strong>
      {[[380, 490], [630, 640], [950, 740]].map(([w, h], index) =>
        <IconButton key={w} label={['Узкое окно', 'Среднее окно', 'Широкое окно'][index]} onClick={() => { save({ ...measure(), w, h }); setFolded(false); }}>
          {index === 0 ? <Minimize2 size={15}/> : index === 1 ? <span>↔</span> : <Expand size={15}/>}
        </IconButton>)}
      <IconButton label={folded ? 'Восстановить окно' : 'Свернуть окно'} onClick={() => {
        if (!folded && !bounds) save(measure());
        setFolded(value => !value);
      }}>{folded ? <Plus size={15}/> : <Minus size={15}/>}</IconButton>
      {onClose && <IconButton label="Закрыть окно" onClick={onClose}><X size={16}/></IconButton>}
    </div>
    <div className="floating-content" hidden={folded}>{children}</div>
    {!folded && ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map(edge =>
      <div aria-hidden="true" className={`floating-edge edge-${edge}`} data-resize={edge} key={edge}/>)}
  </section>;
}
