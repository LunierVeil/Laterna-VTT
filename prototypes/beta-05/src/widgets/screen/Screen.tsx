import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { BookOpen, Dice5, Flag, Layers3, Pin, ScrollText, Swords, Users, X } from 'lucide-react';
import type { Actor, Combat, Material, Point, Scene } from '../../entities/model';
import type { Roll } from '../../features/roster';
import { Button, Empty, Glyph, IconButton } from '../../shared/ui';

export function Screen({ scenes, activeScene, actors, materials, battle, onClose, onScene, onRoster, onSheet, onMaterial, onNewMaterial, onRoll, onBattle, position, onPosition, size, onSize }: {
  scenes: Scene[]; activeScene: string; actors: Actor[]; materials: Material[]; battle?: Combat;
  size?: Point; onSize: (size: Point) => void;
  position?: Point; onPosition: (position?: Point) => void;
  onClose: () => void; onScene: (id: string) => void; onRoster: () => void; onSheet: (id: string) => void;
  onMaterial: (id: string) => void; onNewMaterial: () => void; onRoll: Roll; onBattle: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; edge?: string; left: number; top: number; width: number; height: number }>();
  function startDrag(event: PointerEvent<HTMLElement>, edge?: string) {
    const rect = panel.current?.getBoundingClientRect();
    const board = panel.current?.parentElement?.getBoundingClientRect();
    if (event.button !== 0 || !rect || !board ||
      (!edge && event.target instanceof Element && event.target.closest('button'))) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, edge,
      left: rect.left - board.left, top: rect.top - board.top, width: rect.width, height: rect.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const board = panel.current?.parentElement?.getBoundingClientRect();
    const grab = drag.current;
    if (!board || grab?.pointer !== event.pointerId) return;
    const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
    const {edge, left, top, width, height} = grab;
    if (!edge) { onPosition({x:left+dx,y:top+dy}); return; }
    const clamp = (value: number, min: number, max: number) => Math.max(Math.min(min,max),Math.min(max,value));
    const w = edge.includes('w') ? clamp(width-dx, 290, left+width-8)
      : edge.includes('e') ? clamp(width+dx,290,board.width-left-8) : width;
    const h = edge.includes('n') ? clamp(height-dy,160,top+height-8)
      : edge.includes('s') ? clamp(height+dy,160,board.height-top-8) : height;
    onPosition({x:edge.includes('w')?left+width-w:left,y:edge.includes('n')?top+height-h:top});
    onSize({x:w,y:h});
  }
  function stopDrag() { drag.current = undefined; }
  const [lastRoll, setLastRoll] = useState<number>();
  const pinned = materials.filter(m => m.pinned);
  const notes = materials.filter(m => m.kind === 'note' && !m.pinned);
  const style = {
    ...(size && { '--screen-width': `min(${size.x}px, calc(100% - 16px))`, '--screen-height': `min(${size.y}px, calc(100% - 16px))` }),
    ...(position && { left: `clamp(8px, ${position.x}px, calc(100% - var(--screen-width) - 8px))`,
      top: `clamp(8px, ${position.y}px, calc(100% - var(--screen-height) - 8px))`, bottom: 'auto' }),
  } as CSSProperties;
  return <aside ref={panel} className="gm-screen glass" aria-label="Ширма мастера" style={style}>
    <header className="screen-dragbar" onPointerDown={event => startDrag(event)} onPointerMove={moveDrag}
      onLostPointerCapture={stopDrag} onDoubleClick={event => {
        if (event.target instanceof Element && !event.target.closest('button')) onPosition();
      }}>
      <div><h2>Ширма мастера</h2><span className="prototype-status">PROPOSED</span></div>
      <IconButton label="Закрыть ширму" onClick={onClose}><X size={20}/></IconButton>
    </header>
    <div className="screen-content">
      <section><h3><Swords size={16}/> Бой и кубики</h3><div className="inline-form"><Button className="primary" onClick={onBattle}><Flag size={14}/>{battle ? 'Следующий ход' : 'Начать бой'}</Button><Button onClick={() => setLastRoll(onRoll(20, 'normal', true))}><Dice5 size={15}/>Скрытый d20</Button>{lastRoll !== undefined && <output className="badge">d20 · {lastRoll}</output>}</div>{battle && <p>Раунд {battle.round} · {actors.find(a => a.id === battle.order[battle.turn])?.name}</p>}</section>
      <section><h3><Pin size={16}/> Избранные материалы</h3>{pinned.length ? pinned.map(m => <Button className="screen-row" key={m.id} onClick={() => onMaterial(m.id)}><BookOpen size={15}/>{m.name}</Button>) : <Empty>Закрепите материал в журнале.</Empty>}</section>
      <section><h3><ScrollText size={16}/> Заметки и раздатки</h3>{[...notes, ...materials.filter(m => m.kind === 'letter' && !m.pinned)].slice(0, 6).map(m => <Button className="screen-row" key={m.id} onClick={() => onMaterial(m.id)}><ScrollText size={15}/>{m.name}</Button>)}<Button onClick={onNewMaterial}>Открыть журнал</Button></section>
      <section><h3><Layers3 size={16}/> Сцены</h3>{scenes.map(s => <Button className="screen-row" aria-pressed={s.id === activeScene} key={s.id} onClick={() => onScene(s.id)}><Layers3 size={15}/>{s.name}</Button>)}</section>
      <section><h3><Users size={16}/> NPC и существа</h3>{actors.filter(a => a.kind !== 'hero').slice(0, 5).map(a => <Button className="screen-row" key={a.id} onDoubleClick={() => onSheet(a.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onSheet(a.id); }}><Glyph name={a.symbol} size={15}/><span>{a.name}</span><small>{a.hp} HP · КД {a.ac}</small></Button>)}<Button onClick={onRoster}>Книги NPC и чудовищ</Button></section>
    </div>
    {['n','e','s','w','ne','nw','se','sw'].map(edge => <span key={edge} className={`floating-edge edge-${edge} ${edge === 'se' ? 'screen-resize' : ''}`}
      aria-hidden="true" title="Потяните, чтобы изменить размер ширмы" onPointerDown={event => startDrag(event,edge)}
      onPointerMove={moveDrag} onLostPointerCapture={stopDrag}/>)}
  </aside>;
}
