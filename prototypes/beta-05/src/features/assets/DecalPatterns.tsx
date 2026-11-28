import { useId, useState } from 'react';
import type { DecalPattern } from '../../entities/model';
import { Button } from '../../shared/ui';
import { decalNames, DecalMark } from '../../shared/map-art/DecalMark';

const surfaces = {wood:['Дерево','#665045','#42362d'],stone:['Камень','#626061','#474746'],earth:['Земля','#624d38','#3c3527'],light:['Светлая','#c3b391','#ad9e7d']} as const;
type Surface=keyof typeof surfaces;
function Swatch({pattern,surface}:{pattern:DecalPattern;surface:Surface}) {
  const id=useId();
  const [label,base,line]=surfaces[surface];
  return <svg className="decal-preview" viewBox="-85 -45 170 90" role="img" aria-label={`${decalNames[pattern.kind]} · ${label}`}>
    <defs><pattern id={id} width="55" height="31" patternUnits="userSpaceOnUse">
      <rect width="55" height="31" fill={base}/>
      {surface==='wood'?<path d="M0 .5H55 M0 6Q24 12 55 6 M0 19Q26 15 55 22 M0 29Q30 21 55 28" fill="none" stroke={line} strokeWidth=".9"/>:
        surface==='stone'?<path d="M.4 0V16H55 M0 30H55 M28 16V30" fill="none" stroke={line} strokeWidth="1"/>:
        <path d="M3 8h1m7 13h2m4-14h1m5 11h3m5 8h1m9-12h2m4 9h1m4-18h1" stroke={line} strokeWidth=".75"/>}
    </pattern></defs>
    <rect x="-85" y="-45" width="170" height="90" fill={`url(#${id})`}/>
    <DecalMark pattern={pattern}/>
  </svg>;
}

export function DecalPatterns({ onPlace, initiallyOpen }: { initiallyOpen?: boolean; onPlace:(name:string, pattern:DecalPattern)=>void }) {
  const [pattern,setPattern]=useState<DecalPattern>({kind:'tracks',size:80,rotation:0,variant:0});
  const [surface,setSurface]=useState<Surface>('wood');
  return <details open={initiallyOpen || undefined} className="decal-patterns character-block">
    <summary>Паттерны декалей</summary>
    <div className="form-grid">
      <label>Паттерн<select value={pattern.kind} onChange={event=>setPattern({...pattern,kind:event.target.value as DecalPattern['kind']})}>
        {Object.entries(decalNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>Поверхность<select value={surface} onChange={event=>setSurface(event.target.value as Surface)}>
        {Object.entries(surfaces).map(([id,[name]])=><option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    <Swatch pattern={pattern} surface={surface}/>
    <div className="form-grid">
      <label>Размер <output>{pattern.size}</output><input aria-label="Размер декали" type="range" min={28} max={160} value={pattern.size}
        onChange={event=>setPattern({...pattern,size:Number(event.target.value)})}/></label>
      <label>Поворот <output>{pattern.rotation}°</output><input aria-label="Поворот декали" type="range" min={0} max={359} value={pattern.rotation}
        onChange={event=>setPattern({...pattern,rotation:Number(event.target.value)})}/></label>
    </div>
    <details className="decal-seeds"><summary>Сравнить варианты</summary><div>
      {[pattern.variant,(pattern.variant+73)%10000,(pattern.variant+149)%10000].map(variant=>
        <Button key={variant} aria-pressed={variant===pattern.variant} onClick={()=>setPattern({...pattern,variant})}><Swatch pattern={{...pattern,variant}} surface={surface}/><span>№ {variant+1}</span></Button>)}
    </div></details>
    <small aria-live="polite">Вариант {pattern.variant+1} · {pattern.size} × {pattern.size} · {pattern.rotation}°</small>
    <div className="inline-form"><Button onClick={()=>setPattern(current=>({...current,variant:(current.variant+1+Math.floor(Math.random()*9999))%10000}))}>Случайный вариант</Button>
      <Button onClick={()=>setPattern({...pattern,size:80,rotation:0,variant:0})}>По умолчанию</Button>
      <Button className="primary" onClick={()=>onPlace(decalNames[pattern.kind],pattern)}>Разместить декаль</Button></div>
  </details>;
}
