import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react';
import { Compass, DoorClosed, DoorOpen, PanelsTopLeft, Focus, Hand, Minus, Plus } from 'lucide-react';
import { controlsActor, objectKinds, uid, type Actor, type MapObject, type Placement, type Point, type Role, type Scene, type Tool, type WallMode } from '../../entities/model';
import { MapArt } from '../../shared/map-art';
import { Glyph, IconButton } from '../../shared/ui';

interface Props {
  actors: Actor[]; heroId: string; activeActorId?: string;
  scene: Scene; role: Role; editing: boolean; tool: Tool; wallMode: WallMode; selected: string | null;
  placement: Placement | null; onSelect: (id: string | null) => void;
  onChange: (objects: MapObject[]) => void; onPlaced: () => void;
  onOpenToken: (object: MapObject) => void;
  group: string[]; onGroup: (ids: string[]) => void;
  onUseDoor: (object: MapObject) => void;
  onContext: (object: MapObject, x: number, y: number) => void;
  children: ReactNode; toolbar: ReactNode;
}
const bounds = { width: 1100, height: 760 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lineColors = { wall: '#eb9a6c', door: '#f0ca7c', window: '#89c6e2' };
const closeEnough = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 5;

export function Board({ actors, heroId, activeActorId, scene, role, editing, tool, wallMode, selected, placement, onSelect, onChange, onPlaced, onOpenToken, group, onGroup, onUseDoor, onContext, children, toolbar }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const world = useRef<SVGGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [control, setControl] = useState<Point | null>(null);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point; additive: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; start: Point; current: Point; members?: MapObject[]; endpoint?: 'start' | 'end' } | null>(null);
  const pan = useRef<{ x: number; y: number; origin: Point } | null>(null);
  const [panning, setPanning] = useState(false);
  useEffect(() => { setAnchor(null); setControl(null); setCursor(null); }, [tool, wallMode, editing, role, scene.id]);
  const visible = scene.objects.filter(o => role === 'gm' || !o.secret);
  const observer = visible.find(o => o.actorId === heroId);
  const view = observer && drag?.id === observer.id && !drag.members ? drag.current : observer ?? { x: 470, y: 590 };
  const lit = visible.filter(o => o.kind === 'light' && o.lightEnabled !== false);
  const controlled = (id?: string) => controlsActor(actors.find(actor => actor.id === id), heroId);
  function inSight(o: MapObject) {
    if (role === 'gm' || !scene.vision || o.kind !== 'token' && o.kind !== 'prop' || controlled(o.actorId)) return true;
    const nearObserver = Math.hypot(o.x - view.x, o.y - view.y) <= 151;
    const nearLight = lit.some(light => Math.hypot(o.x - light.x, o.y - light.y) <= (light.radius ?? 120) * .6);
    return nearObserver || nearLight;
  }

  function coordinates(event: { clientX: number; clientY: number }) {
    const transform = world.current?.getScreenCTM();
    if (!transform) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    return { x: Math.round(clamp(p.x, 0, bounds.width)), y: Math.round(clamp(p.y, 0, bounds.height)) };
  }

  function add(kind: MapObject['kind'], at: Point, fields: Partial<MapObject> = {}) {
    const object: MapObject = { ...at, id: uid(), kind, name: objectKinds[kind], ...fields };
    onChange([...scene.objects, object]);
    onSelect(object.id);
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button === 1 || (event.button === 0 && tool === 'pan' && !placement)) {
      event.preventDefault();
      pan.current = { x: event.clientX, y: event.clientY, origin: offset };
      setPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const at = coordinates(event);
    if (placement && (role === 'gm' || controlled(placement.actorId))) {
      const { kind, ...fields } = placement;
      add(kind, at, fields);
      onPlaced();
    } else if (tool === 'measure') {
      setCursor(at);
      setAnchor(anchor ? null : at);
    } else if (editing && role === 'gm' && tool !== 'select' && tool !== 'pan') {
      if (tool === 'light') {
        add('light', at, { radius: 120, color: '#f0b14a' });
      } else if (!anchor) {
        setAnchor(at);
      } else if (!closeEnough(anchor, at)) {
        if (tool === 'wall') {
          if (wallMode === 'curve' && !control) { setControl(at); return; }
          if (wallMode === 'rectangle' || wallMode === 'circle' || wallMode === 'ellipse') {
            const width = at.x - anchor.x, height = at.y - anchor.y;
            if (Math.abs(width) < 5 || Math.abs(height) < 5) return;
            const points = wallMode === 'rectangle'
              ? [anchor, { x: at.x, y: anchor.y }, at, { x: anchor.x, y: at.y }]
              : Array.from({ length: 16 }, (_, index) => {
                const angle = index * Math.PI / 8;
                const rx = wallMode === 'circle' ? Math.min(Math.abs(width), Math.abs(height)) / 2 : width / 2;
                const ry = wallMode === 'circle' ? rx : height / 2;
                return { x: anchor.x + width / 2 + Math.cos(angle) * rx, y: anchor.y + height / 2 + Math.sin(angle) * ry };
              });
            onChange([...scene.objects, ...points.map((point, index): MapObject => ({
              ...point, id: uid(), kind: 'wall', name: objectKinds.wall, end: points[(index + 1) % points.length],
            }))]);
            setAnchor(null);
          } else {
            add('wall', anchor, { end: at, control: control ?? undefined });
            setAnchor(at); setControl(null);
          }
        } else {
          add(tool, anchor, { end: at });
          setAnchor(null);
        }
      }
    } else {
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      onSelect(null);
      if (!additive) onGroup([]);
      setMarquee({ start: at, end: at, additive });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (pan.current) {
      const scale = svg.current?.getScreenCTM()?.a ?? 1;
      setOffset({ x: pan.current.origin.x + (event.clientX - pan.current.x) / scale, y: pan.current.origin.y + (event.clientY - pan.current.y) / scale });
    } else if (drag) {
      setDrag({ ...drag, current: coordinates(event) });
    } else if (marquee) {
      setMarquee({ ...marquee, end: coordinates(event) });
    } else if (anchor) {
      setCursor(coordinates(event));
    }
  }

  function groupOffset(members: MapObject[], start: Point, end: Point) {
    return {
      x: clamp(end.x - start.x, -Math.min(...members.map(item => item.x)), bounds.width - Math.max(...members.map(item => item.x))),
      y: clamp(end.y - start.y, -Math.min(...members.map(item => item.y)), bounds.height - Math.max(...members.map(item => item.y))),
    };
  }
  const groupDelta = drag?.members ? groupOffset(drag.members, drag.start, drag.current) : undefined;

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (marquee) {
      const { start, additive } = marquee;
      const end = coordinates(event);
      if (!closeEnough(start, end)) {
        const ids = visible.filter(item => item.kind === 'token' && (role === 'gm' || controlled(item.actorId)) && inSight(item) &&
          item.x >= Math.min(start.x, end.x) && item.x <= Math.max(start.x, end.x) &&
          item.y >= Math.min(start.y, end.y) && item.y <= Math.max(start.y, end.y)).map(item => item.id);
        onGroup(additive ? [...new Set([...group, ...ids])] : ids);
      }
      setMarquee(null);
    }
    if (drag) {
      const at = coordinates(event);
      const object = scene.objects.find(item => item.id === drag.id);
      const opposite = drag.endpoint === 'start' ? object?.end : drag.endpoint === 'end' ? object : undefined;
      if (drag.members && !closeEnough(drag.start, at)) {
        const delta = groupOffset(drag.members, drag.start, at);
        const memberIds = new Set(drag.members.map(member => member.id));
        onChange(scene.objects.map(item => memberIds.has(item.id) ? { ...item, x: item.x + delta.x, y: item.y + delta.y } : item));
      } else if (!drag.members && object && !closeEnough(drag.start, at) && (!opposite || !closeEnough(opposite, at))) {
        const next = drag.endpoint === 'end' ? { ...object, end: at } : { ...object, ...at };
        onChange(scene.objects.map(item => item.id === object.id ? next : item));
      }
      setDrag(null);
    }
    pan.current = null;
    setPanning(false);
  }

  function objectDown(event: PointerEvent<SVGGElement>, object: MapObject) {
    if (event.button !== 0 || placement || tool !== 'select') return;
    event.stopPropagation();
    if (role === 'player' && object.kind === 'door') { onUseDoor(object); return; }
    const selectable = object.kind === 'token' && (role === 'gm' || controlled(object.actorId));
    if (selectable && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      onSelect(null);
      onGroup(group.includes(object.id) ? group.filter(id => id !== object.id) : [...group, ...(selected && !group.includes(selected) && visible.some(item => item.id === selected && item.kind === 'token' && (role === 'gm' || controlled(item.actorId))) ? [selected] : []), object.id]);
      return;
    }
    const member = selectable && group.includes(object.id);
    if (!member) { onGroup([]); onSelect(object.id); }
    const movable = (role === 'gm' && (object.kind === 'token' || object.kind === 'prop' || editing && object.kind === 'light'))
      || role === 'player' && controlled(object.actorId);
    if (movable) {
      setDrag({ id: object.id, start: coordinates(event), current: member ? coordinates(event) : object, members: member ? visible.filter(item => group.includes(item.id) && item.kind === 'token' && (role === 'gm' || controlled(item.actorId))) : undefined });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function endpointDown(event: PointerEvent<SVGCircleElement>, object: MapObject, endpoint: 'start' | 'end') {
    if (event.button !== 0 || !object.end || tool !== 'select' || !editing || role !== 'gm') return;
    event.stopPropagation();
    const point = endpoint === 'start' ? object : object.end;
    setDrag({ id: object.id, endpoint, start: coordinates(event), current: point });
    svg.current?.setPointerCapture(event.pointerId);
  }

  function wheel(event: WheelEvent<SVGSVGElement>) {
    setZoom(value => clamp(Math.round((value + (event.deltaY < 0 ? .1 : -.1)) * 10) / 10, .5, 2));
  }

  return <div className={`board ${panning ? 'panning' : tool === 'pan' ? 'pan' : placement || tool !== 'select' ? 'crosshair' : ''}`}>
    <svg ref={svg} className="board-svg" viewBox="0 0 1100 760" preserveAspectRatio="xMidYMid slice"
      aria-label="Игровая карта" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={() => { setDrag(null); setMarquee(null); pan.current = null; setPanning(false); }}
      onContextMenu={e => { e.preventDefault(); setAnchor(null); setControl(null); }} onWheel={wheel}>
      <defs>
        <pattern id="board-grid" width={scene.grid} height={scene.grid} x={scene.background?.x} y={scene.background?.y} patternUnits="userSpaceOnUse"><path d={`M${scene.grid} 0H0V${scene.grid}`} fill="none" stroke="#d2dece" strokeOpacity=".23" strokeWidth="1"/></pattern>
        <radialGradient id="fog-falloff"><stop offset=".56" stopColor="black"/><stop offset="1" stopColor="white"/></radialGradient>
        <mask id="fog-mask"><rect width="1100" height="760" fill="white"/>
          {scene.explored && <ellipse cx="480" cy="575" rx="191" ry="145" fill="#919191"/>}
          <circle cx={view.x} cy={view.y} r="155" fill="url(#fog-falloff)"/>
          {lit.map(o => <circle key={o.id} cx={o.x} cy={o.y} r={(o.radius ?? 120) * .63} fill="url(#fog-falloff)"/>)}
        </mask>
        {lit.map(o => <radialGradient key={o.id} id={`light-${o.id}`}><stop stopColor={o.color} stopOpacity={(o.intensity ?? 100) * .0058}/><stop offset=".34" stopColor={o.color} stopOpacity={(o.intensity ?? 100) * .0028}/><stop offset="1" stopColor={o.color} stopOpacity="0"/></radialGradient>)}
      </defs>
      <g ref={world} transform={`translate(${550 + offset.x} ${380 + offset.y}) scale(${zoom}) translate(-550 -380)`}>
        {scene.background ? <image href={scene.background.image} x={scene.background.x} y={scene.background.y}
          width={scene.background.width} height={scene.background.height} preserveAspectRatio="none"/> : <MapArt art={scene.art}/>}
        <rect width="1100" height="760" fill="#090d1c" opacity={(100 - scene.ambient) / 155}/>
        {scene.showGrid && <rect width="1100" height="760" fill="url(#board-grid)"/>}
        {lit.map(o => <circle className={o.flicker ? 'light-flicker' : undefined} key={o.id} cx={drag?.id === o.id ? drag.current.x : o.x} cy={drag?.id === o.id ? drag.current.y : o.y} r={o.radius ?? 120} fill={`url(#light-${o.id})`} style={{ mixBlendMode: 'screen', opacity: (o.opacity ?? 100) / 100, animationDuration: `${4.3 - (o.flickerSpeed ?? 55) * .037}s`, '--flicker-low': 1 - (o.flickerStrength ?? 25) / 150 } as React.CSSProperties}/>)}
        {role === 'player' && scene.vision && <rect width="1100" height="760" fill="#080e18" opacity=".91" mask="url(#fog-mask)"/>}
        {visible.filter(inSight).map(o => {
          const dragged = drag?.id === o.id && !drag.members ? drag : null;
          const p = dragged && dragged.endpoint !== 'end' ? dragged.current : o;
          const end = dragged?.endpoint === 'end' ? dragged.current : o.end;
          const active = selected === o.id || group.includes(o.id);
          const line = o.kind === 'wall' || o.kind === 'door' || o.kind === 'window';
          if (o.kind === 'light' && !editing || role === 'player' && line && o.kind !== 'door') return null;
          if (line && !editing && o.kind !== 'door') return null;
          const segmentPath = end && o.control ? `M 0 0 Q ${o.control.x - p.x} ${o.control.y - p.y} ${end.x - p.x} ${end.y - p.y}` : undefined;
          const GeometryIcon = o.kind === 'window' ? PanelsTopLeft : o.open ? DoorOpen : DoorClosed;
          const geometry = line && end ? <g>
            {role === 'gm' && (segmentPath ? <path d={segmentPath} fill="none" stroke="transparent" strokeWidth="18"/>
              : <line x2={end.x - p.x} y2={end.y - p.y} stroke="transparent" strokeWidth="18"/>)}
            {role === 'gm' && (segmentPath ? <path d={segmentPath} fill="none" stroke={lineColors.wall} strokeWidth={active ? 4 : 2.5}/>
              : <line x2={end.x - p.x} y2={end.y - p.y} stroke={lineColors[o.kind as keyof typeof lineColors]} strokeWidth={active ? 4 : 2.5} strokeDasharray={o.open || o.kind === 'window' ? '7 4' : undefined} opacity={editing ? .74 : .55}/>)}
            {(o.kind === 'door' || o.kind === 'window') && (role === 'player' || o.showGeometryIcon !== false) && <g transform={`translate(${(end.x - p.x) / 2}, ${(end.y - p.y) / 2})`} aria-hidden="true">
              <rect x={-12} y={-12} width={24} height={24} rx={5} fill="#17181e" stroke={lineColors[o.kind]}/>
              <GeometryIcon x={-8} y={-8} width={16} height={16} color={lineColors[o.kind]}/>
            </g>}
            {editing && active && tool === 'select' && (['start', 'end'] as const).map(endpoint =>
              <circle key={endpoint} data-endpoint={endpoint} className="segment-endpoint"
                cx={endpoint === 'start' ? 0 : end.x - p.x} cy={endpoint === 'start' ? 0 : end.y - p.y}
                r="9" fill="#f8d7a1" stroke="#4b301d" strokeWidth="2"
                onPointerDown={event => endpointDown(event, o, endpoint)}/>)}
          </g> : null;
          const fog = o.kind === 'fog' && o.end ? <rect x={Math.min(0, o.end.x - o.x)} y={Math.min(0, o.end.y - o.y)} width={Math.abs(o.end.x - o.x)} height={Math.abs(o.end.y - o.y)}
            fill="#080d16" fillOpacity={role === 'gm' ? .45 : .96} stroke={editing ? '#b6a5db' : 'none'} strokeDasharray="6 4"/> : null;
          const actor = o.kind === 'token' && (role === 'gm' || controlled(o.actorId))
            ? actors.find(item => item.id === o.actorId) : undefined;
          const hp = actor ? Math.min(actor.maxHp, actor.kind === 'hero' ? actor.hp : o.hp ?? actor.maxHp) : 0;
          const ratio = actor ? hp / actor.maxHp : 0;
          return <g key={o.id} data-object={o.name} data-kind={o.kind} role={tool === 'select' && o.kind !== 'fog' ? 'button' : undefined}
            tabIndex={tool === 'select' && o.kind !== 'fog' ? 0 : undefined} aria-label={role === 'player' && o.kind === 'door' ? (o.open ? 'Открытая дверь' : 'Закрытая дверь') : o.name}
            className={`map-object ${o.secret ? 'secret-object' : ''} ${tool !== 'select' || placement ? 'passthrough' : ''}`}
            data-group-selected={group.includes(o.id) || undefined}
            transform={`translate(${p.x + (groupDelta && group.includes(o.id) ? groupDelta.x : 0)} ${p.y + (groupDelta && group.includes(o.id) ? groupDelta.y : 0)})`} onPointerDown={e => objectDown(e, o)}
            onDoubleClick={event => { if (o.kind === 'token' && tool === 'select' && !placement) { event.stopPropagation(); onOpenToken(o); } }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (role === 'player' && o.kind === 'door') onUseDoor(o); else if (e.key === 'Enter' && o.kind === 'token') onOpenToken(o); else onSelect(o.id); } }}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (role === 'player' && o.kind === 'door') return; onSelect(o.id); onContext(o, e.clientX, e.clientY); }}>
            {geometry}{fog}
            {o.kind === 'light' && <>
              {active && <circle r={o.radius ?? 120} fill="none" stroke={o.color} strokeDasharray="5 5"/>}
              <circle r="14" fill="#362b1a" stroke={o.color} strokeWidth={active ? 3 : 1.5}/><g transform="translate(-8 -8)" style={{ color: o.color }}><Glyph name="flame" size={16}/></g>
            </>}
            {(o.kind === 'token' || o.kind === 'prop') && <g transform={o.kind === 'token' ? `scale(${({ small: .7, medium: 1, large: 2, giant: 3 })[o.size ?? 'medium']})` : undefined}>
              {activeActorId && o.actorId === activeActorId && <circle r="29" stroke="#efb550" strokeWidth="2" fill="none"/>}
              <circle cy="3" r="24" fill="#0b0c10" opacity=".65"/>
              {group.includes(o.id) && <circle r="27" fill="none" stroke="#f0b14a" strokeWidth="2" strokeDasharray="4 3" pointerEvents="none"/>}
              <circle r="22" fill="#232a2d" stroke={o.color} strokeWidth={active ? 3.6 : 2} strokeDasharray={o.secret ? '4 3' : undefined}/>
              <circle r="17" fill={o.color} opacity=".15"/>
              {o.image ? <image href={o.image} x={-17} y={-17} width={34} height={34}/>
                : <g transform="translate(-10 -10)" style={{ color: o.color }}><Glyph name={o.symbol ?? 'user'} size={20}/></g>}
              {actor && <g pointerEvents="none" aria-label={`Хиты ${hp} из ${actor.maxHp}, КД ${actor.ac}`}>
                <rect x="-23" y="16" width="46" height="13" rx="4" fill="#111216"/>
                {ratio > 0 && <rect x="-23" y="16" width={46 * ratio} height="13" rx="4" fill={ratio > .5 ? '#3c793e' : ratio > .25 ? '#886627' : '#983c37'}/>}
                <text x="0" y="26" textAnchor="middle" fontSize="9" fill="#fff">{hp}/{actor.maxHp}</text>
                <path d="M10 1H27V10L18.5 17L10 10Z" fill="#1f2129" stroke="#9fc3ff"/>
                <text x="18.5" y="11" textAnchor="middle" fontSize="9" fill="#fff">{actor.ac}</text>
              </g>}
              <text className="map-label" y={actor ? 43 : 37} textAnchor="middle">{o.name.split(' ').slice(0, 2).join(' ')}</text>
            </g>}
          </g>;
        })}
        {marquee && <rect data-selection-marquee pointerEvents="none" x={Math.min(marquee.start.x, marquee.end.x)} y={Math.min(marquee.start.y, marquee.end.y)}
          width={Math.abs(marquee.end.x - marquee.start.x)} height={Math.abs(marquee.end.y - marquee.start.y)}
          fill="#f0b14a22" stroke="#f0b14a" strokeWidth="1" strokeDasharray="5 4"/>}
        {anchor && cursor && <g className="passthrough">
          {tool === 'fog'
            ? <rect x={Math.min(anchor.x,cursor.x)} y={Math.min(anchor.y,cursor.y)} width={Math.abs(cursor.x-anchor.x)} height={Math.abs(cursor.y-anchor.y)} fill="#111522" fillOpacity=".6" stroke="#c3b0ed" strokeDasharray="6 4"/>
            : tool === 'wall' && control ? <path d={`M ${anchor.x} ${anchor.y} Q ${control.x} ${control.y} ${cursor.x} ${cursor.y}`} fill="none" stroke="#f0cf8c" strokeWidth="3" strokeDasharray="6 4"/>
            : tool === 'wall' && wallMode === 'rectangle' ? <rect x={Math.min(anchor.x,cursor.x)} y={Math.min(anchor.y,cursor.y)} width={Math.abs(anchor.x-cursor.x)} height={Math.abs(anchor.y-cursor.y)} fill="none" stroke="#f0cf8c" strokeDasharray="6 4"/>
            : tool === 'wall' && (wallMode === 'circle' || wallMode === 'ellipse') ? <ellipse cx={(anchor.x+cursor.x)/2} cy={(anchor.y+cursor.y)/2}
              rx={(wallMode === 'circle' ? Math.min(Math.abs(anchor.x-cursor.x),Math.abs(anchor.y-cursor.y)) : Math.abs(anchor.x-cursor.x))/2}
              ry={(wallMode === 'circle' ? Math.min(Math.abs(anchor.x-cursor.x),Math.abs(anchor.y-cursor.y)) : Math.abs(anchor.y-cursor.y))/2}
              fill="none" stroke="#f0cf8c" strokeDasharray="6 4"/>
            : <line x1={anchor.x} y1={anchor.y} x2={cursor.x} y2={cursor.y} stroke="#f0cf8c" strokeWidth={tool === 'measure' ? 1.5 : 3} opacity={tool === 'measure' ? .72 : 1} strokeDasharray="6 4"/>}
          <circle cx={anchor.x} cy={anchor.y} r="4" fill="#f0cf8c"/>
          {tool === 'measure' && <text className="map-label" x={(anchor.x+cursor.x)/2} y={(anchor.y+cursor.y)/2 - 10} textAnchor="middle">{(Math.hypot(cursor.x-anchor.x,cursor.y-anchor.y)/scene.grid*5).toFixed(1)} фт.</text>}
        </g>}
      </g>
    </svg>
    {children}
    <div className="board-footer">
    <div className="board-compass"><Compass size={30} strokeWidth={1}/><span>С</span></div>
    {toolbar}
    <div className="camera">
      <IconButton label="Уменьшить масштаб" onClick={() => setZoom(z => clamp(z - .1, .5, 2))}><Minus size={16}/></IconButton>
      <output>{Math.round(zoom * 100)}%</output>
      <IconButton label="Увеличить масштаб" onClick={() => setZoom(z => clamp(z + .1, .5, 2))}><Plus size={16}/></IconButton>
      <i/>
      <IconButton label="Сбросить камеру" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Focus size={16}/></IconButton>
      {tool === 'pan' && <Hand size={16}/>}
    </div>
    </div>
  </div>;
}
