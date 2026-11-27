import { useState } from 'react';
import type { DecalPattern } from '../../entities/model';
import { Button } from '../../shared/ui';
import { decalNames, DecalMark } from '../../shared/map-art/DecalMark';

export function DecalPatterns({ onPlace }: { onPlace: (name: string, pattern: DecalPattern) => void }) {
  const [pattern, setPattern] = useState<DecalPattern>({ kind: 'tracks', size: 80, rotation: 0, variant: 0 });
  return <details className="decal-patterns character-block">
    <summary>Паттерны декалей</summary>
    <div className="form-grid">
      <label>Паттерн<select value={pattern.kind} onChange={event => setPattern({ ...pattern, kind: event.target.value as DecalPattern['kind'] })}>
        {Object.entries(decalNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Размер <output>{pattern.size}</output><input aria-label="Размер декали" type="range" min={28} max={160} value={pattern.size}
        onChange={event => setPattern({ ...pattern, size: Number(event.target.value) })}/></label>
      <label>Поворот <output>{pattern.rotation}°</output><input aria-label="Поворот декали" type="range" min={0} max={359} value={pattern.rotation}
        onChange={event => setPattern({ ...pattern, rotation: Number(event.target.value) })}/></label>
      <Button onClick={() => setPattern(current => ({ ...current, variant: (current.variant + 1 + Math.floor(Math.random() * 9999)) % 10000 }))}>Случайный вариант</Button>
    </div>
    <svg className="decal-preview" viewBox="-120 -100 240 200" role="img" aria-label="Предпросмотр декали"><DecalMark pattern={pattern}/></svg>
    <small aria-live="polite">{decalNames[pattern.kind]} · вариант {pattern.variant + 1} · {pattern.size} × {pattern.size} · {pattern.rotation}°</small>
    <div className="inline-form"><Button onClick={() => setPattern({ ...pattern, size: 80, rotation: 0, variant: 0 })}>По умолчанию</Button>
      <Button className="primary" onClick={() => onPlace(decalNames[pattern.kind], pattern)}>Разместить декаль</Button></div>
  </details>;
}
