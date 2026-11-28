import { useState } from 'react';
import { Sun } from 'lucide-react';
import type { MapObject } from '../../entities/model';
import { Button } from '../../shared/ui';

const presets = {
  candle: { name:'Свеча', color:'#ffb066', radius:60, intensity:55, flicker:true },
  torch: { name:'Факел', color:'#ff944b', radius:145, intensity:85, flicker:true },
  lamp: { name:'Лампа', color:'#ffd584', radius:120, intensity:76, flicker:false },
  lantern: { name:'Фонарь', color:'#f0b14a', radius:165, intensity:82, flicker:false },
  fire: { name:'Костёр', color:'#ff712f', radius:205, intensity:100, flicker:true },
  cold: { name:'Холодное пламя', color:'#92d5ff', radius:100, intensity:65, flicker:true },
  magic: { name:'Магический свет', color:'#8faaff', radius:145, intensity:75, flicker:false },
};
const swatches = [['#f0b14a','Янтарный'],['#ffd584','Тёплый белый'],['#8faaff','Голубой'],['#c88ef0','Лиловый'],['#8bcfb0','Мятный']];

export function LightingPanel({ object, onChange }: { object: MapObject; onChange: (value: MapObject) => void }) {
  const [advanced,setAdvanced] = useState(false);
  const apply = (fields: Partial<MapObject>) => onChange({ ...object, ...fields });
  const range = (label: string, key: 'radius'|'intensity'|'opacity'|'flickerSpeed'|'flickerStrength', fallback:number, min=0, max=100) =>
    <label className="light-range"><span>{label}</span><output>{object[key] ?? fallback}{key === 'radius' ? ' px' : '%'}</output>
      <input type="range" aria-label={label} min={min} max={max} value={object[key] ?? fallback}
        onChange={event=>apply({[key]:Number(event.target.value)})}/></label>;
  return <div className="light-settings">
    <div className="segmented" aria-label="Режим настройки света">
      <Button aria-pressed={!advanced} onClick={()=>setAdvanced(false)}>Простой</Button>
      <Button aria-pressed={advanced} onClick={()=>setAdvanced(true)}>Расширенный</Button>
    </div>
    <div className="light-preset"><Sun size={22} style={{color:object.color}}/>
      <label>Пресет<select aria-label="Источник" value={object.lightPreset ?? 'custom'} onChange={event=>{
        const key = event.target.value;
        const preset = presets[key as keyof typeof presets];
        apply(preset ? {...preset,lightPreset:key} : {lightPreset:'custom'});
      }}>
        <option value="custom">Свой источник</option>
        {Object.entries(presets).map(([key,preset])=><option key={key} value={key}>{preset.name}</option>)}
      </select></label>
    </div>
    {range('Радиус света','radius',120,25,330)}
    <div className="light-swatches" aria-label="Палитра света">
      {swatches.map(([color,name])=><button type="button" className="light-swatch" key={color} style={{background:color}}
        title={name} aria-label={name} aria-pressed={object.color===color} onClick={()=>apply({color})}/>)}
      <label><span className="micro">Свой цвет</span><input aria-label="Цвет" type="color" value={object.color ?? '#f0b14a'} onChange={e=>apply({color:e.target.value})}/></label>
    </div>
    <label className="light-switch">Свет включён<input type="checkbox" checked={object.lightEnabled!==false} onChange={e=>apply({lightEnabled:e.target.checked})}/></label>
    <label className="light-switch">Мерцание<input type="checkbox" checked={Boolean(object.flicker)} onChange={e=>apply({flicker:e.target.checked})}/></label>
    {advanced && <>
      {range('Интенсивность','intensity',100)}
      {range('Прозрачность','opacity',100)}
      {range('Скорость мерцания','flickerSpeed',55)}
      {range('Сила мерцания','flickerStrength',25)}
    </>}
  </div>;
}
